// Pure functions: turn raw price bars + FRED series into dated readings.
// No network here, so everything is unit-testable.

import { score } from "../public/lib/score.js";

export const LEADERS = ["NVDA", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "AVGO"];
export const ALTS = ["OWL", "APO", "ARES", "BX", "KKR"];
export const PRICE_SYMBOLS = [
  "SPY", "RSP", "IWM", "QQQ", "HYG", "IEF", "KRE", "XLF", "BIZD", "UUP", "XLU", "XLP", "GLD",
  ...ALTS, ...LEADERS, "^GSPC", "^VIX", "JPY=X",
];
// FRED series and how many days after the observation date each is published.
export const FRED_SERIES = {
  DGS10: 1, BAMLH0A0HYM2: 1, BAMLH0A3HYC: 1, BAMLC0A0CM: 1, T10Y2Y: 1,
  SOFR: 1, IORB: 1, VIXCLS: 1, DEXJPUS: 7,
  ICSA: 5, SAHMREALTIME: 36, UNRATE: 36, PAYEMS: 36,
};

const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const r2 = (v, k = 2) => (v == null || !Number.isFinite(v) ? null : +v.toFixed(k));

/** Align every symbol's bars to the SPY trading calendar. */
export function align(px) {
  const dates = (px.SPY?.bars || []).map((b) => b.d);
  const A = {};
  for (const [sym, s] of Object.entries(px)) {
    if (!s?.bars) continue;
    const m = new Map(s.bars.map((b) => [b.d, b]));
    A[sym] = dates.map((d) => m.get(d) || null);
  }
  return { dates, A };
}

function makeOps(A) {
  const c = (s, i) => (A[s] && i >= 0 && A[s][i] ? A[s][i].c : null);
  const sma = (s, i, n) => {
    if (!A[s] || i - n + 1 < 0) return null;
    let t = 0, k = 0;
    for (let j = i - n + 1; j <= i; j++) { const v = c(s, j); if (v != null) { t += v; k++; } }
    return k >= n * 0.9 ? t / k : null;
  };
  const hi = (s, i, n) => {
    if (!A[s]) return null;
    let m = null;
    for (let j = Math.max(0, i - n + 1); j <= i; j++) { const b = A[s][j]; if (b && (m == null || b.h > m)) m = b.h; }
    return m;
  };
  const chg = (s, i, n) => { const a = c(s, i), b = c(s, i - n); return a != null && b ? (a / b - 1) * 100 : null; };
  const ratio = (a, b, i, n) => {
    const x = c(a, i), y = c(b, i), x0 = c(a, i - n), y0 = c(b, i - n);
    return x && y && x0 && y0 ? ((x / y) / (x0 / y0) - 1) * 100 : null;
  };
  const volRatio = (s, i) => {
    if (!A[s] || !A[s][i]) return null;
    let t = 0, k = 0;
    for (let j = i - 50; j < i; j++) { const b = j >= 0 ? A[s][j] : null; if (b && b.v) { t += b.v; k++; } }
    return k >= 40 && A[s][i].v ? A[s][i].v / (t / k) : null;
  };
  return { c, sma, hi, chg, ratio, volRatio };
}

/** FRED lookups that respect publication lag, so history doesn't peek ahead. */
function makeFred(fred) {
  const S = {};
  for (const [id, rows] of Object.entries(fred || {})) {
    if (!rows?.length) continue;
    const lag = FRED_SERIES[id] ?? 1;
    S[id] = rows.map((r) => ({ d: r.d, avail: addDays(r.d, lag), v: r.v }));
  }
  const idx = (id, date) => {
    const a = S[id];
    if (!a) return -1;
    let lo = 0, hi = a.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].avail <= date) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  };
  const at = (id, date) => { const k = idx(id, date); return k < 0 ? null : S[id][k].v; };
  const obsDate = (id, date) => { const k = idx(id, date); return k < 0 ? null : S[id][k].d; };
  const chgBp = (id, date, days = 30) => { const a = at(id, date), b = at(id, addDays(date, -days)); return a != null && b != null ? (a - b) * 100 : null; };
  const claims = (date) => {
    const k = idx("ICSA", date);
    if (k < 3) return { avg: null, vsLow: null };
    const a4 = (j) => (j < 3 ? null : (S.ICSA[j].v + S.ICSA[j - 1].v + S.ICSA[j - 2].v + S.ICSA[j - 3].v) / 4);
    const now = a4(k);
    let low = null;
    for (let j = Math.max(3, k - 52); j <= k; j++) { const v = a4(j); if (v != null && (low == null || v < low)) low = v; }
    return { avg: now / 1000, vsLow: low ? (now / low - 1) * 100 : null };
  };
  const payrolls = (date) => { const k = idx("PAYEMS", date); return k < 1 ? null : S.PAYEMS[k].v - S.PAYEMS[k - 1].v; };
  return { at, obsDate, chgBp, claims, payrolls, has: (id) => !!S[id] };
}

/** One raw reading as of trading-day index i. */
export function snapshotAt(i, ctx) {
  const { dates, ops: o, F, macro, liveIndex } = ctx;
  const d = dates[i];
  const leaders = {};
  for (const k of LEADERS) {
    const px = o.c(k, i);
    if (px == null) continue;
    const vi = i === liveIndex ? i - 1 : i; // mid-session volume is incomplete; use the last full day
    leaders[k] = { px: r2(px), sma50: r2(o.sma(k, i, 50)), sma200: r2(o.sma(k, i, 200)), high52: r2(o.hi(k, i, 252)), vol_ratio: r2(o.volRatio(k, vi)) };
  }
  const alts = {};
  for (const k of ALTS) { const px = o.c(k, i); if (px != null) alts[k] = { px: r2(px), high3m: r2(o.hi(k, i, 63)) }; }
  const jpy = o.c("JPY=X", i);
  const cl = F.claims(d);
  const sofr = F.at("SOFR", d), iorb = F.at("IORB", d);
  return {
    date: d,
    spx: r2(o.c("^GSPC", i)), spy: r2(o.c("SPY", i)), spy_high52: r2(o.hi("SPY", i, 252)), spy_sma50: r2(o.sma("SPY", i, 50)), spy_sma200: r2(o.sma("SPY", i, 200)),
    rsp: r2(o.c("RSP", i)), rsp_sma50: r2(o.sma("RSP", i, 50)), rsp_sma200: r2(o.sma("RSP", i, 200)), rsp_spy_3m_pct: r2(o.ratio("RSP", "SPY", i, 63)),
    iwm: r2(o.c("IWM", i)), iwm_high52: r2(o.hi("IWM", i, 252)),
    xlf: r2(o.c("XLF", i)), xlf_high3m: r2(o.hi("XLF", i, 63)),
    kre: r2(o.c("KRE", i)), kre_high3m: r2(o.hi("KRE", i, 63)), kre_spy_3m_pct: r2(o.ratio("KRE", "SPY", i, 63)),
    hyg: r2(o.c("HYG", i)), hyg_sma50: r2(o.sma("HYG", i, 50)), hyg_sma200: r2(o.sma("HYG", i, 200)),
    bizd: r2(o.c("BIZD", i)), bizd_high3m: r2(o.hi("BIZD", i, 63)), alts,
    uup: r2(o.c("UUP", i)), uup_3m_pct: r2(o.chg("UUP", i, 63)),
    xlu: r2(o.c("XLU", i)), xlu_3m_pct: r2(o.chg("XLU", i, 63)), xlp: r2(o.c("XLP", i)), xlp_3m_pct: r2(o.chg("XLP", i, 63)), gld: r2(o.c("GLD", i)),
    vix: r2(o.c("^VIX", i) ?? F.at("VIXCLS", d)),
    usdjpy: r2(jpy ?? F.at("DEXJPUS", d)), usdjpy_1m_pct: r2(jpy != null ? o.chg("JPY=X", i, 21) : null),
    us10y: r2(F.at("DGS10", d)), us10y_1m_chg_bp: r2(F.chgBp("DGS10", d), 0),
    hy_oas: r2(F.at("BAMLH0A0HYM2", d)), hy_oas_1m_chg_bp: r2(F.chgBp("BAMLH0A0HYM2", d), 0),
    ccc_oas: r2(F.at("BAMLH0A3HYC", d)), ccc_oas_1m_chg_bp: r2(F.chgBp("BAMLH0A3HYC", d), 0),
    ig_oas: r2(F.at("BAMLC0A0CM", d)), ig_oas_1m_chg_bp: r2(F.chgBp("BAMLC0A0CM", d), 0),
    t10y2y: r2(F.at("T10Y2Y", d)), t10y2y_1m_chg_bp: r2(F.chgBp("T10Y2Y", d), 0),
    sofr_iorb_bp: sofr != null && iorb != null ? r2((sofr - iorb) * 100, 0) : null,
    claims_4wk: r2(cl.avg, 0), claims_vs_low_pct: r2(cl.vsLow, 0),
    sahm: r2(F.at("SAHMREALTIME", d)), unrate: r2(F.at("UNRATE", d), 1), payrolls_k: r2(F.payrolls(d), 0),
    leaders, macro,
  };
}

/** Bank-failure line from the FDIC list (auto-updated). */
export function bankMacro(res, year) {
  if (!res) return null;
  const fails = Array.isArray(res) ? res : res.fails || [];
  const indexDate = Array.isArray(res) ? null : res.indexDate;
  const n = fails.length;
  const assets = fails.reduce((a, b) => a + (+b.assets || 0), 0) * 1000; // FDIC reports $ thousands
  const biggest = fails.reduce((m, b) => Math.max(m, (+b.assets || 0) * 1000), 0);
  const status = n >= 10 || biggest >= 10e9 ? "red" : n >= 4 || biggest >= 1e9 ? "amber" : "green";
  const fmt = (v) => (v >= 1e9 ? "$" + (v / 1e9).toFixed(1) + "B" : "$" + Math.round(v / 1e6) + "M");
  return {
    status, value: `${n} in ${year}`,
    note: (n ? `FDIC failed-bank list; combined assets ${fmt(assets)}, largest ${fmt(biggest)}${fails[0] ? `; latest ${fails[0].name} (${fails[0].d})` : ""}` : "No FDIC-insured bank failures this year") + (indexDate ? `. FDIC data refreshed ${indexDate}` : ""),
    asof: fails[0]?.d || `${year}`, count: n, auto: true,
  };
}

/** Merge hand-maintained macro.json with automated items; flag stale entries. */
export function buildMacro(manual, banks, today) {
  const out = {};
  for (const [k, v] of Object.entries(manual || {})) {
    if (k.startsWith("_") || !v) continue;
    const age = v.updated ? (Date.parse(today) - Date.parse(v.updated)) / 864e5 : null;
    out[k] = { ...v, stale: age != null && age > (v.max_age_days || 60) };
  }
  // The FDIC API can lag weeks behind its own announcements; a hand-entered count that is higher wins.
  if (banks && !(out.banks && (+out.banks.count || 0) > banks.count && !out.banks.stale)) out.banks = banks;
  return out;
}

/** Everything the page needs: latest raw reading + scored history. */
export function buildReadings({ px, fred, macro, liveSession = false, historyDays = 260 }) {
  const { dates, A } = align(px);
  if (dates.length < 260) throw new Error("not enough SPY history");
  const ops = makeOps(A);
  const F = makeFred(fred);
  const last = dates.length - 1;
  const ctx = { dates, ops, F, macro, liveIndex: liveSession ? last : -1 };
  const latest = snapshotAt(last, ctx);
  const history = [];
  for (let i = Math.max(252, last - historyDays + 1); i <= last; i++) {
    const s = i === last ? latest : snapshotAt(i, ctx);
    const R = score(s);
    const p = {};
    for (const x of R.P) p[x.key] = x.pct;
    history.push({ d: s.date, c: R.comp, g: R.gatesOn, spy: s.spy, p });
  }
  const fredAsOf = {};
  for (const id of Object.keys(FRED_SERIES)) fredAsOf[id] = F.obsDate(id, addDays(latest.date, 400));
  return { latest, history, fredAsOf };
}
