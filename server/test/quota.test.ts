import { describe, expect, it } from 'vitest';
import { parseQuota } from '../src/providers/quota.js';

const NOW = Date.UTC(2026, 10, 25, 4, 6, 11);

describe('parseQuota', () => {
  it('reads the reset time from Antigravity', () => {
    const q = parseQuota('Antigravity error: ERROR Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 159h29m4s.', NOW)!;
    expect(q.exact).toBe(true);
    expect(q.resetAt.getTime() - NOW).toBe(((159 * 60 + 29) * 60 + 4) * 1000);
  });

  it('reads Claude Code usage-limit timestamps', () => {
    const q = parseQuota('Claude CLI error: Claude AI usage limit reached|1764064800', NOW)!;
    expect(q.resetAt.getTime()).toBe(1764064800 * 1000);
  });

  it('treats short rate limits differently from exhausted plans', () => {
    expect(parseQuota('Rate limit reached for gpt-5. Please try again in 20s.', NOW)!.rateLimit).toBe(true);
    expect(parseQuota('insufficient_quota: You exceeded your current quota', NOW)!.rateLimit).toBe(false);
  });

  it('ignores unrelated errors', () => {
    expect(parseQuota('Empty response from provider')).toBeNull();
    expect(parseQuota('Command "agy" not found – is the CLI installed and on PATH?')).toBeNull();
  });
});
