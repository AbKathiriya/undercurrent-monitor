import { readFileSync } from "node:fs";
import { prices, fred, fdicFailures, pool } from "../lib/sources.js";
import { PRICE_SYMBOLS, FRED_SERIES, buildReadings, buildMacro, bankMacro } from "../lib/compute.js";

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const todayNY = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

const json = (body, status, cache) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    // Browsers always revalidate; Vercel's CDN shares one copy across visitors.
    "Cache-Control": "public, max-age=0, must-revalidate",
    "CDN-Cache-Control": cache,
  },
});

export async function GET() {
  const started = Date.now();
  const today = todayNY();
  const partial = [];

  const [pxList, fredList, fails] = await Promise.all([
    pool(PRICE_SYMBOLS, 6, (s) => prices(s, { range: "3y", interval: "1d" })),
    pool(Object.keys(FRED_SERIES), 4, (id) => fred(id, daysAgo(820))),
    fdicFailures(today.slice(0, 4) + "-01-01"),
  ]);

  const px = {};
  const srcCount = { yahoo: 0, stooq: 0 };
  PRICE_SYMBOLS.forEach((s, k) => {
    if (pxList[k]) { px[s] = pxList[k]; srcCount[pxList[k].src]++; }
    else partial.push(s);
  });
  const fredData = {};
  // VIXCLS and DEXJPUS only back up Yahoo's ^VIX and JPY=X, so they count as missing only if both fail.
  const covered = { VIXCLS: !!px["^VIX"], DEXJPUS: !!px["JPY=X"] };
  Object.keys(FRED_SERIES).forEach((id, k) => {
    if (fredList[k]) fredData[id] = fredList[k];
    else if (!covered[id]) partial.push("FRED " + id);
  });
  if (!fails) partial.push("FDIC bank failures");

  if (!px.SPY) {
    return json({ ok: false, error: "Market data is unavailable right now (Yahoo Finance and Stooq both failed for SPY). Try again in a few minutes.", partial, generatedAt: new Date().toISOString() }, 503, "public, s-maxage=60");
  }

  let manual = {};
  try { manual = JSON.parse(readFileSync(new URL("../data/macro.json", import.meta.url), "utf8")); }
  catch { partial.push("macro.json"); }
  const macro = buildMacro(manual, bankMacro(fails, today.slice(0, 4)), today);

  const meta = px.SPY.meta || {};
  const reg = meta.currentTradingPeriod?.regular;
  const nowS = Date.now() / 1000;
  const marketOpen = !!(reg && nowS >= reg.start && nowS < reg.end);
  const lastBar = px.SPY.bars[px.SPY.bars.length - 1];
  const liveSession = marketOpen && lastBar?.d === today;

  let out;
  try {
    out = buildReadings({ px, fred: fredData, macro, liveSession });
  } catch (e) {
    console.error("snapshot failed", e);
    return json({ ok: false, error: "Couldn't compute the reading: " + e.message, partial }, 500, "public, s-maxage=60");
  }

  const body = {
    ok: true,
    generatedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
    marketOpen, liveSession, sessionDate: lastBar?.d,
    priceAsOf: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
    partial, sources: srcCount, fredAsOf: out.fredAsOf,
    latest: out.latest, history: out.history,
    macroUpdated: manual._updated || null,
  };
  return json(body, 200, marketOpen ? "public, s-maxage=600, stale-while-revalidate=1800" : "public, s-maxage=1800, stale-while-revalidate=21600");
}
