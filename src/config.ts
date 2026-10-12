import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  port: Number(optional("PORT", "8787")),
  // Upstream provider (OpenAI-compatible). Default = OpenAI itself.
  providerBaseUrl: optional("PROVIDER_BASE_URL", "https://api.openai.com/v1"),
  // NOTE: intentionally NOT required at boot — the server starts without it
  // so you can smoke-test auth locally. Requests fail with a clear 500
  // until it is set.
  providerApiKey: process.env["PROVIDER_API_KEY"] ?? "",
  // Comma-separated gateway API keys clients must present as Bearer tokens.
  gatewayApiKeys: new Set(
    required("GATEWAY_API_KEYS")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean),
  ),
};
