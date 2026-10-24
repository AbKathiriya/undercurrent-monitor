// Scoring rules shared by the API (history, backtest) and the browser (live view).
// Every signal scores 0 (green), 1 (amber) or 2 (red); null means "no data" and is skipped.

export const WEIGHTS = {
  credit: 22, private: 13, banks: 13, breadth: 13, labor: 10,
  rates: 10, leaders: 10, macro: 5, vol: 4,
};

export const REGIMES = [
  { max: 25, label: "Calm", cls: "c0" },
  { max: 45, label: "Watch", cls: "c1" },
  { max: 65, label: "Stress building", cls: "c2" },
  { max: 101, label: "Breaking", cls: "c2" },
];
export const regimeOf = (v) => REGIMES.find((r) => v < r.max) || REGIMES[3];

const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
export const pct = (a, b) => (num(a) == null || num(b) == null || !b ? null : (a / b - 1) * 100);

// hi=true: bigger is worse. Thresholds a (amber) and b (red).
export function lvl(v, a, b, hi) {
  v = num(v);
  if (v == null) return null;
  return hi ? (v < a ? 0 : v < b ? 1 : 2) : (v > a ? 0 : v > b ? 1 : 2);
}

const f = (v, d = 2) => (num(v) == null ? "–" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (v, d = 1) => (num(v) == null ? "–" : (v > 0 ? "+" : "") + f(v, d) + "%");
const bp = (v) => (num(v) == null ? "–" : (v > 0 ? "+" : "") + f(v, 0) + " bp");
const ST = { green: 0, amber: 1, red: 2 };
const trend = (px, s50, s200) => (num(px) == null || num(s50) == null || num(s200) == null ? null : px > s50 ? 0 : px > s200 ? 1 : 2);

export const MACRO_NAMES = {
  private_credit: "Private-credit fund gates",
  auto: "Auto-loan delinquencies",
  cre: "Office CMBS delinquencies",
  bankruptcies: "Corporate bankruptcies",
  banks: "Bank failures",
  earnings: "S&P earnings revisions",
};

export function score(s) {
  const P = [];
  const L = s.leaders || {};

  let curveS = null;
  if (num(s.t10y2y) != null) {
    const c = num(s.t10y2y_1m_chg_bp);
    curveS = c != null ? (c >= 25 ? 2 : c >= 10 ? 1 : s.t10y2y < 0 ? 1 : 0) : s.t10y2y < 0 ? 1 : 0;
  }
  P.push({ key: "rates", name: "Rates & funding",
    why: "The pressure. High rates squeeze whatever was built on cheap money; funding and yen moves show when it starts to bind.",
    sig: [
      { n: "10-yr Treasury yield", v: f(s.us10y) + "%", r: "<4.5 green · ≥5.0 red", s: lvl(s.us10y, 4.5, 5.0, true) },
      { n: "10-yr change, 1 month", v: bp(s.us10y_1m_chg_bp), r: "<15 bp green · ≥35 bp red", s: lvl(s.us10y_1m_chg_bp, 15, 35, true) },
      { n: "Dollar (UUP), 3 months", v: sgn(s.uup_3m_pct), r: "<+1.5% green · ≥+3% red", s: lvl(s.uup_3m_pct, 1.5, 3, true) },
      { n: "Yield curve, 10-yr minus 2-yr", v: num(s.t10y2y) == null ? "–" : f(s.t10y2y) + " pts" + (num(s.t10y2y_1m_chg_bp) != null ? " (" + bp(s.t10y2y_1m_chg_bp) + ")" : ""), r: "fast re-steepening ≥25 bp/mo red · inverted amber", s: curveS },
      { n: "Funding: SOFR minus IORB", v: bp(s.sofr_iorb_bp), r: "<3 bp green · ≥10 bp red (repo strain)", s: lvl(s.sofr_iorb_bp, 3, 10, true) },
      { n: "Yen carry: USD/JPY, 1 month", v: num(s.usdjpy) == null ? "–" : f(s.usdjpy) + " (" + sgn(s.usdjpy_1m_pct) + ")", r: "yen surge: >−2% green · ≤−4% red", s: lvl(s.usdjpy_1m_pct, -2, -4) },
    ] });

  P.push({ key: "credit", name: "Public credit",
    why: "The transmission line. Equity crashes almost never happen with tight spreads. The weakest borrowers (CCC) usually move first.",
    sig: [
      { n: "High-yield spread (OAS)", v: f(s.hy_oas) + "%", r: "<3.5 green · ≥5.0 red", s: lvl(s.hy_oas, 3.5, 5, true) },
      { n: "HY spread change, 1 month", v: bp(s.hy_oas_1m_chg_bp), r: "<25 bp green · ≥75 bp red", s: lvl(s.hy_oas_1m_chg_bp, 25, 75, true) },
      { n: "CCC spread (weakest junk)", v: num(s.ccc_oas) == null ? "–" : f(s.ccc_oas) + "%", r: "<10 green · ≥14 red", s: lvl(s.ccc_oas, 10, 14, true) },
      { n: "CCC change, 1 month", v: bp(s.ccc_oas_1m_chg_bp), r: "<50 bp green · ≥150 bp red", s: lvl(s.ccc_oas_1m_chg_bp, 50, 150, true) },
      { n: "Investment-grade spread", v: num(s.ig_oas) == null ? "–" : f(s.ig_oas) + "%" + (num(s.ig_oas_1m_chg_bp) != null ? " (" + bp(s.ig_oas_1m_chg_bp) + ")" : ""), r: "<1.0 green · ≥1.5 red", s: lvl(s.ig_oas, 1.0, 1.5, true) },
      { n: "HYG trend", v: f(s.hyg), r: "above 50-day green · below 200-day red", s: trend(s.hyg, s.hyg_sma50, s.hyg_sma200) },
    ] });

  const alts = Object.entries(s.alts || {}).map(([k, o]) => ({ k, d: pct(o.px, o.high3m) })).filter((a) => a.d != null);
  const altAvg = alts.length ? alts.reduce((a, b) => a + b.d, 0) / alts.length : null;
  const bizdD = pct(s.bizd, s.bizd_high3m);
  P.push({ key: "private", name: "Private credit",
    why: "Listed lenders (BDCs) and the managers whose private-credit funds have been gating withdrawals.",
    sig: [
      { n: "BDC index (BIZD) off 3-mo high", v: sgn(bizdD), r: ">−5% green · ≤−10% red", s: lvl(bizdD, -5, -10) },
      { n: "Alt managers off 3-mo high, avg", v: sgn(altAvg), r: ">−10% green · ≤−18% red", s: lvl(altAvg, -10, -18), sub: alts.map((a) => a.k + " " + sgn(a.d, 0)).join(" · ") },
    ] });

  const kreD = pct(s.kre, s.kre_high3m), xlfD = pct(s.xlf, s.xlf_high3m);
  P.push({ key: "banks", name: "Banks",
    why: "Where CRE and consumer losses land. Regional banks crack before the big ones.",
    sig: [
      { n: "Regional banks (KRE) off 3-mo high", v: sgn(kreD), r: ">−6% green · ≤−12% red", s: lvl(kreD, -6, -12) },
      { n: "KRE vs S&P, 3 months", v: sgn(s.kre_spy_3m_pct), r: ">−4% green · ≤−9% red", s: lvl(s.kre_spy_3m_pct, -4, -9) },
      { n: "Financials (XLF) off 3-mo high", v: sgn(xlfD), r: ">−5% green · ≤−10% red", s: lvl(xlfD, -5, -10) },
    ] });

  const iwmD = pct(s.iwm, s.iwm_high52), spyD = pct(s.spy, s.spy_high52);
  const div = spyD != null && num(s.rsp) != null && num(s.rsp_sma50) != null ? (spyD > -3 && s.rsp < s.rsp_sma50 ? 2 : 0) : null;
  P.push({ key: "breadth", name: "Breadth",
    why: "Is the index lying? Equal-weight and small caps show what the typical stock is doing.",
    sig: [
      { n: "Equal-weight vs cap-weight, 3 mo", v: sgn(s.rsp_spy_3m_pct), r: ">−1.5% green · ≤−3.5% red", s: lvl(s.rsp_spy_3m_pct, -1.5, -3.5) },
      { n: "Equal-weight S&P (RSP) trend", v: f(s.rsp), r: "above 50-day green · below 200-day red", s: trend(s.rsp, s.rsp_sma50, s.rsp_sma200) },
      { n: "Small caps (IWM) off 52-wk high", v: sgn(iwmD), r: ">−5% green · ≤−12% red", s: lvl(iwmD, -5, -12) },
      { n: "Index near high, typical stock not", v: div === 2 ? "Diverging" : div === 0 ? "No" : "–", r: "SPY within 3% of high while RSP under its 50-day", s: div },
    ] });

  P.push({ key: "labor", name: "Labor",
    why: "The consumer cracks when people lose jobs. Rising claims and the Sahm rule have confirmed every recession since 1970.",
    sig: [
      { n: "Jobless claims, 4-week avg", v: num(s.claims_4wk) == null ? "–" : f(s.claims_4wk, 0) + "k", r: "<250k green · ≥300k red", s: lvl(s.claims_4wk, 250, 300, true) },
      { n: "Claims vs 52-week low", v: sgn(s.claims_vs_low_pct, 0), r: "<+15% green · ≥+30% red", s: lvl(s.claims_vs_low_pct, 15, 30, true) },
      { n: "Sahm rule", v: f(s.sahm), r: "<0.30 green · ≥0.50 red (recession signal)", s: lvl(s.sahm, 0.3, 0.5, true) },
      { n: "Payrolls, latest month", v: num(s.payrolls_k) == null ? "–" : (s.payrolls_k > 0 ? "+" : "") + f(s.payrolls_k, 0) + "k" + (num(s.unrate) != null ? " · " + f(s.unrate, 1) + "% jobless" : ""), r: "≥75k green · <0 red", s: lvl(s.payrolls_k, 75, 0) },
    ] });

  const syms = Object.keys(L).filter((k) => num(L[k].px) != null && num(L[k].sma50) != null);
  const below50 = syms.filter((k) => L[k].px < L[k].sma50).length;
  const big3 = ["NVDA", "AAPL", "MSFT"].filter((k) => syms.includes(k));
  const b3below = big3.filter((k) => L[k].px < L[k].sma50);
  const b3vol = b3below.filter((k) => (L[k].vol_ratio || 0) >= 1.5);
  P.push({ key: "leaders", name: "Leaders",
    why: "The last pillar. When NVDA, AAPL and MSFT break on volume, nothing is left holding the index.",
    sig: [
      { n: "Mega-caps below 50-day", v: below50 + " of " + syms.length, r: "0–1 green · 4+ red", s: syms.length ? (below50 <= 1 ? 0 : below50 <= 3 ? 1 : 2) : null },
      { n: "NVDA / AAPL / MSFT breaking", v: b3below.length ? b3below.join(", ") : "None", r: "any below 50-day amber · on 1.5× volume red", s: big3.length ? (b3vol.length ? 2 : b3below.length ? 1 : 0) : null },
    ] });

  P.push({ key: "vol", name: "Volatility",
    why: "Fear gauge. Low VIX while credit cracks means stocks haven't priced it yet.",
    sig: [{ n: "VIX", v: f(s.vix), r: "<18 green · ≥25 red", s: lvl(s.vix, 18, 25, true) }] });

  const M = s.macro || {};
  P.push({ key: "macro", name: "Slow macro",
    why: "Monthly and quarterly data. Confirms the story; too slow to time anything.",
    sig: Object.keys(MACRO_NAMES).filter((k) => M[k]).map((k) => ({
      n: MACRO_NAMES[k], v: M[k].value || "", r: (M[k].note || "") + (M[k].asof ? " (" + M[k].asof + (M[k].stale ? ", stale" : "") + ")" : ""),
      s: ST[M[k].status] ?? null,
    })) });

  let comp = 0, wsum = 0;
  for (const p of P) {
    p.w = WEIGHTS[p.key];
    const ok = p.sig.filter((x) => x.s != null);
    p.max = ok.length * 2;
    p.pts = ok.reduce((a, b) => a + b.s, 0);
    p.pct = p.max ? Math.round((p.pts / p.max) * 100) : null;
    p.state = p.pct == null ? null : p.pct < 34 ? 0 : p.pct < 67 ? 1 : 2;
    if (p.pct != null) { comp += p.pct * p.w; wsum += p.w; }
  }
  comp = wsum ? Math.round(comp / wsum) : null;

  const vs200 = pct(s.spy, s.spy_sma200);
  const gates = [
    { n: "Credit spreads blow out", d: "HY OAS above 4.5%", on: num(s.hy_oas) != null && s.hy_oas >= 4.5, v: f(s.hy_oas) + "%" },
    { n: "Leaders break on volume", d: "2 of NVDA/AAPL/MSFT under 50-day on 1.5× volume", on: b3vol.length >= 2, v: b3vol.length + " of 3" },
    { n: "Index loses its trend", d: "SPY closes below its 200-day", on: vs200 != null && vs200 < 0, v: sgn(vs200) },
    { n: "Fear shows up", d: "VIX above 25", on: num(s.vix) != null && s.vix > 25, v: f(s.vix) },
  ];
  const pill = {};
  P.forEach((p) => (pill[p.key] = p));
  return { P, pill, comp, gates, gatesOn: gates.filter((g) => g.on).length, spyD, vs200, below50, syms };
}
