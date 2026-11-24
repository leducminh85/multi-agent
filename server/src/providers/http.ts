import { ProviderError, type RateLimitInfo } from './types.js';

export async function httpJson<T = any>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ data: T; headers: Headers }> {
  const res = await fetchWithTimeout(url, init);
  const text = await res.text();
  if (!res.ok) throw httpError(res.status, text);
  try {
    return { data: (text ? JSON.parse(text) : {}) as T, headers: res.headers };
  } catch {
    throw new ProviderError(`Invalid JSON from ${new URL(url).host}`, false, res.status);
  }
}

export async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 60_000, signal, ...rest } = init;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return await fetch(url, { ...rest, signal: combined });
  } catch (e: any) {
    if (signal?.aborted) throw new ProviderError('Request cancelled', false);
    if (timeout.aborted) throw new ProviderError(`Request timed out after ${timeoutMs} ms`, true);
    throw new ProviderError(`Network error: ${e?.cause?.code ?? e?.message ?? e}`, true);
  }
}

export function httpError(status: number, body: string): ProviderError {
  let msg = body.slice(0, 500);
  try {
    const j = JSON.parse(body);
    msg = j?.error?.message ?? j?.message ?? j?.error ?? msg;
    if (typeof msg !== 'string') msg = JSON.stringify(msg);
  } catch {
    /* plain text body */
  }
  const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
  return new ProviderError(`HTTP ${status}: ${msg}`, retryable, status);
}

/** Iterate Server-Sent-Event `data:` payloads from a fetch Response. */
export async function* sseData(res: Response): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (line.startsWith('data:')) yield line.slice(5).trimStart();
    }
  }
  const rest = buf.trim();
  if (rest.startsWith('data:')) yield rest.slice(5).trimStart();
}

const num = (v: string | null): number | undefined => (v == null || v === '' ? undefined : Number(v));

export function rateLimitFromHeaders(h: Headers, style: 'anthropic' | 'openai'): RateLimitInfo | undefined {
  const capturedAt = new Date().toISOString();
  if (style === 'anthropic') {
    const info: RateLimitInfo = {
      requestsLimit: num(h.get('anthropic-ratelimit-requests-limit')),
      requestsRemaining: num(h.get('anthropic-ratelimit-requests-remaining')),
      requestsReset: h.get('anthropic-ratelimit-requests-reset') ?? undefined,
      tokensLimit: num(h.get('anthropic-ratelimit-tokens-limit')),
      tokensRemaining: num(h.get('anthropic-ratelimit-tokens-remaining')),
      tokensReset: h.get('anthropic-ratelimit-tokens-reset') ?? undefined,
      capturedAt,
    };
    return info.requestsLimit !== undefined || info.tokensLimit !== undefined ? info : undefined;
  }
  const info: RateLimitInfo = {
    requestsLimit: num(h.get('x-ratelimit-limit-requests')),
    requestsRemaining: num(h.get('x-ratelimit-remaining-requests')),
    requestsReset: h.get('x-ratelimit-reset-requests') ?? undefined,
    tokensLimit: num(h.get('x-ratelimit-limit-tokens')),
    tokensRemaining: num(h.get('x-ratelimit-remaining-tokens')),
    tokensReset: h.get('x-ratelimit-reset-tokens') ?? undefined,
    capturedAt,
  };
  return info.requestsLimit !== undefined || info.tokensLimit !== undefined ? info : undefined;
}

export const trimSlash = (s: string) => s.replace(/\/+$/, '');
