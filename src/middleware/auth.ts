import { createMiddleware } from "hono/factory";
import { config } from "../config.js";
import type { AppEnv } from "../env.js";

/**
 * Bearer-token auth. Clients send: Authorization: Bearer <gateway-api-key>
 * Rejects with 401 when the header is missing or the key is unknown.
 * On success the raw key is stashed on the context (routes must only ever
 * persist its prefix, never the key itself).
 */
export const auth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token || !config.gatewayApiKeys.has(token)) {
    return c.json({ error: "unauthorized — valid Bearer gateway API key required" }, 401);
  }
  c.set("apiKey", token);
  await next();
});
