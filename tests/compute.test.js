import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReadings, buildMacro, bankMacro, PRICE_SYMBOLS, FRED_SERIES } from "../lib/compute.js";
import { computeBacktest, evaluate, BT_SYMBOLS } from "../lib/backtest.js";
import { score, regimeOf, lvl } from "../public/lib/score.js";

// Deterministic pseudo-random walk so tests are stable.
function rng(seed) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31); }
function tradingDays(n, end = "2026-10-23") {
  const out = []; const d = new Date(end + "T12:00:00Z");
  while (out.length < n) { if (d.getUTCDay() % 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  return out;
}
function series(dates, start, drift, seed, shock = null) {
  const r = rng(seed); let p = start;
  return { bars: dates.map((d, i) => { p *= 1 + drift + (r() - 0.5) * 0.02 + (shock && i >= shock[0] && i < shock[1] ? shock[2] : 0); return { d, o: p, h: p * 1.005, l: p * 0.995, c: p, v: 1e6 * (1 + r()) }; }) };
}
function fredDaily(dates, v0, step) { return dates.map((d, i) => ({ d, v: +(v0 + step * i).toFixed(3) })); }

function fixture({ crash = false } = {}) {
  const dates = tradingDays(700);
  const px = {};
  PRICE_SYMBOLS.forEach((s, k) => (px[s] = series(dates, 100 + k, 0.0004, k + 1, crash && s !== "^VIX" ? [640, 700, -0.006] : null)));
  if (crash) px["^VIX"] = series(dates, 30, 0.002, 99);
  else px["^VIX"] = { bars: dates.map((d) => ({ d, o: 14, h: 14, l: 14, c: 14, v: 0 })) };
  const fred = {
    DGS10: fredDaily(dates, 4.0, 0.002), BAMLH0A0HYM2: fredDaily(dates, 2.8, crash ? 0.006 : 0), BAMLH0A3HYC: fredDaily(dates, 9, 0),
    BAMLC0A0CM: fredDaily(dates, 0.8, 0), T10Y2Y: fredDaily(dates, 0.4, 0), SOFR: fredDaily(dates, 3.88, 0), IORB: fredDaily(dates, 3.9, 0),
    ICSA: dates.filter((_, i) => i % 5 === 0).map((d) => ({ d, v: 210000 })),
    SAHMREALTIME: [{ d: "2026-08-01", v: 0.1 }, { d: "2026-09-01", v: 0.0 }],
    UNRATE: [{ d: "2026-08-01", v: 4.1 }, { d: "2026-09-01", v: 4.2 }],
    PAYEMS: [{ d: "2026-08-01", v: 160000 }, { d: "2026-09-01", v: 160029 }],
  };
  return { px, fred };
}

test("every FRED id used by compute is declared", () => {
  for (const id of ["DGS10", "BAMLH0A0HYM2", "BAMLH0A3HYC", "BAMLC0A0CM", "T10Y2Y", "SOFR", "IORB", "ICSA", "SAHMREALTIME", "PAYEMS"]) assert.ok(id in FRED_SERIES, id);
});

test("buildReadings produces a full latest reading and a year of history", () => {
  const { px, fred } = fixture();
  const out = buildReadings({ px, fred, macro: {} });
  assert.equal(out.latest.date, "2026-10-23");
  assert.ok(out.history.length >= 250 && out.history.length <= 260);
  for (const k of ["spy", "spy_high52", "spy_sma200", "rsp_spy_3m_pct", "hy_oas", "us10y_1m_chg_bp", "claims_4wk", "payrolls_k", "vix"]) assert.notEqual(out.latest[k], null, k);
  assert.equal(Object.keys(out.latest.leaders).length, 7);
  assert.equal(out.latest.payrolls_k, 29);
  assert.ok(out.history.every((h) => h.c == null || (h.c >= 0 && h.c <= 100)));
});

test("history respects publication lag (no peeking at unreleased jobs data)", () => {
  const { px, fred } = fixture();
  fred.PAYEMS.push({ d: "2026-10-01", v: 160500 }); // October jobs aren't published until early November
  const out = buildReadings({ px, fred, macro: {} });
  assert.equal(out.latest.payrolls_k, 29);
});

test("a stressed market scores higher than a calm one", () => {
  const calm = buildReadings({ ...fixture(), macro: {} });
  const stressed = buildReadings({ ...fixture({ crash: true }), macro: {} });
  const c = score(calm.latest), s = score(stressed.latest);
  assert.ok(s.comp > c.comp + 15, `stressed ${s.comp} vs calm ${c.comp}`);
  assert.ok(s.gatesOn >= 2, "crash should trip gates");
  assert.equal(c.gatesOn, 0);
});

test("missing inputs are skipped, not scored as zero", () => {
  const { px, fred } = fixture();
  delete px.BIZD; ALTS_DROP(px); delete fred.BAMLH0A3HYC;
  const R = score(buildReadings({ px, fred, macro: {} }).latest);
  assert.equal(R.pill.private.pct, null);
  assert.ok(R.comp != null);
});
function ALTS_DROP(px) { for (const k of ["OWL", "APO", "ARES", "BX", "KKR"]) delete px[k]; }

test("macro: stale flag and FDIC bank line", () => {
  const m = buildMacro({ _updated: "x", cre: { status: "red", updated: "2026-07-01", max_age_days: 45 }, auto: { status: "amber", updated: "2026-10-20" } }, null, "2026-10-23");
  assert.equal(m.cre.stale, true);
  assert.equal(m.auto.stale, false);
  assert.equal(m._updated, undefined);
  const b = bankMacro([{ d: "2026-09-25", name: "Nano Banc", assets: 736000 }, { d: "2026-08-21", name: "Tioga-Franklin", assets: 68000 }], "2026");
  assert.equal(b.value, "2 in 2026");
  assert.equal(b.status, "green");
  assert.equal(bankMacro(Array.from({ length: 6 }, () => ({ d: "2026-01-01", assets: 1000 })), "2026").status, "amber");
});

test("score helpers", () => {
  assert.equal(lvl(5.3, 4.5, 5, true), 2);
  assert.equal(lvl(-4, -5, -10), 0);
  assert.equal(lvl(null, 1, 2), null);
  assert.equal(regimeOf(10).label, "Calm");
  assert.equal(regimeOf(64).label, "Stress building");
  assert.equal(regimeOf(80).label, "Breaking");
});

test("backtest finds a synthetic bear market and evaluates thresholds", () => {
  const weeks = 1000, ser = {};
  const start = new Date("2006-01-02T12:00:00Z");
  const dates = Array.from({ length: weeks }, (_, i) => new Date(start.getTime() + i * 7 * 864e5).toISOString().slice(0, 10));
  BT_SYMBOLS.forEach((s, k) => {
    const r = rng(k + 7); let p = 100; ser[s] = new Map();
    dates.forEach((d, i) => {
      const shock = i > 100 && i < 170 ? -0.012 : 0.002;
      p *= 1 + (s === "^VIX" ? -3 * shock : shock) + (r() - 0.5) * 0.01;
      ser[s].set(d, { c: p, h: p * 1.01, v: 1000 });
    });
  });
  const B = computeBacktest(ser);
  assert.ok(B.weeks.length > 900);
  const E = evaluate(B, 55);
  assert.ok(E.bears >= 1);
  assert.ok(E.episodes[0].depth <= -15);
  assert.ok(E.pctTimeInAlarm >= 0 && E.pctTimeInAlarm <= 100);
});
