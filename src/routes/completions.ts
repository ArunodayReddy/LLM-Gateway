import { Hono } from "hono";
import { config } from "../config.js";
import { auth } from "../middleware/auth.js";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
]);

export const completions = new Hono<{ Variables: { requestId: string } }>();

// Milestone 1: pure passthrough. The request body is forwarded untouched to
// the upstream provider and the provider's response (including SSE streams)
// is relayed back. Caching, safety, routing, and cost accounting land in
// later milestones.
completions.post("/", auth, async (c) => {
  if (!config.providerApiKey) {
    return c.json(
      { error: "provider not configured — set PROVIDER_API_KEY" },
      500,
    );
  }

  const requestId = c.get("requestId") as string;
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "request body must be valid JSON" }, 400);
  }

  const upstream = await fetch(`${config.providerBaseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.providerApiKey}`,
    },
    body: JSON.stringify(body),
  });

  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  headers.set("x-gateway-request-id", requestId);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
});
