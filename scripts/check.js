// Static checks run in CI: JS syntax, JSON validity, and that the page references files that exist.
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === "node_modules" || f.startsWith(".") ? [] : walk(p)) : [p]; });
const files = walk(".");
let bad = 0;
for (const f of files.filter((f) => f.endsWith(".js"))) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); } catch (e) { bad++; console.error("Syntax error:", f, String(e.stderr)); }
}
for (const f of files.filter((f) => f.endsWith(".json"))) {
  try { JSON.parse(readFileSync(f, "utf8")); } catch (e) { bad++; console.error("Bad JSON:", f, e.message); }
}
const macro = JSON.parse(readFileSync("data/macro.json", "utf8"));
for (const [k, v] of Object.entries(macro)) {
  if (k.startsWith("_")) continue;
  if (!["green", "amber", "red"].includes(v.status)) { bad++; console.error(`data/macro.json: ${k}.status must be green, amber or red`); }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.updated || "")) { bad++; console.error(`data/macro.json: ${k}.updated must be YYYY-MM-DD`); }
}
const html = readFileSync("public/index.html", "utf8");
for (const m of html.matchAll(/(?:src|href)="\/([^"#?]+)"/g)) {
  if (!existsSync(join("public", m[1]))) { bad++; console.error("index.html references missing file:", m[1]); }
}
if (bad) { console.error(`${bad} problem(s)`); process.exit(1); }
console.log(`OK: ${files.length} files checked`);
