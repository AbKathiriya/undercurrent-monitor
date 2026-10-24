import { yahoo, pool } from "../lib/sources.js";
import { BT_SYMBOLS, computeBacktest, evaluate } from "../lib/backtest.js";

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=0, must-revalidate", "CDN-Cache-Control": cache },
});

export async function GET() {
  const list = await pool(BT_SYMBOLS, 6, (s) => yahoo(s, { range: "max", interval: "1wk" }));
  const ser = {}, partial = [];
  BT_SYMBOLS.forEach((s, k) => {
    if (list[k]) ser[s] = new Map(list[k].bars.map((b) => [b.d, { c: b.c, h: b.h, v: b.v }]));
    else partial.push(s);
  });
  if (!ser.SPY || ser.SPY.size < 500) {
    return json({ ok: false, error: "Weekly history from Yahoo Finance is unavailable right now. Try again later.", partial }, 503, "public, s-maxage=300");
  }
  BT_SYMBOLS.forEach((s) => { if (!ser[s]) ser[s] = new Map(); });
  const B = computeBacktest(ser);
  const evals = Object.fromEntries([45, 55, 65].map((t) => [t, evaluate(B, t)]));
  return json({ ok: true, generatedAt: new Date().toISOString(), partial, ...B, evals }, 200, "public, s-maxage=86400, stale-while-revalidate=604800");
}
