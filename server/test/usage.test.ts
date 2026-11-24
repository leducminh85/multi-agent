import { afterEach, describe, expect, it } from 'vitest';
import { findPrice } from '../src/core/settings.js';
import { createMockAdapter, makeServices } from './helpers.js';

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

function env() {
  const mock = createMockAdapter(() => 'x');
  const e = makeServices(mock.adapter);
  cleanup = e.cleanup;
  const p = e.s.providers.create({ type: 'mock', name: 'Sub', config: {}, credentials: {}, enabled: true, maxConcurrency: 1 });
  return { s: e.s, p };
}

describe('usage accounting', () => {
  it('estimates cost only when a price is known and labels the source', () => {
    const { s, p } = env();
    s.usage.record({ providerId: p.id, providerType: 'anthropic-api', model: 'claude-opus-5-5', usage: { inputTokens: 1_000_000, outputTokens: 100_000 }, source: 'api_response' });
    s.usage.record({ providerId: p.id, providerType: 'openai-api', model: 'unknown-model', usage: { inputTokens: 10, outputTokens: 10 }, source: 'api_response' });
    s.usage.record({ providerId: p.id, providerType: 'claude-code-cli', model: 'opus', usage: { inputTokens: 5, outputTokens: 5 }, costUsd: 0.5, costReported: true, source: 'cli_report' });
    const rows = s.db.all<any>('SELECT model, cost_usd, cost_source FROM usage_records ORDER BY created_at');
    expect(rows[0]).toMatchObject({ cost_source: 'estimated' });
    expect(rows[0].cost_usd).toBeCloseTo(4 + 2, 5); // $4/M in + $20/M × 0.1M out
    expect(rows[1]).toMatchObject({ cost_source: 'unknown', cost_usd: null });
    expect(rows[2]).toMatchObject({ cost_source: 'reported', cost_usd: 0.5 });
    const sum = s.usage.summary();
    expect(sum.totals.requests).toBe(3);
    expect(sum.totals.requests_without_cost).toBe(1);
  });

  it('records nothing when the provider reports nothing (no simulated usage)', () => {
    const { s, p } = env();
    s.usage.record({ providerId: p.id, providerType: 'x', source: 'api_response' });
    expect(s.usage.summary().totals.requests).toBe(0);
  });

  it('finds prices by exact id, provider prefix or wildcard', () => {
    const pricing = { 'claude-opus-5-5': { input: 4, output: 20 }, 'gpt-5*': { input: 1, output: 2 } };
    expect(findPrice(pricing, 'claude-opus-5-5')?.input).toBe(4);
    expect(findPrice(pricing, 'anthropic/claude-opus-5-5')?.input).toBe(4);
    expect(findPrice(pricing, 'gpt-5-mini')?.input).toBe(1);
    expect(findPrice(pricing, 'other')).toBeUndefined();
  });
});

describe('quota tracking and alerts', () => {
  it('raises warning/critical alerts from thresholds and resolves them', () => {
    const { s, p } = env();
    s.usage.addQuota(p.id, { metric: 'weekly', label: 'Weekly limit', used: 85, limitValue: 100, unit: 'percent', confidence: 'actual' });
    expect(s.usage.listAlerts().map((a) => a.kind)).toEqual(['quota_warning']);
    s.usage.addQuota(p.id, { metric: 'weekly', label: 'Weekly limit', used: 100, limitValue: 100, unit: 'percent', confidence: 'actual' });
    expect(s.usage.listAlerts().map((a) => a.kind)).toEqual(['quota_exhausted']);
    s.usage.addQuota(p.id, { metric: 'weekly', label: 'Weekly limit', used: 10, limitValue: 100, unit: 'percent', confidence: 'actual' });
    expect(s.usage.listAlerts()).toHaveLength(0);
  });

  it('computes percent for absolute units and keeps the source/confidence', () => {
    const { s, p } = env();
    const q = s.usage.addQuota(p.id, { metric: 'monthly', label: 'Messages', used: 30, limitValue: 120, unit: 'messages', confidence: 'estimated' });
    expect(q.percentUsed).toBe(25);
    expect(q.source).toBe('manual');
    expect(q.confidence).toBe('estimated');
    expect(s.usage.latestQuotas(p.id)).toHaveLength(1);
  });

  it('marks snapshots stale after their reset time and notifies', () => {
    const { s, p } = env();
    s.usage.addQuota(p.id, { metric: 'session', label: '5-hour session', used: 99, limitValue: 100, unit: 'percent', confidence: 'actual', resetsAt: new Date(Date.now() - 60_000).toISOString() });
    const [q] = s.usage.latestQuotas(p.id);
    expect(q.stale).toBe(true);
    s.usage.evaluateAll();
    expect(s.usage.listAlerts().map((a) => a.kind)).toContain('quota_window_reset');
  });

  it('raises a critical alert when a provider connection fails', () => {
    const { s, p } = env();
    s.providers.setStatus(p.id, 'error', 'HTTP 401');
    expect(s.usage.listAlerts()[0]).toMatchObject({ kind: 'provider_error', level: 'critical' });
    s.providers.setStatus(p.id, 'connected', 'ok');
    expect(s.usage.listAlerts()).toHaveLength(0);
  });
});
