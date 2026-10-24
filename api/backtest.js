import { yahoo, pool } from "../lib/sources.js";
import { BT_SYMBOLS, computeBacktest, evaluate } from "../lib/backtest.js";

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate", "CDN-Cache-Control": cache },
});

export async function GET() {
  const list = await pool(BT_SYMBOLS, 6, (s) => yahoo(s, { start: "2005-01-01", interval: "1wk" }));
  const ser = {}, partial = [];
  BT_SYMBOLS.forEach((s, k) => {
    if (list[k]) ser[s] = new Map(list[k].bars.map((b) => [b.d, { c: b.c, h: b.h, v: b.v }]));
    else partial.push(s);
  });
  if (!ser.SPY || ser.SPY.size < 400) {
    return json({ ok: false, error: `Weekly history from Yahoo Finance is unavailable right now (SPY returned ${ser.SPY ? ser.SPY.size : 0} weeks). Try again later.`, partial }, 503, "public, s-maxage=300");
  }
  BT_SYMBOLS.forEach((s) => { if (!ser[s]) ser[s] = new Map(); });
  let B, evals;
  try {
    B = computeBacktest(ser);
    evals = Object.fromEntries([45, 55, 65].map((t) => [t, evaluate(B, t)]));
  } catch (e) {
    console.error("backtest failed", e);
    return json({ ok: false, error: "Backtest computation failed: " + e.message, partial }, 500, "public, s-maxage=60");
  }
  return json({ ok: true, generatedAt: new Date().toISOString(), partial, ...B, evals }, 200, "public, s-maxage=86400, stale-while-revalidate=604800");
}
