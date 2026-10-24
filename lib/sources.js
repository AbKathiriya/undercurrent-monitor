// Free data sources. Each fetcher returns null on failure instead of throwing,
// so one dead source marks the reading "partial" rather than breaking the page.

const UA = "Mozilla/5.0 (compatible; UndercurrentMonitor/1.0; +https://github.com/AbKathiriya/undercurrent-monitor)";
const nyDate = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

async function get(url, { timeout = 12000, headers = {} } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*", ...headers }, signal: ctl.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

// Run async jobs with limited concurrency.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/** Yahoo Finance chart API → {bars:[{d,o,h,l,c,v}], meta} or null. */
export async function yahoo(symbol, { range = "3y", interval = "1d" } = {}) {
  const hosts = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];
  for (let attempt = 0; attempt < 3; attempt++) {
    const host = hosts[attempt % 2];
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`;
    try {
      const r = await get(url);
      if (r.status === 429 || r.status >= 500) { await new Promise((z) => setTimeout(z, 400 + attempt * 700)); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      const res = j?.chart?.result?.[0];
      if (!res?.timestamp) return null;
      const q = res.indicators?.quote?.[0] || {};
      const bars = [];
      res.timestamp.forEach((t, k) => {
        const c = q.close?.[k];
        if (c == null) return;
        bars.push({ d: nyDate(t * 1000), o: q.open?.[k], h: q.high?.[k] ?? c, l: q.low?.[k] ?? c, c, v: q.volume?.[k] ?? 0 });
      });
      // Dedupe dates (Yahoo sometimes repeats the live bar).
      const seen = new Map();
      for (const b of bars) seen.set(b.d, b);
      return { bars: [...seen.values()], meta: res.meta || {}, src: "yahoo" };
    } catch {
      await new Promise((z) => setTimeout(z, 300));
    }
  }
  return null;
}

const STOOQ = { "^GSPC": "^spx", "JPY=X": "usdjpy", "^VIX": null };
/** Stooq daily CSV fallback. */
export async function stooq(symbol) {
  const s = symbol in STOOQ ? STOOQ[symbol] : symbol.toLowerCase() + ".us";
  if (!s) return null;
  try {
    const r = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`);
    if (!r.ok) return null;
    const txt = await r.text();
    const lines = txt.trim().split(/\r?\n/);
    if (!/^Date,Open/i.test(lines[0] || "")) return null;
    const bars = lines.slice(1).map((ln) => {
      const [d, o, h, l, c, v] = ln.split(",");
      return { d, o: +o, h: +h, l: +l, c: +c, v: +(v || 0) };
    }).filter((b) => b.c > 0);
    const cutoff = new Date(Date.now() - 3.1 * 365 * 864e5).toISOString().slice(0, 10);
    return { bars: bars.filter((b) => b.d >= cutoff), meta: {}, src: "stooq" };
  } catch {
    return null;
  }
}

export async function prices(symbol, opts) {
  return (await yahoo(symbol, opts)) || (opts?.interval && opts.interval !== "1d" ? null : await stooq(symbol));
}

/** FRED series via the public CSV endpoint (no key needed) → [{d, v}] or null. */
export async function fred(id, startISO) {
  const key = process.env.FRED_API_KEY;
  try {
    if (key) {
      const r = await get(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${key}&file_type=json&observation_start=${startISO}`);
      if (r.ok) {
        const j = await r.json();
        return (j.observations || []).filter((o) => o.value !== ".").map((o) => ({ d: o.date, v: +o.value }));
      }
    }
    const r = await get(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${startISO}`, { timeout: 15000 });
    if (!r.ok) return null;
    const lines = (await r.text()).trim().split(/\r?\n/).slice(1);
    const out = [];
    for (const ln of lines) {
      const [d, v] = ln.split(",");
      if (v && v !== "." && v !== "" && !Number.isNaN(+v)) out.push({ d, v: +v });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** FDIC failed banks since a date → [{d, name, city, state, assets}] or null. */
export async function fdicFailures(sinceISO) {
  try {
    const q = encodeURIComponent(`FAILDATE:[${sinceISO} TO *]`);
    const r = await get(`https://banks.data.fdic.gov/api/failures?filters=${q}&fields=NAME,CITYST,FAILDATE,QBFASSET,COST&sort_by=FAILDATE&sort_order=DESC&limit=100&format=json`);
    if (!r.ok) return null;
    const j = await r.json();
    return (j.data || []).map((x) => x.data || x).map((x) => ({ d: x.FAILDATE, name: x.NAME, where: x.CITYST, assets: x.QBFASSET, cost: x.COST }));
  } catch {
    return null;
  }
}
