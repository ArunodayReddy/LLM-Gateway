/**
 * Shared Hono environment: every handler can read the request id assigned
 * at the edge and the gateway API key the client authenticated with.
 * (The key itself is never logged — routes only ever use its prefix.)
 */
export type AppEnv = {
  Variables: {
    requestId: string;
    apiKey: string;
  };
};
