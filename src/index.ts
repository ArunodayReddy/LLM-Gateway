import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import type { AppEnv } from "./env.js";
import { completions } from "./routes/completions.js";
import { usage } from "./routes/usage.js";
import { dashboard } from "./routes/dashboard.js";
import { getCache } from "./cache.js";

const app = new Hono<AppEnv>();

// Request id + access log on every request.
app.use("*", async (c, next) => {
  const requestId = randomUUID();
  c.set("requestId", requestId);
  const started = Date.now();
  await next();
  const ms = Date.now() - started;
  console.log(
    `${c.req.method} ${c.req.path} -> ${c.res.status} (${ms}ms) [${requestId}]`,
  );
});

app.get("/health", (c) =>
  c.json({ ok: true, service: "llm-gateway", version: "0.2.0" }),
);

app.route("/v1/chat/completions", completions);
app.route("/v1/usage", usage); // M2: cost/usage aggregates (auth required)
app.route("/dashboard", dashboard); // M2: single-file ops dashboard (auth required)

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`llm-gateway listening on http://localhost:${info.port}`);
  console.log(
    `upstream providers: ${config.providers.map((p) => `${p.name}@${p.baseUrl}`).join(", ")}`,
  );
  console.log(`sqlite log store: ${config.dbPath}`);
  getCache(); // logs which cache backend is active (M3)
});
