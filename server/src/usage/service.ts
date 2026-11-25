import { z } from 'zod';
import type { Database } from '../db/database.js';
import type { ActivityService } from '../core/activity.js';
import type { EventBus } from '../core/eventBus.js';
import { findPrice, type SettingsService } from '../core/settings.js';
import { newId, notFound, nowIso } from '../core/util.js';
import type { ProviderService } from '../providers/service.js';
import type { UsageInfo } from '../providers/types.js';

export type CostSource = 'reported' | 'estimated' | 'unknown';
export type UsageSource = 'api_response' | 'cli_report' | 'provider_api' | 'manual';

export interface UsageRecordInput {
  providerId: string | null;
  providerType: string | null;
  agentId?: string | null;
  taskId?: string | null;
  missionId?: string | null;
  model?: string | null;
  usage?: UsageInfo;
  costUsd?: number;
  costReported?: boolean;
  /** Flat-rate subscription run (e.g. Claude Pro/Max via Claude Code): tokens are recorded, cost is not estimated. */
  subscription?: boolean;
  source: UsageSource;
  durationMs?: number;
}

export const quotaInputSchema = z.object({
  metric: z.string().min(1).max(60), // e.g. session_5h, weekly, monthly, credits, api_budget
  label: z.string().min(1).max(120),
  used: z.number().nullable(),
  limitValue: z.number().nullable(),
  unit: z.enum(['percent', 'usd', 'tokens', 'requests', 'messages', 'credits', 'hours']).default('percent'),
  resetsAt: z.string().datetime({ offset: true }).nullable().optional(),
  confidence: z.enum(['actual', 'estimated', 'unknown']).default('actual'),
  note: z.string().max(1000).nullable().optional(),
});
export type QuotaInput = z.infer<typeof quotaInputSchema>;

export interface QuotaEntry extends QuotaInput {
  id: string;
  providerId: string;
  source: 'manual' | 'provider_api' | 'cli' | 'computed';
  capturedAt: string;
  percentUsed: number | null;
  stale: boolean;
}

export interface Alert {
  id: string;
  providerId: string | null;
  level: 'info' | 'warning' | 'critical';
  kind: string;
  message: string;
  acknowledged: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

const PERIOD_SQL: Record<string, string> = {
  day: "strftime('%Y-%m-%d', created_at)",
  week: "strftime('%Y-W%W', created_at)",
  month: "strftime('%Y-%m', created_at)",
};

/**
 * Usage & subscription monitoring.
 * - usage_records: one row per real provider call, with token counts reported by the provider.
 *   cost_source = 'reported' (provider returned $), 'estimated' (tokens × pricing table) or 'unknown'.
 * - quota_entries: subscription/plan limits. Source is explicit: provider_api, cli, manual, computed.
 * Nothing here is simulated: if a provider reports nothing, nothing is recorded.
 */
export class UsageService {
  constructor(
    private db: Database,
    private bus: EventBus,
    private settings: SettingsService,
    private providers: ProviderService,
    private activity: ActivityService,
  ) {
    providers.onStatusChange = (providerId, ok, message) => {
      const key = `provider_error:${providerId}`;
      if (ok) this.resolveAlert(key);
      else this.raiseAlert({ providerId, level: 'critical', kind: 'provider_error', message: `Cannot connect: ${message}`, dedupeKey: key });
    };
  }

  record(input: UsageRecordInput): void {
    const u = input.usage;
    if (!u && input.costUsd === undefined) return;
    let cost = input.costUsd;
    let costSource: CostSource = input.costReported && cost !== undefined ? 'reported' : 'unknown';
    if (costSource !== 'reported' && u && !input.subscription) {
      const price = findPrice(this.settings.get('pricing'), input.model);
      if (price) {
        const cacheRead = u.cacheReadTokens ?? 0;
        const cacheWrite = u.cacheWriteTokens ?? 0;
        // OpenAI-style input counts include cached tokens; Anthropic-style counts exclude them.
        const plainInput = input.providerType === 'anthropic-api' || input.providerType === 'claude-code-cli' ? u.inputTokens : Math.max(0, u.inputTokens - cacheRead);
        cost =
          (plainInput * price.input +
            u.outputTokens * price.output +
            cacheRead * (price.cacheRead ?? price.input * 0.1) +
            cacheWrite * (price.cacheWrite ?? price.input * 1.25)) /
          1_000_000;
        costSource = 'estimated';
      } else cost = undefined;
    }
    const row = {
      id: newId('use'),
      provider_id: input.providerId,
      provider_type: input.providerType,
      agent_id: input.agentId ?? null,
      task_id: input.taskId ?? null,
      mission_id: input.missionId ?? null,
      model: input.model ?? null,
      input_tokens: u?.inputTokens ?? 0,
      output_tokens: u?.outputTokens ?? 0,
      cache_read_tokens: u?.cacheReadTokens ?? 0,
      cache_write_tokens: u?.cacheWriteTokens ?? 0,
      reasoning_tokens: u?.reasoningTokens ?? 0,
      cost_usd: cost ?? null,
      cost_source: costSource,
      source: input.source,
      duration_ms: input.durationMs ?? null,
      created_at: nowIso(),
    };
    this.db.run(
      `INSERT INTO usage_records (id, provider_id, provider_type, agent_id, task_id, mission_id, model, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, reasoning_tokens, cost_usd, cost_source, source, requests, duration_ms, created_at)
       VALUES (:id,:provider_id,:provider_type,:agent_id,:task_id,:mission_id,:model,:input_tokens,:output_tokens,:cache_read_tokens,
        :cache_write_tokens,:reasoning_tokens,:cost_usd,:cost_source,:source,1,:duration_ms,:created_at)`,
      row,
    );
    this.bus.publish('usage.recorded', row);
  }

  /** Tokens used by an agent since UTC midnight (for daily budgets). */
  agentTokensToday(agentId: string): number {
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    const r = this.db.get<{ n: number }>('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) AS n FROM usage_records WHERE agent_id = ? AND created_at >= ?', [
      agentId,
      since.toISOString(),
    ]);
    return r?.n ?? 0;
  }

  summary(range: { from?: string; to?: string } = {}) {
    const from = range.from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    const to = range.to ?? nowIso();
    const totals = this.db.get<any>(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens),0) AS input_tokens, COALESCE(SUM(output_tokens),0) AS output_tokens,
        COALESCE(SUM(cache_read_tokens),0) AS cache_read_tokens, COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,
        COALESCE(SUM(CASE WHEN cost_source='reported' THEN cost_usd END),0) AS cost_reported,
        COALESCE(SUM(CASE WHEN cost_source='estimated' THEN cost_usd END),0) AS cost_estimated,
        SUM(CASE WHEN cost_source='unknown' THEN 1 ELSE 0 END) AS requests_without_cost
       FROM usage_records WHERE created_at BETWEEN ? AND ?`,
      [from, to],
    );
    const byProvider = this.db.all<any>(
      `SELECT u.provider_id, p.name AS provider_name, u.provider_type, COUNT(*) AS requests,
        SUM(u.input_tokens) AS input_tokens, SUM(u.output_tokens) AS output_tokens,
        SUM(CASE WHEN cost_source='reported' THEN cost_usd ELSE 0 END) AS cost_reported,
        SUM(CASE WHEN cost_source='estimated' THEN cost_usd ELSE 0 END) AS cost_estimated
       FROM usage_records u LEFT JOIN providers p ON p.id = u.provider_id
       WHERE u.created_at BETWEEN ? AND ? GROUP BY u.provider_id ORDER BY input_tokens + output_tokens DESC`,
      [from, to],
    );
    const byAgent = this.db.all<any>(
      `SELECT u.agent_id, a.name AS agent_name, COUNT(*) AS requests, SUM(u.input_tokens) AS input_tokens, SUM(u.output_tokens) AS output_tokens,
        SUM(COALESCE(u.cost_usd,0)) AS cost
       FROM usage_records u LEFT JOIN agents a ON a.id = u.agent_id
       WHERE u.created_at BETWEEN ? AND ? AND u.agent_id IS NOT NULL GROUP BY u.agent_id ORDER BY input_tokens + output_tokens DESC`,
      [from, to],
    );
    const byModel = this.db.all<any>(
      `SELECT model, COUNT(*) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(COALESCE(cost_usd,0)) AS cost
       FROM usage_records WHERE created_at BETWEEN ? AND ? GROUP BY model ORDER BY requests DESC`,
      [from, to],
    );
    return { from, to, totals, byProvider, byAgent, byModel };
  }

  timeseries(period: 'day' | 'week' | 'month', opts: { from?: string; groupBy?: 'provider' | 'agent' | 'none' } = {}) {
    const bucket = PERIOD_SQL[period];
    const from = opts.from ?? new Date(Date.now() - (period === 'day' ? 30 : period === 'week' ? 182 : 365) * 86400_000).toISOString();
    const group = opts.groupBy ?? 'provider';
    const groupCol = group === 'provider' ? "COALESCE(p.name, u.provider_type, 'unknown')" : group === 'agent' ? "COALESCE(a.name, 'system')" : "'total'";
    const rows = this.db.all<any>(
      `SELECT ${bucket.replace(/created_at/g, 'u.created_at')} AS bucket, ${groupCol} AS series,
        SUM(u.input_tokens + u.output_tokens) AS tokens, SUM(COALESCE(u.cost_usd,0)) AS cost, COUNT(*) AS requests
       FROM usage_records u LEFT JOIN providers p ON p.id = u.provider_id LEFT JOIN agents a ON a.id = u.agent_id
       WHERE u.created_at >= ? GROUP BY bucket, series ORDER BY bucket`,
      [from],
    );
    return { period, groupBy: group, rows };
  }

  // ---------------- quotas ----------------
  addQuota(providerId: string, input: QuotaInput, source: QuotaEntry['source'] = 'manual'): QuotaEntry {
    this.providers.get(providerId);
    const d = quotaInputSchema.parse(input);
    const id = newId('quo');
    this.db.run(
      `INSERT INTO quota_entries (id, provider_id, metric, label, used, limit_value, unit, resets_at, confidence, source, note, captured_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, providerId, d.metric, d.label, d.used, d.limitValue, d.unit, d.resetsAt ?? null, d.confidence, source, d.note ?? null, nowIso()],
    );
    const q = this.quotaById(id);
    this.evaluateQuota(q);
    this.bus.publish('provider.updated', { id: providerId, quota: true });
    return q;
  }

  /**
   * Record readings reported by a vendor tool (source 'cli', confidence 'actual'). An unchanged reading only
   * refreshes the capture time instead of adding history rows on every run.
   */
  recordQuotaSnapshots(providerId: string, snaps: { metric: string; label: string; percentUsed: number; resetsAt: string | null; note?: string }[]): void {
    for (const sn of snaps) {
      const used = Math.round(Math.max(0, Math.min(100, sn.percentUsed)) * 10) / 10;
      const prev = this.db.get<any>('SELECT * FROM quota_entries WHERE provider_id = ? AND metric = ? ORDER BY captured_at DESC LIMIT 1', [providerId, sn.metric]);
      if (prev && prev.source === 'cli' && prev.used === used && (prev.resets_at ?? null) === (sn.resetsAt ?? null)) {
        this.db.run('UPDATE quota_entries SET captured_at = ?, label = ? WHERE id = ?', [nowIso(), sn.label, prev.id]);
        continue;
      }
      this.addQuota(providerId, { metric: sn.metric, label: sn.label, used, limitValue: 100, unit: 'percent', resetsAt: sn.resetsAt, confidence: 'actual', note: sn.note ?? null }, 'cli');
    }
    this.bus.publish('provider.updated', { id: providerId, quota: true });
  }

  deleteQuota(id: string): void {
    const q = this.quotaById(id);
    this.db.run('DELETE FROM quota_entries WHERE id = ?', [id]);
    this.resolveAlert(`quota:${q.providerId}:${q.metric}`);
    this.bus.publish('provider.updated', { id: q.providerId, quota: true });
  }

  private quotaById(id: string): QuotaEntry {
    const r = this.db.get<any>('SELECT * FROM quota_entries WHERE id = ?', [id]);
    if (!r) throw notFound('Quota entry');
    return this.mapQuota(r);
  }

  private mapQuota(r: any): QuotaEntry {
    const percent = r.unit === 'percent' && r.used != null ? r.used : r.used != null && r.limit_value ? (r.used / r.limit_value) * 100 : null;
    return {
      id: r.id,
      providerId: r.provider_id,
      metric: r.metric,
      label: r.label,
      used: r.used,
      limitValue: r.limit_value,
      unit: r.unit,
      resetsAt: r.resets_at,
      confidence: r.confidence,
      source: r.source,
      note: r.note,
      capturedAt: r.captured_at,
      percentUsed: percent == null ? null : Math.round(percent * 10) / 10,
      // A snapshot taken before its reset time has passed no longer reflects the current window.
      stale: !!r.resets_at && r.resets_at < nowIso(),
    };
  }

  /** Latest entry per (provider, metric). */
  latestQuotas(providerId?: string): QuotaEntry[] {
    const rows = this.db.all<any>(
      `SELECT q.* FROM quota_entries q
       JOIN (SELECT provider_id, metric, MAX(captured_at) AS m FROM quota_entries GROUP BY provider_id, metric) l
         ON l.provider_id = q.provider_id AND l.metric = q.metric AND l.m = q.captured_at
       ${providerId ? 'WHERE q.provider_id = ?' : ''} ORDER BY q.provider_id, q.metric`,
      providerId ? [providerId] : [],
    );
    return rows.map((r) => this.mapQuota(r));
  }

  quotaHistory(providerId: string, metric: string): QuotaEntry[] {
    return this.db
      .all<any>('SELECT * FROM quota_entries WHERE provider_id = ? AND metric = ? ORDER BY captured_at DESC LIMIT 200', [providerId, metric])
      .map((r) => this.mapQuota(r));
  }

  private evaluateQuota(q: QuotaEntry): void {
    const { warnPercent, criticalPercent } = this.settings.get('usage');
    const key = `quota:${q.providerId}:${q.metric}`;
    if (q.stale) return;
    if (q.percentUsed == null) return this.resolveAlert(key);
    const provider = this.providers.get(q.providerId);
    if (q.percentUsed >= 100) {
      this.raiseAlert({ providerId: q.providerId, level: 'critical', kind: 'quota_exhausted', message: `${provider.name}: ${q.label} limit reached (${q.percentUsed}%)`, dedupeKey: key, replace: true });
    } else if (q.percentUsed >= criticalPercent) {
      this.raiseAlert({ providerId: q.providerId, level: 'critical', kind: 'quota_critical', message: `${provider.name}: ${q.label} at ${q.percentUsed}%`, dedupeKey: key, replace: true });
    } else if (q.percentUsed >= warnPercent) {
      this.raiseAlert({ providerId: q.providerId, level: 'warning', kind: 'quota_warning', message: `${provider.name}: ${q.label} at ${q.percentUsed}%`, dedupeKey: key, replace: true });
    } else this.resolveAlert(key);
  }

  /** Periodic evaluation: stale snapshots after reset, rate-limit headroom. */
  evaluateAll(): void {
    for (const q of this.latestQuotas()) {
      const key = `quota:${q.providerId}:${q.metric}`;
      if (q.stale) {
        this.resolveAlert(key);
        this.raiseAlert({
          providerId: q.providerId,
          level: 'info',
          kind: 'quota_window_reset',
          message: `${q.label}: quota window reset at ${q.resetsAt} – snapshot is outdated, update it`,
          dedupeKey: `quota_reset:${q.id}`,
        });
      } else this.evaluateQuota(q);
    }
    for (const p of this.providers.list()) {
      const rl = p.rateLimit;
      const key = `ratelimit:${p.id}`;
      if (rl?.requestsLimit && rl.requestsRemaining != null) {
        const pct = (rl.requestsRemaining / rl.requestsLimit) * 100;
        const fresh = Date.now() - new Date(rl.capturedAt).getTime() < 5 * 60_000;
        if (fresh && pct < 10)
          this.raiseAlert({ providerId: p.id, level: 'warning', kind: 'rate_limit', message: `${p.name}: only ${rl.requestsRemaining}/${rl.requestsLimit} requests left in the current rate-limit window`, dedupeKey: key });
        else this.resolveAlert(key);
      }
    }
  }

  // ---------------- alerts ----------------
  raiseAlert(a: { providerId: string | null; level: Alert['level']; kind: string; message: string; dedupeKey: string; replace?: boolean }): void {
    const open = this.db.get<any>('SELECT * FROM alerts WHERE dedupe_key = ? AND resolved_at IS NULL', [a.dedupeKey]);
    if (open) {
      if (!a.replace || (open.level === a.level && open.message === a.message)) return;
      this.db.run('UPDATE alerts SET resolved_at = ? WHERE id = ?', [nowIso(), open.id]);
    }
    const id = newId('alr');
    this.db.run('INSERT INTO alerts (id, provider_id, level, kind, message, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?)', [
      id,
      a.providerId,
      a.level,
      a.kind,
      a.message,
      a.dedupeKey,
      nowIso(),
    ]);
    this.activity.record({
      type: 'alert',
      level: a.level === 'critical' ? 'error' : a.level === 'warning' ? 'warning' : 'info',
      message: a.message,
      providerId: a.providerId,
    });
    this.bus.publish('alert.updated', { id });
  }

  resolveAlert(dedupeKey: string): void {
    const r = this.db.run('UPDATE alerts SET resolved_at = ? WHERE dedupe_key = ? AND resolved_at IS NULL', [nowIso(), dedupeKey]);
    if (r.changes) this.bus.publish('alert.updated', { dedupeKey });
  }

  listAlerts(includeResolved = false): Alert[] {
    return this.db
      .all<any>(`SELECT * FROM alerts ${includeResolved ? '' : 'WHERE resolved_at IS NULL'} ORDER BY created_at DESC LIMIT 200`)
      .map((r) => ({
        id: r.id,
        providerId: r.provider_id,
        level: r.level,
        kind: r.kind,
        message: r.message,
        acknowledged: !!r.acknowledged,
        createdAt: r.created_at,
        resolvedAt: r.resolved_at,
      }));
  }

  acknowledgeAlert(id: string): void {
    this.db.run('UPDATE alerts SET acknowledged = 1 WHERE id = ?', [id]);
    this.bus.publish('alert.updated', { id });
  }

  dismissAlert(id: string): void {
    this.db.run('UPDATE alerts SET resolved_at = ?, acknowledged = 1 WHERE id = ?', [nowIso(), id]);
    this.bus.publish('alert.updated', { id });
  }

  // ---------------- official billing APIs ----------------
  async syncBilling(providerId: string): Promise<QuotaEntry[]> {
    const ctx = this.providers.context(providerId);
    const adapter = this.providers.registry.get(ctx.type);
    if (!adapter.fetchBilling) throw new Error('This provider has no official billing API integration');
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const rows = await adapter.fetchBilling(ctx, monthStart, now);
    const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
    const budget = Number(ctx.config.monthlyBudgetUsd ?? 0) || null;
    const out: QuotaEntry[] = [];
    for (const r of rows) {
      out.push(
        this.addQuota(
          providerId,
          {
            metric: `${r.metric}_month`,
            label: `${r.label} – this month`,
            used: r.used,
            limitValue: r.unit === 'usd' ? budget : null,
            unit: r.unit,
            resetsAt: nextMonth,
            confidence: 'actual',
            note: r.note ?? `Period ${r.periodStart.slice(0, 10)} → ${r.periodEnd.slice(0, 10)}`,
          },
          'provider_api',
        ),
      );
    }
    this.activity.record({ type: 'usage.billing_sync', message: `Billing synced for ${ctx.name}`, providerId, level: 'success' });
    return out;
  }
}
