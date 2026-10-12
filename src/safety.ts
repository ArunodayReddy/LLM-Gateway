/**
 * M4 safety helpers.
 *
 * Design notes:
 * - The log store intentionally persists only metadata (model, token counts,
 *   cost) — prompt/response bodies are NEVER written to SQLite by design.
 * - redactPii is defense-in-depth: every free-text value that reaches the
 *   store passes through it, so a future field can't leak PII silently.
 * - The blocklist scans extracted prompt text for configured substrings
 *   (case-insensitive). It is a coarse first line of defense, not a
 *   content-moderation model — documented as such.
 */

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// US-ish phone numbers: 555-123-4567, (555) 123-4567, +1 555 123 4567, ...
const PHONE_RE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

export function redactPii(text: string): string {
  return text
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(SSN_RE, "[redacted-ssn]")
    .replace(PHONE_RE, "[redacted-phone]");
}

/** Pull every string out of the messages array (handles content blocks). */
export function extractPromptText(body: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v === "string") parts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      Object.values(v as Record<string, unknown>).forEach(walk);
  };
  if (
    typeof body === "object" && body !== null &&
    "messages" in body
  ) {
    walk((body as Record<string, unknown>)["messages"]);
  }
  return parts.join("\n");
}

/** Return the first configured pattern found in the text, else null. */
export function findBlockedPattern(
  text: string,
  patterns: readonly string[],
): string | null {
  const lower = text.toLowerCase();
  for (const p of patterns) {
    if (p && lower.includes(p)) return p;
  }
  return null;
}
