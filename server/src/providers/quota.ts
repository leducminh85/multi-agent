/**
 * Recognise "out of quota / usage limit" failures across vendors and extract when the limit resets.
 * Examples seen in practice:
 *   Antigravity: "ERROR Individual quota reached. Please upgrade your subscription ... Resets in 159h29m4s."
 *   Claude Code: "Claude AI usage limit reached|1764064800" / "You've hit your limit · resets 3pm"
 *   OpenAI:      "insufficient_quota" / "Rate limit reached for ..."
 *   Gemini:      "RESOURCE_EXHAUSTED"
 */
const QUOTA_RE =
  /quota (?:reached|exceeded|exhausted)|individual quota|insufficient_quota|usage limit|limit reached|hit your limit|out of credits|resource_exhausted|upgrade your (?:subscription|plan)|rate limit/i;

export interface QuotaInfo {
  /** When the provider is expected to accept requests again. */
  resetAt: Date;
  /** True when the reset time came from the provider; false = a conservative guess. */
  exact: boolean;
  /** Short-lived rate limit rather than an exhausted plan quota. */
  rateLimit: boolean;
}

export function parseQuota(message: string, now = Date.now()): QuotaInfo | null {
  if (!QUOTA_RE.test(message)) return null;
  const rateLimit = /rate limit/i.test(message) && !/quota|usage limit|hit your limit|credits/i.test(message);

  // "Resets in 159h29m4s" / "resets in 2h 5m"
  const rel = message.match(/resets?\s+in\s+(?:(\d+)\s*d\s*)?(?:(\d+)\s*h\s*)?(?:(\d+)\s*m(?:in)?\s*)?(?:(\d+)\s*s)?/i);
  if (rel && rel.slice(1).some(Boolean)) {
    const [d, h, m, s] = rel.slice(1).map((x) => Number(x ?? 0));
    return { resetAt: new Date(now + (((d * 24 + h) * 60 + m) * 60 + s) * 1000), exact: true, rateLimit };
  }
  // Claude Code: "usage limit reached|<unix seconds>"
  const unix = message.match(/limit reached\|(\d{10})/i);
  if (unix) return { resetAt: new Date(Number(unix[1]) * 1000), exact: true, rateLimit };
  // "retry after 30 seconds" / "try again in 20s"
  const retry = message.match(/(?:retry after|try again in)\s+(\d+)\s*(s|sec|seconds|m|min|minutes)/i);
  if (retry) {
    const n = Number(retry[1]);
    return { resetAt: new Date(now + (retry[2].startsWith('m') ? n * 60 : n) * 1000), exact: true, rateLimit };
  }
  // Unknown reset: rate limits clear quickly, plan quotas do not – re-check later either way.
  return { resetAt: new Date(now + (rateLimit ? 2 : 60) * 60_000), exact: false, rateLimit };
}

export function formatReset(resetAt: Date, now = Date.now()): string {
  const mins = Math.max(1, Math.round((resetAt.getTime() - now) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 48) return `${h} h ${mins % 60} min`;
  return `${Math.floor(h / 24)} days ${h % 24} h`;
}
