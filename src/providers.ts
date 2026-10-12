/**
 * M5: multi-provider routing with failover.
 *
 * Providers come from PROVIDERS (JSON array) or fall back to the single
 * PROVIDER_BASE_URL / PROVIDER_API_KEY pair for back-compat.
 *
 * Failover triggers on: network errors, timeouts (AbortController), and
 * HTTP 5xx. It deliberately does NOT fail over on 4xx — a 401/400/429 would
 * just repeat against the next provider (and burn retries on rate limits).
 * 502 is returned only when every provider fails.
 */

export interface ProviderDef {
  name: string;
  baseUrl: string;
  apiKey: string;
}

export function parseProviders(env: NodeJS.ProcessEnv): ProviderDef[] {
  const raw = env["PROVIDERS"];
  if (raw && raw.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "PROVIDERS must be valid JSON: [{\"name\",\"baseUrl\",\"apiKey\"}, ...]",
      );
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("PROVIDERS must be a non-empty JSON array");
    }
    return parsed.map((p, i) => {
      if (
        typeof p !== "object" || p === null ||
        typeof (p as Record<string, unknown>)["name"] !== "string" ||
        typeof (p as Record<string, unknown>)["baseUrl"] !== "string"
      ) {
        throw new Error(
          `PROVIDERS[${i}] must have at least {name, baseUrl} (apiKey optional)`,
        );
      }
      const r = p as Record<string, unknown>;
      return {
        name: r["name"] as string,
        baseUrl: (r["baseUrl"] as string).replace(/\/$/, ""),
        apiKey: typeof r["apiKey"] === "string" ? r["apiKey"] : "",
      };
    });
  }
  // Back-compat: single provider from the M1 env vars.
  return [
    {
      name: "default",
      baseUrl: (env["PROVIDER_BASE_URL"] ?? "https://api.openai.com/v1").replace(
        /\/$/,
        "",
      ),
      apiKey: env["PROVIDER_API_KEY"] ?? "",
    },
  ];
}

export interface FailoverResult {
  response: Response;
  providerName: string;
}

/** Try providers in order; throw the last error if all fail. */
export async function fetchWithFailover(
  providers: ProviderDef[],
  path: string,
  body: string,
  timeoutMs: number,
): Promise<FailoverResult> {
  let lastError: unknown = new Error("no providers configured");

  for (const p of providers) {
    if (!p.apiKey) {
      console.warn(`[failover] skipping "${p.name}" — no apiKey configured`);
      continue;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${p.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${p.apiKey}`,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (response.status >= 500) {
        await response.arrayBuffer().catch(() => undefined); // drain
        lastError = new Error(`provider "${p.name}" returned ${response.status}`);
        console.warn(`[failover] "${p.name}" -> ${response.status}, trying next`);
        continue;
      }
      return { response, providerName: p.name };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[failover] "${p.name}" failed (${msg}), trying next`);
    }
  }

  throw lastError;
}
