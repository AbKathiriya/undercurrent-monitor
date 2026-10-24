// Weekly backtest of the market-based half of the score since 2007.
// Credit uses HYG vs IEF as a spread stand-in (FRED only serves 3 years of OAS);
// leaders use QQQ; private credit uses BX and KKR. Labor, FRED and slow macro are excluded.

import { lvl, WEIGHTS } from "../public/lib/score.js";

export const BT_SYMBOLS = ["SPY", "RSP", "IWM", "QQQ", "KRE", "XLF", "HYG", "IEF", "UUP", "BX", "KKR", "^VIX"];

export function computeBacktest(ser) {
  const dates = [...ser.SPY.keys()].sort();
  const col = (s) => dates.map((d) => { const b = ser[s] && ser[s].get(d); return b && b.c ? b : null; });
  const S = {};
  BT_SYMBOLS.forEach((s) => (S[s] = col(s)));
  const c = (s, i) => (i >= 0 && S[s][i] ? S[s][i].c : null);
  const chg = (s, i, n) => { const a = c(s, i), b = c(s, i - n); return a && b ? (a / b - 1) * 100 : null; };
  const sma = (s, i, n) => { if (i - n + 1 < 0) return null; let t = 0; for (let k = i - n + 1; k <= i; k++) { const v = c(s, k); if (v == null) return null; t += v; } return t / n; };
  const hiN = (s, i, n) => { if (i - n + 1 < 0) return null; let m = null; for (let k = i - n + 1; k <= i; k++) { const b = S[s][k]; if (b && (m == null || b.h > m)) m = b.h; } return m; };
  const ratioChg = (a, b, i, n) => { const x = c(a, i), y = c(b, i), x0 = c(a, i - n), y0 = c(b, i - n); return x && y && x0 && y0 ? ((x / y) / (x0 / y0) - 1) * 100 : null; };
  const trend = (s, i) => { const v = c(s, i), a = sma(s, i, 10), b = sma(s, i, 40); return v == null || a == null || b == null ? null : v > a ? 0 : v > b ? 1 : 2; };
  const offHigh = (s, i, n) => { const h = hiN(s, i, n), x = c(s, i); return h && x ? (x / h - 1) * 100 : null; };
  const W = { credit: WEIGHTS.credit, private: WEIGHTS.private, banks: WEIGHTS.banks, breadth: WEIGHTS.breadth, rates: WEIGHTS.rates, leaders: WEIGHTS.leaders, vol: WEIGHTS.vol };
  const weeks = [];
  for (let i = 52; i < dates.length; i++) {
    if (c("SPY", i) == null || dates[i] < "2007-01-01") continue;
    const priv = ["BX", "KKR"].map((s) => offHigh(s, i, 13)).filter((v) => v != null);
    const pil = {
      rates: [lvl(chg("IEF", i, 4), -1.0, -2.2), lvl(chg("UUP", i, 13), 1.5, 3, true)],
      credit: [lvl(ratioChg("HYG", "IEF", i, 4), -1, -3), trend("HYG", i)],
      private: [priv.length ? lvl(priv.reduce((a, b) => a + b, 0) / priv.length, -10, -18) : null],
      banks: [lvl(offHigh("KRE", i, 13), -6, -12), lvl(ratioChg("KRE", "SPY", i, 13), -4, -9), lvl(offHigh("XLF", i, 13), -5, -10)],
      breadth: [
        lvl(ratioChg("RSP", "SPY", i, 13), -1.5, -3.5), trend("RSP", i), lvl(offHigh("IWM", i, 52), -5, -12),
        (() => { const dd = offHigh("SPY", i, 52), r = c("RSP", i), a = sma("RSP", i, 10); return dd != null && r && a ? (dd > -3 && r < a ? 2 : 0) : null; })(),
      ],
      leaders: [trend("QQQ", i)],
      vol: [lvl(c("^VIX", i), 18, 25, true)],
    };
    let tot = 0, ws = 0;
    for (const k in pil) { const ok = pil[k].filter((v) => v != null); if (!ok.length) continue; tot += (ok.reduce((a, b) => a + b, 0) / (ok.length * 2)) * 100 * W[k]; ws += W[k]; }
    const sc = ws ? Math.round(tot / ws) : null;
    const q = S.QQQ[i];
    let vavg = 0, vn = 0;
    for (let k = i - 10; k < i; k++) if (S.QQQ[k]) { vavg += S.QQQ[k].v; vn++; }
    vavg = vn ? vavg / vn : 0;
    const qa = sma("QQQ", i, 10), spy40 = sma("SPY", i, 40);
    const g = [
      (ratioChg("HYG", "IEF", i, 4) ?? 0) <= -3,
      !!(q && qa && q.c < qa && vavg && q.v >= 1.5 * vavg),
      spy40 != null && c("SPY", i) < spy40,
      (c("^VIX", i) ?? 0) > 25,
    ].filter(Boolean).length;
    weeks.push([dates[i], +c("SPY", i).toFixed(2), sc, g]);
  }
  return { weeks, from: weeks[0]?.[0], to: weeks[weeks.length - 1]?.[0] };
}

export function evaluate(B, T) {
  const W = B.weeks, px = W.map((w) => w[1]), sc = W.map((w) => w[2]), g = W.map((w) => w[3]), d = W.map((w) => w[0]);
  const eps = [];
  let peak = px[0], pk = 0, ep = null;
  for (let i = 0; i < px.length; i++) {
    if (px[i] >= peak) { if (ep) eps.push(ep); ep = null; peak = px[i]; pk = i; }
    else {
      const dd = (px[i] / peak - 1) * 100;
      if (!ep && dd <= -10) ep = { peak: pk, hit10: i, depth: dd, trough: i };
      if (ep && dd < ep.depth) { ep.depth = dd; ep.trough = i; }
    }
  }
  if (ep) eps.push(ep);
  const bears = eps.filter((e) => e.depth <= -15);
  const firstAt = (lo, hi, fn) => { for (let i = Math.max(0, lo); i <= hi; i++) if (fn(i)) return i; return -1; };
  const epRows = bears.map((e) => {
    const a = firstAt(e.peak - 26, e.hit10, (i) => sc[i] != null && sc[i] >= T);
    const gg = firstAt(e.peak - 26, e.hit10, (i) => g[i] >= 2);
    return { peak: d[e.peak], depth: +e.depth.toFixed(1), hit10: d[e.hit10], trough: d[e.trough], alarm: a < 0 ? null : d[a], lead: a < 0 ? null : e.hit10 - a, gates: gg < 0 ? null : d[gg], glead: gg < 0 ? null : e.hit10 - gg };
  });
  const spells = [];
  let on = -1, below = 0;
  for (let i = 0; i < sc.length; i++) {
    if (sc[i] != null && sc[i] >= T) { if (on < 0) on = i; below = 0; }
    else if (on >= 0) { below++; if (below >= 4) { spells.push(on); on = -1; below = 0; } }
  }
  if (on >= 0) spells.push(on);
  let tru = 0, late = 0, fals = 0;
  spells.forEach((s) => {
    const runPeak = Math.max(...px.slice(Math.max(0, s - 52), s + 1));
    if ((px[s] / runPeak - 1) * 100 <= -10) { late++; return; }
    if (eps.some((e) => e.hit10 >= s && e.hit10 <= s + 26)) tru++; else fals++;
  });
  const valid = sc.filter((v) => v != null).length || 1;
  const inA = (sc.filter((v) => v != null && v >= T).length / valid) * 100;
  const fwd = (cond) => { let t = 0, n = 0; for (let i = 0; i + 13 < px.length; i++) if (cond(i)) { t += (px[i + 13] / px[i] - 1) * 100; n++; } return n ? +(t / n).toFixed(2) : null; };
  const leads = epRows.filter((r) => r.lead != null).map((r) => r.lead).sort((a, b) => a - b);
  return {
    T, bears: bears.length, warned: leads.length, medianLead: leads.length ? leads[Math.floor((leads.length - 1) / 2)] : null,
    spells: spells.length, trueAlarms: tru, lateAlarms: late, falseAlarms: fals, pctTimeInAlarm: +inA.toFixed(1),
    fwd13: { alarm: fwd((i) => sc[i] != null && sc[i] >= T), all: fwd(() => true), gates2: fwd((i) => g[i] >= 2) },
    episodes: epRows, bearSpans: bears.map((e) => [e.peak, e.trough]),
  };
}
