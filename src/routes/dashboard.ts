import { Hono } from "hono";
import { auth } from "../middleware/auth.js";
import type { AppEnv } from "../env.js";

export const dashboard = new Hono<AppEnv>();

/**
 * GET /dashboard — single-file ops page (auth required). Prompts for the
 * gateway key once (stored in localStorage), then renders totals, per-key
 * breakdown, and the recent-requests table from /v1/usage. No build step,
 * no external assets.
 */
dashboard.get("/", auth, (c) => {
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>llm-gateway · dashboard</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
         background: #0b0e14; color: #e6edf3; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8b949e; font-size: 13px; margin-bottom: 20px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
           gap: 12px; margin-bottom: 24px; }
  .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px;
          padding: 14px 16px; }
  .card .label { font-size: 11px; color: #8b949e; text-transform: uppercase;
                 letter-spacing: .06em; }
  .card .value { font-size: 24px; margin-top: 6px; }
  .card .value.good { color: #5eea94; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #21262d; }
  th { color: #8b949e; font-weight: 600; text-transform: uppercase;
       font-size: 11px; letter-spacing: .05em; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px;
          font-size: 11px; }
  .pill.hit { background: #1a3a2a; color: #5eea94; }
  .pill.miss { background: #2a2a1a; color: #e3b341; }
  .err { color: #f85149; }
  #login { max-width: 360px; margin: 80px auto; text-align: center; }
  #login input { width: 100%; padding: 10px; margin: 12px 0; background: #161b22;
                 border: 1px solid #30363d; border-radius: 6px; color: #e6edf3; }
  #login button { padding: 10px 20px; background: #238636; color: #fff;
                  border: 0; border-radius: 6px; cursor: pointer; }
  .hidden { display: none; }
</style>
</head>
<body>
<div id="login">
  <h1>llm-gateway</h1>
  <p class="sub">Enter a gateway API key to view the dashboard.</p>
  <input id="key" type="password" placeholder="gw_..." autocomplete="off">
  <button onclick="save()">Unlock</button>
</div>
<div id="app" class="hidden">
  <h1>llm-gateway <span class="sub">· usage dashboard</span></h1>
  <p class="sub" id="meta"></p>
  <div class="cards" id="cards"></div>
  <h1 style="font-size:16px;margin-bottom:8px">Recent requests</h1>
  <table><thead><tr>
    <th>Time (UTC)</th><th>Key</th><th>Model</th><th>Tokens</th>
    <th>Cost</th><th>Latency</th><th>Status</th><th>Cache</th><th>Provider</th>
  </tr></thead><tbody id="rows"></tbody></table>
</div>
<script>
const $ = (id) => document.getElementById(id);
function save() {
  const k = $("key").value.trim();
  if (!k) return;
  localStorage.setItem("gw_key", k);
  load();
}
async function load() {
  const key = localStorage.getItem("gw_key");
  if (!key) return;
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  const r = await fetch("/v1/usage", { headers: { Authorization: "Bearer " + key } });
  if (!r.ok) {
    localStorage.removeItem("gw_key");
    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");
    return;
  }
  const u = await r.json();
  const money = (n) => "$" + n.toFixed(4);
  $("meta").textContent = u.totalRequests + " requests logged";
  const cards = [
    ["Requests", u.totalRequests, ""],
    ["Prompt tokens", u.totalPromptTokens.toLocaleString(), ""],
    ["Completion tokens", u.totalCompletionTokens.toLocaleString(), ""],
    ["Spend", money(u.totalCostUsd), ""],
    ["Cache hits", u.cacheHits, "good"],
    ["Saved by cache", money(u.dollarsSaved), "good"],
    ["Rate limit", u.rateLimit.remaining + " / " + u.rateLimit.limit + " left", ""],
  ];
  $("cards").innerHTML = cards.map(([l, v, cls]) =>
    '<div class="card"><div class="label">' + l + '</div><div class="value ' + cls + '">' + v + "</div></div>"
  ).join("");
  $("rows").innerHTML = u.recent.map((row) => {
    const tokens = (row.promptTokens ?? "?") + " / " + (row.completionTokens ?? "?");
    const pill = row.cached
      ? '<span class="pill hit">hit</span>'
      : '<span class="pill miss">miss</span>';
    const status = row.status >= 400
      ? '<span class="err">' + row.status + "</span>" : row.status;
    return "<tr><td>" + row.createdAt + "</td><td>" + row.keyPrefix + "…</td><td>" +
      row.model + "</td><td>" + tokens + "</td><td>" + money(row.costUsd) + "</td><td>" +
      row.latencyMs + "ms</td><td>" + status + "</td><td>" + pill + "</td><td>" +
      (row.provider ?? "—") + "</td></tr>";
  }).join("");
  const keys = u.byKey.map((k) =>
    "<tr><td>—</td><td>" + k.keyPrefix + "…</td><td>—</td><td>—</td><td>" +
    money(k.costUsd) + "</td><td>—</td><td>" + k.requests + " reqs</td><td>—</td><td>—</td></tr>"
  ).join("");
  if (keys) {
    $("rows").innerHTML += '<tr><td colspan="9" style="color:#8b949e">— per-key breakdown —</td></tr>' + keys;
  }
}
if (localStorage.getItem("gw_key")) load();
</script>
</body>
</html>`);
});
