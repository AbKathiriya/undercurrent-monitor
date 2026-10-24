import { score, regimeOf, pct } from "/lib/score.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fmt = (v, d = 2) => (v == null || Number.isNaN(+v) ? "–" : Number(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const sgn = (v, d = 1) => (v == null || Number.isNaN(+v) ? "–" : (v > 0 ? "+" : "") + fmt(v, d) + "%");
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};

let data = null, lastR = null, bt = null;

/* ---------------- fetch ---------------- */
async function load() {
  $("refresh").disabled = true;
  try {
    const r = await fetch("/api/snapshot", { headers: { Accept: "application/json" } });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.error || `The data service answered ${r.status}.`);
    data = j;
    store.set("uc.last", JSON.stringify(j));
    render();
  } catch (e) {
    const cached = store.get("uc.last");
    if (!data && cached) { try { data = JSON.parse(cached); render(); } catch { /* corrupt cache */ } }
    showBanner("bad", "Couldn't refresh", esc(e.message) + (data ? ` Showing the reading from ${esc(new Date(data.generatedAt).toLocaleString())}.` : ""));
    if (!data) $("loading").textContent = "Data is unavailable right now. Try Refresh in a minute.";
  } finally {
    $("refresh").disabled = false;
  }
}

function showBanner(kind, title, html) {
  const b = $("banner");
  b.className = "banner" + (kind === "bad" ? " bad" : "");
  b.innerHTML = `<strong>${esc(title)}</strong><span>${html}</span>`;
  b.hidden = false;
}

/* Last completed weekday session in New York (holidays not modelled). */
function expectedSession() {
  const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const d = new Date(ny);
  if (ny.getHours() < 9 || (ny.getHours() === 9 && ny.getMinutes() < 30)) d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toLocaleDateString("en-CA");
}
function weekdaysBetween(a, b) {
  let n = 0; const d = new Date(a + "T12:00:00"), e = new Date(b + "T12:00:00");
  while (d < e) { d.setDate(d.getDate() + 1); if (d.getDay() % 6) n++; }
  return n;
}

/* ---------------- render ---------------- */
function render() {
  const s = data.latest;
  const R = score(s);
  lastR = R;
  $("loading").hidden = true;
  $("main").hidden = false;

  // Status pill + freshness banner
  $("session").className = "pill" + (data.liveSession ? " live" : "");
  $("session").textContent = data.liveSession ? "Market open · live" : "Market closed";
  const gap = weekdaysBetween(data.sessionDate, expectedSession());
  const msgs = [];
  if (gap >= 2) msgs.push(`Prices end on ${esc(data.sessionDate)}, ${gap} trading days behind. Yahoo Finance may be returning old data.`);
  if (data.partial?.length) msgs.push(`Some inputs couldn't be fetched and are left out of the score: ${esc(data.partial.join(", "))}.`);
  const staleMacro = Object.entries(s.macro || {}).filter(([, v]) => v.stale).map(([k]) => k.replace("_", " "));
  if (staleMacro.length) msgs.push(`Slow-macro entries need a refresh in data/macro.json: ${esc(staleMacro.join(", "))}.`);
  if (msgs.length) showBanner(gap >= 2 ? "bad" : "warn", gap >= 2 ? "Stale data" : "Partial data", msgs.join(" ")); else $("banner").hidden = true;

  const when = data.priceAsOf ? new Date(data.priceAsOf) : new Date(data.generatedAt);
  $("asof").textContent = `${data.liveSession ? "Intraday reading" : "Close of"} ${s.date} · prices as of ${when.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  $("comp").textContent = R.comp ?? "–";
  const reg = regimeOf(R.comp ?? 0);
  $("regime").textContent = reg.label;
  $("regime").className = "regime " + reg.cls;
  $("marker").style.left = Math.min(99.5, R.comp || 0) + "%";
  $("note").textContent = makeNote(R, s, data.history);

  $("spx").textContent = fmt(s.spx, 0);
  $("dd").textContent = sgn(R.spyD); $("dd").className = "num " + (R.spyD < 0 ? "neg" : "");
  $("vs200").textContent = sgn(R.vs200); $("vs200").className = "num " + (R.vs200 < 0 ? "neg" : "pos");
  const hi = s.spy_high52, ratio = s.spx && s.spy ? s.spx / s.spy : null;
  $("ladder").innerHTML = [10, 20, 30].map((k) => {
    const lv = hi * (1 - k / 100), prog = Math.max(0, Math.min(100, (-(R.spyD || 0) / k) * 100));
    return `<div class="rung"><span class="mono">−${k}%</span><span class="bar"><i style="width:${prog}%"></i></span><span class="mono muted">SPY ${fmt(lv, 0)}${ratio ? " · S&P ≈" + fmt(lv * ratio, 0) : ""}</span></div>`;
  }).join("");
  [10, 20, 30].forEach((k) => ($("l" + k).textContent = hi ? `SPY ${fmt(hi * (1 - k / 100), 0)}${ratio ? " · S&P ≈ " + fmt(hi * (1 - k / 100) * ratio, 0) : ""}` : ""));

  $("gatecount").textContent = R.gatesOn + " of 4 triggered";
  $("gates").innerHTML = R.gates.map((g) => `<div class="gate ${g.on ? "on" : ""}"><span class="st">${g.on ? "Triggered" : "Not yet"}</span><strong>${g.n}</strong><span class="small">${g.d}</span><span class="mono">Now: ${esc(g.v)}</span></div>`).join("");

  $("pillars").innerHTML = R.P.map((p) => `<div class="pillar s${p.state ?? ""}"><div class="phead"><h3>${p.name}</h3><span class="chip c${p.state ?? "n"}">${p.pct ?? "–"}<span style="opacity:.7"> · w${p.w}</span></span></div><p class="pwhy">${p.why}</p>` +
    p.sig.map((x) => `<div class="sig"><span class="dot d${x.s ?? ""}"></span><span><span>${esc(x.n)}</span><br><span class="rule">${esc(x.r)}</span>${x.sub ? `<br><span class="rule mono">${esc(x.sub)}</span>` : ""}</span><span class="val">${esc(x.v)}</span></div>`).join("") + `</div>`).join("");

  const L = s.leaders || {};
  $("leadsum").textContent = `${R.below50} of ${R.syms.length} below 50-day`;
  $("leaders").innerHTML = Object.entries(L).map(([k, o]) => {
    const a = pct(o.px, o.sma50), b = pct(o.px, o.sma200), h = pct(o.px, o.high52);
    const st = o.px < o.sma200 ? 2 : o.px < o.sma50 ? ((o.vol_ratio || 0) >= 1.5 ? 2 : 1) : 0;
    return `<tr><td class="sym">${esc(k)}</td><td>${fmt(o.px)}</td><td class="${a < 0 ? "neg" : "pos"}">${sgn(a)}</td><td class="${b < 0 ? "neg" : "pos"}">${sgn(b)}</td><td class="${h < -10 ? "neg" : ""}">${sgn(h)}</td><td>${o.vol_ratio ? fmt(o.vol_ratio, 1) + "×" : "–"}</td><td><span class="chip c${st}">${["Holding", "Slipping", "Broken"][st]}</span></td></tr>`;
  }).join("");
  $("volnote").textContent = data.liveSession ? "During the session, volume compares the last full day, since today's volume is still building." : "";

  drawHistory(data.history);
  const fa = data.fredAsOf || {};
  $("sources").textContent = `FRED latest: 10-yr ${fa.DGS10 || "–"}, HY spread ${fa.BAMLH0A0HYM2 || "–"}, claims ${fa.ICSA || "–"}, jobs ${fa.PAYEMS ? fa.PAYEMS.slice(0, 7) : "–"}. Prices: ${data.sources?.yahoo ?? 0} from Yahoo${data.sources?.stooq ? `, ${data.sources.stooq} from Stooq` : ""}. Built in ${data.tookMs ?? "–"} ms at ${new Date(data.generatedAt).toLocaleTimeString()}.`;
  updatePlanLevels(s);
}

/* Plain-language summary written from the numbers. */
function makeNote(R, s, hist) {
  const red = R.P.filter((p) => p.state === 2 && p.key !== "macro").map((p) => p.name.toLowerCase());
  const green = R.P.filter((p) => p.state === 0).map((p) => p.name.toLowerCase());
  const ago = hist?.length > 6 ? hist[hist.length - 6].c : null;
  const parts = [];
  if (red.length) parts.push(`Under stress: ${red.join(", ")}.`);
  if (green.length) parts.push(`Still healthy: ${green.join(", ")}.`);
  if (ago != null && R.comp != null) {
    const dlt = R.comp - ago;
    parts.push(Math.abs(dlt) < 3 ? "Little changed over the past week." : `${dlt > 0 ? "Up" : "Down"} ${Math.abs(dlt)} points over the past week.`);
  }
  parts.push(R.gatesOn ? `${R.gatesOn} of 4 confirmation gates triggered: ${R.gates.filter((g) => g.on).map((g) => g.n.toLowerCase()).join("; ")}.` : "None of the four confirmation gates has fired.");
  if (R.spyD != null) parts.push(`SPY is ${fmt(Math.abs(R.spyD), 1)}% ${R.spyD < 0 ? "below" : "above"} its 52-week high.`);
  return parts.join(" ");
}

/* ---------------- charts ---------------- */
function attachTip(box, svg, xs, label) {
  const tip = document.createElement("div");
  tip.className = "tip"; tip.hidden = true; box.appendChild(tip);
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const x = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * svg.viewBox.baseVal.width;
    let k = 0, best = Infinity;
    xs.forEach((v, i) => { const dd = Math.abs(v - x); if (dd < best) { best = dd; k = i; } });
    tip.innerHTML = label(k);
    tip.style.left = (xs[k] / svg.viewBox.baseVal.width) * r.width + "px";
    tip.style.top = "8px";
    tip.hidden = false;
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerleave", () => (tip.hidden = true));
}

function drawHistory(h) {
  const box = $("hist");
  if (!h?.length) { box.innerHTML = `<div class="empty">No history.</div>`; return; }
  const W = 900, H = 240, l = 34, r = 40, t = 10, b = 24, iw = W - l - r, ih = H - t - b, n = h.length;
  const x = (i) => l + (i / Math.max(1, n - 1)) * iw, y = (v) => t + ih - (v / 100) * ih;
  const spys = h.map((p) => p.spy).filter(Boolean), smin = Math.min(...spys), smax = Math.max(...spys);
  const ys = (v) => t + ih - ((v - smin) / (smax - smin || 1)) * ih;
  const bands = [[0, 25, "--ok-bg"], [25, 45, "--warn-bg"], [45, 65, "--bad-bg"], [65, 100, "--bad-bg"]]
    .map(([a, c, col]) => `<rect x="${l}" y="${y(c)}" width="${iw}" height="${y(a) - y(c)}" fill="var(${col})" opacity="${c === 100 ? 0.9 : 0.55}"/>`).join("");
  const grid = [0, 25, 45, 65, 100].map((v) => `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--rule)"/><text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${v}</text>`).join("");
  const path = (fn) => h.map((p, i) => (fn(p) == null ? null : [x(i), fn(p)])).filter(Boolean).map((pt, k) => (k ? "L" : "M") + pt[0].toFixed(1) + " " + pt[1].toFixed(1)).join(" ");
  const gates = h.map((p, i) => (p.g >= 2 ? `<circle cx="${x(i)}" cy="${y(98)}" r="2.5" fill="var(--bad)"/>` : "")).join("");
  const months = [];
  let last = "";
  h.forEach((p, i) => { const m = p.d.slice(0, 7); if (m !== last) { if (i > 0 && +m.slice(5) % 2 === 1) months.push([i, m]); last = m; } });
  const ml = months.map(([i, m]) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${new Date(m + "-15").toLocaleString("en-US", { month: "short" })}</text>`).join("");
  const lp = h[n - 1];
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Stress score and SPY over the past year">${bands}${grid}
    <path d="${path((p) => (p.spy ? ys(p.spy) : null))}" fill="none" stroke="var(--ink)" stroke-width="1.2" opacity=".45"/>
    <text x="${W - r + 4}" y="${ys(smax) + 4}" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${fmt(smax, 0)}</text>
    <text x="${W - r + 4}" y="${ys(smin) + 4}" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${fmt(smin, 0)}</text>
    <path d="${path((p) => (p.c == null ? null : y(p.c)))}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${gates}<circle cx="${x(n - 1)}" cy="${y(lp.c ?? 0)}" r="4.5" fill="var(--accent)"/>${ml}
    <rect x="${l}" y="${t}" width="${iw}" height="${ih}" fill="transparent"/></svg>`;
  const cs = h.map((p) => p.c).filter((v) => v != null);
  $("histsum").textContent = `Range ${Math.min(...cs)}–${Math.max(...cs)} · ${h.filter((p) => p.g >= 2).length} days with 2+ gates`;
  attachTip(box, box.querySelector("svg"), h.map((_, i) => x(i)), (k) => `${h[k].d}<br>Score ${h[k].c ?? "–"} · gates ${h[k].g} · SPY ${fmt(h[k].spy)}`);
}

/* ---------------- backtest ---------------- */
async function loadBacktest() {
  try {
    const r = await fetch("/api/backtest");
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(j?.error || `The backtest service answered ${r.status}.`);
    bt = j;
    renderBacktest();
  } catch (e) {
    $("btmsg").textContent = e.message;
  }
}

function renderBacktest() {
  if (!bt) return;
  const T = $("thr").value;
  const E = bt.evals[T];
  $("btstats").innerHTML = `
    <div class="stat"><span class="small">Bear markets warned</span><b class="num">${E.warned} of ${E.bears}</b><span class="small">score ≥${T} before SPY was −10%</span></div>
    <div class="stat"><span class="small">Median warning</span><b class="num">${E.medianLead == null ? "–" : E.medianLead + " wks"}</b><span class="small">before the −10% mark</span></div>
    <div class="stat warn"><span class="small">False alarms</span><b class="num">${E.falseAlarms} of ${E.spells}</b><span class="small">no 10% drop within 26 wks${E.lateAlarms ? ` · ${E.lateAlarms} fired late` : ""}</span></div>
    <div class="stat"><span class="small">Avg SPY next 13 wks</span><b class="num">${sgn(E.fwd13.alarm)}</b><span class="small">when ≥${T} · all weeks ${sgn(E.fwd13.all)} · 2+ gates ${sgn(E.fwd13.gates2)}</span></div>`;
  $("bteps").innerHTML = E.episodes.map((r) => `<tr><td>${r.peak}</td><td class="neg">${fmt(r.depth, 0)}%</td><td>${r.hit10}</td><td>${r.alarm || "–"}</td><td>${r.lead == null ? '<span class="chip c2">Missed</span>' : `<span class="chip c0">${r.lead} wks</span>`}</td><td>${r.gates ? `${r.gates} (${r.glead} wks)` : "–"}</td></tr>`).join("");
  $("btthr").innerHTML = ["45", "55", "65"].map((t) => {
    const e = bt.evals[t];
    return `<tr${t === T ? ' style="font-weight:600"' : ""}><td>${t}</td><td>${e.warned} of ${e.bears}</td><td>${e.medianLead == null ? "–" : e.medianLead + " wks"}</td><td>${e.spells}</td><td>${e.falseAlarms}${e.lateAlarms ? ` (+${e.lateAlarms} late)` : ""}</td><td>${fmt(e.pctTimeInAlarm, 0)}%</td><td>${sgn(e.fwd13.alarm)}</td></tr>`;
  }).join("");
  drawBT(E, +T);
  $("btbody").hidden = false;
  $("btmsg").textContent = `Weekly, ${bt.from} to ${bt.to}. Warning time runs from the first alarm to the week SPY closed 10% below its peak.${bt.partial?.length ? " Missing: " + bt.partial.join(", ") + "." : ""}`;
}

function drawBT(E, T) {
  const Wk = bt.weeks, n = Wk.length, W = 900, H = 320, l = 40, r = 10, t = 10, mid = 190, b = 24, iw = W - l - r;
  const x = (i) => l + (i / (n - 1)) * iw;
  const lp = Wk.map((w) => Math.log(w[1])), mn = Math.min(...lp), mx = Math.max(...lp);
  const yP = (v) => t + (1 - (Math.log(v) - mn) / (mx - mn)) * (mid - t - 10);
  const yS = (v) => mid + 8 + (1 - v / 100) * (H - b - mid - 8);
  const shade = E.bearSpans.map(([a, z]) => `<rect x="${x(a)}" y="${t}" width="${Math.max(2, x(z) - x(a))}" height="${H - b - t}" fill="var(--shade)"/>`).join("");
  let pp = "", ps = "";
  for (let i = 0; i < n; i++) {
    pp += (pp ? "L" : "M") + x(i).toFixed(1) + " " + yP(Wk[i][1]).toFixed(1);
    if (Wk[i][2] != null) ps += (ps ? "L" : "M") + x(i).toFixed(1) + " " + yS(Wk[i][2]).toFixed(1);
  }
  const years = [];
  let ly = "";
  Wk.forEach((w, i) => { const yv = w[0].slice(0, 4); if (yv !== ly && +yv % 2 === 0) years.push([i, yv]); ly = yv; });
  const yl = years.map(([i, yv]) => `<text x="${x(i)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">'${yv.slice(2)}</text>`).join("");
  const sg = [0, 50, 100].map((v) => `<line x1="${l}" x2="${W - r}" y1="${yS(v)}" y2="${yS(v)}" stroke="var(--rule)"/><text x="${l - 6}" y="${yS(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">${v}</text>`).join("");
  $("btchart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="SPY and backtested stress score since 2007">${shade}
    <text x="${l}" y="${t + 12}" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono,monospace">SPY ${fmt(Math.exp(mx), 0)}</text>
    <path d="${pp}" fill="none" stroke="var(--ink)" stroke-width="1.5"/>${sg}
    <line x1="${l}" x2="${W - r}" y1="${yS(T)}" y2="${yS(T)}" stroke="var(--bad)" stroke-dasharray="4 3"/>
    <path d="${ps}" fill="none" stroke="var(--accent)" stroke-width="1.3"/>${yl}
    <rect x="${l}" y="${t}" width="${iw}" height="${H - b - t}" fill="transparent"/></svg>`;
  const box = $("btchart");
  box.querySelector(".tip")?.remove();
  attachTip(box, box.querySelector("svg"), Wk.map((_, i) => x(i)), (k) => `${Wk[k][0]}<br>SPY ${fmt(Wk[k][1])} · score ${Wk[k][2] ?? "–"} · gates ${Wk[k][3]}`);
}

/* ---------------- plan (this browser only) ---------------- */
const planIds = ["p10", "p20", "p30"];
const planVals = () => JSON.stringify(planIds.map((id) => $(id).value));
let savedPlan = "";
function initPlan() {
  let p = {};
  try { p = JSON.parse(store.get("uc.plan") || "{}"); } catch { p = {}; }
  planIds.forEach((id) => ($(id).value = p[id] || ""));
  savedPlan = planVals();
  $("planstat").textContent = p.updatedAt ? "Last saved " + new Date(p.updatedAt).toLocaleString() : "Not written yet";
  planIds.forEach((id) => $(id).addEventListener("input", () => ($("save").disabled = planVals() === savedPlan)));
  $("save").addEventListener("click", () => {
    const o = { updatedAt: new Date().toISOString() };
    planIds.forEach((id) => (o[id] = $(id).value));
    store.set("uc.plan", JSON.stringify(o));
    savedPlan = planVals();
    $("save").disabled = true;
    $("planstat").textContent = "Last saved " + new Date(o.updatedAt).toLocaleString();
    $("planhint").textContent = store.get("uc.plan") ? "Saved in this browser." : "This browser blocks storage, so the plan can't be kept. Use Copy to save it elsewhere.";
  });
  $("copyplan").addEventListener("click", async () => {
    const txt = ["−10%", "−20%", "−30%"].map((k, i) => `S&P ${k}: ${$(planIds[i]).value || "(blank)"}`).join("\n\n");
    try { await navigator.clipboard.writeText(txt); $("planhint").textContent = "Copied."; }
    catch { $("planhint").textContent = "Copy isn't allowed here; select the text instead."; }
  });
}
function updatePlanLevels(s) {
  const hi = s.spy_high52, ratio = s.spx && s.spy ? s.spx / s.spy : null;
  [10, 20, 30].forEach((k) => ($("l" + k).textContent = hi ? `SPY ${fmt(hi * (1 - k / 100), 0)}${ratio ? " · S&P ≈ " + fmt(hi * (1 - k / 100) * ratio, 0) : ""}` : ""));
}

/* ---------------- boot ---------------- */
$("refresh").addEventListener("click", () => load());
$("thr").addEventListener("change", renderBacktest);
initPlan();
try { const c = store.get("uc.last"); if (c) { data = JSON.parse(c); render(); } } catch { /* ignore */ }
load();
loadBacktest();
// Refresh every 10 minutes while the market is open and the tab is visible.
setInterval(() => { if (data?.marketOpen && document.visibilityState === "visible") load(); }, 10 * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && data && Date.now() - Date.parse(data.generatedAt) > 15 * 60 * 1000) load();
});
