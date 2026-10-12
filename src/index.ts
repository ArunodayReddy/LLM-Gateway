import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { completions } from "./routes/completions.js";

const app = new Hono<{ Variables: { requestId: string } }>();

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
  c.json({ ok: true, service: "llm-gateway", version: "0.1.0" }),
);

app.route("/v1/chat/completions", completions);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`llm-gateway listening on http://localhost:${info.port}`);
  console.log(`upstream provider: ${config.providerBaseUrl}`);
});
