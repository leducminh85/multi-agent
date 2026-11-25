import { z } from 'zod';
import type { Database } from '../db/database.js';
import { parseJson } from '../db/database.js';
import type { SecretBox } from '../core/crypto.js';
import type { EventBus } from '../core/eventBus.js';
import { HttpError, maskSecret, newId, notFound, nowIso } from '../core/util.js';
import type { ProviderRegistry } from './registry.js';
import type { ConnectionCheck, ProviderContext, RateLimitInfo } from './types.js';

export type ProviderStatus = 'unknown' | 'connected' | 'error' | 'disabled';

export interface ProviderPublic {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  status: ProviderStatus;
  statusMessage: string | null;
  lastCheckedAt: string | null;
  rateLimit: RateLimitInfo | null;
  maxConcurrency: number;
  accountLabel: string | null;
  planName: string | null;
  /** Masked hints only – secrets never leave the server. */
  credentialHints: Record<string, string>;
  integration: string;
  canExecute: boolean;
  vendor: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export const providerInputSchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1).max(80),
  config: z.record(z.unknown()).default({}),
  /** key → value; empty string = keep existing, null = delete */
  credentials: z.record(z.string().nullable()).default({}),
  enabled: z.boolean().default(true),
  maxConcurrency: z.number().int().min(1).max(64).default(2),
  accountLabel: z.string().max(120).nullable().optional(),
  planName: z.string().max(120).nullable().optional(),
});
export type ProviderInput = z.infer<typeof providerInputSchema>;

export class ProviderService {
  /** Hook set by the usage service to raise alerts on connection errors. */
  onStatusChange?: (providerId: string, ok: boolean, message: string) => void;

  constructor(
    private db: Database,
    private box: SecretBox,
    private bus: EventBus,
    readonly registry: ProviderRegistry,
  ) {}

  private toPublic(r: any): ProviderPublic {
    const adapter = this.registry.has(r.type) ? this.registry.get(r.type) : null;
    const hints = parseJson<Record<string, string>>(r.credential_hint, {});
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      config: parseJson(r.config, {}),
      enabled: !!r.enabled,
      status: r.enabled ? r.status : 'disabled',
      statusMessage: r.status_message,
      lastCheckedAt: r.last_checked_at,
      rateLimit: parseJson(r.rate_limit, null),
      maxConcurrency: r.max_concurrency,
      accountLabel: r.account_label,
      planName: r.plan_name,
      credentialHints: hints,
      integration: adapter?.descriptor.integration ?? 'unknown',
      canExecute: adapter?.descriptor.canExecute ?? false,
      vendor: adapter?.descriptor.vendor ?? 'unknown',
      displayName: adapter?.descriptor.displayName ?? r.type,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  list(): ProviderPublic[] {
    return this.db.all('SELECT * FROM providers ORDER BY created_at').map((r) => this.toPublic(r));
  }

  get(id: string): ProviderPublic {
    const r = this.db.get('SELECT * FROM providers WHERE id = ?', [id]);
    if (!r) throw notFound('Provider');
    return this.toPublic(r);
  }

  create(input: ProviderInput): ProviderPublic {
    const data = providerInputSchema.parse(input);
    if (!this.registry.has(data.type)) throw new HttpError(400, `Unknown provider type "${data.type}"`);
    const creds: Record<string, string> = {};
    for (const [k, v] of Object.entries(data.credentials)) if (v) creds[k] = v;
    const id = newId('prv');
    const now = nowIso();
    this.db.run(
      `INSERT INTO providers (id, type, name, config, credentials_enc, credential_hint, enabled, status, max_concurrency, account_label, plan_name, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        data.type,
        data.name,
        JSON.stringify(data.config),
        Object.keys(creds).length ? this.box.encryptJson(creds) : null,
        JSON.stringify(hintsOf(creds)),
        data.enabled,
        'unknown',
        data.maxConcurrency,
        data.accountLabel ?? null,
        data.planName ?? null,
        now,
        now,
      ],
    );
    const p = this.get(id);
    this.bus.publish('provider.updated', p);
    return p;
  }

  update(id: string, patch: Partial<ProviderInput>): ProviderPublic {
    const row = this.db.get<any>('SELECT * FROM providers WHERE id = ?', [id]);
    if (!row) throw notFound('Provider');
    const data = providerInputSchema.partial().parse(patch);
    let credsEnc = row.credentials_enc;
    let hints = row.credential_hint;
    if (data.credentials && Object.keys(data.credentials).length) {
      const current = this.box.decryptJson<Record<string, string>>(row.credentials_enc, {});
      for (const [k, v] of Object.entries(data.credentials)) {
        if (v === null) delete current[k];
        else if (v !== '') current[k] = v;
      }
      credsEnc = Object.keys(current).length ? this.box.encryptJson(current) : null;
      hints = JSON.stringify(hintsOf(current));
    }
    this.db.run(
      `UPDATE providers SET name = ?, config = ?, credentials_enc = ?, credential_hint = ?, enabled = ?, max_concurrency = ?,
       account_label = ?, plan_name = ?, status = CASE WHEN ? THEN 'unknown' ELSE status END, updated_at = ? WHERE id = ?`,
      [
        data.name ?? row.name,
        data.config ? JSON.stringify(data.config) : row.config,
        credsEnc,
        hints,
        data.enabled ?? !!row.enabled,
        data.maxConcurrency ?? row.max_concurrency,
        data.accountLabel !== undefined ? data.accountLabel : row.account_label,
        data.planName !== undefined ? data.planName : row.plan_name,
        !!(data.credentials || data.config),
        nowIso(),
        id,
      ],
    );
    const p = this.get(id);
    this.bus.publish('provider.updated', p);
    return p;
  }

  delete(id: string): void {
    this.get(id);
    this.db.run('DELETE FROM providers WHERE id = ?', [id]);
    this.bus.publish('provider.updated', { id, deleted: true });
  }

  /** Server-side only: decrypted context passed to adapters. */
  context(id: string): ProviderContext & { type: string; enabled: boolean; maxConcurrency: number; name: string } {
    const r = this.db.get<any>('SELECT * FROM providers WHERE id = ?', [id]);
    if (!r) throw notFound('Provider');
    return {
      providerId: r.id,
      type: r.type,
      name: r.name,
      enabled: !!r.enabled,
      maxConcurrency: r.max_concurrency,
      config: parseJson(r.config, {}),
      credentials: this.box.decryptJson<Record<string, string>>(r.credentials_enc, {}),
    };
  }

  async check(id: string): Promise<ConnectionCheck> {
    const ctx = this.context(id);
    const adapter = this.registry.get(ctx.type);
    let result: ConnectionCheck;
    try {
      result = await adapter.checkConnection(ctx);
    } catch (e: any) {
      result = { ok: false, message: e?.message ?? String(e) };
    }
    // A reachable CLI can still be out of quota: keep reporting the quota problem until it resets.
    const cd = result.ok ? this.cooldown(id) : null;
    if (cd) result = { ...result, ok: false, message: cd.message };
    this.setStatus(id, result.ok ? 'connected' : 'error', result.message);
    return result;
  }

  setStatus(id: string, status: ProviderStatus, message: string): void {
    const prev = this.db.get<any>('SELECT status FROM providers WHERE id = ?', [id]);
    if (!prev) return;
    this.db.run('UPDATE providers SET status = ?, status_message = ?, last_checked_at = ? WHERE id = ?', [status, message, nowIso(), id]);
    this.bus.publish('provider.updated', this.get(id));
    this.onStatusChange?.(id, status !== 'error', message);
  }

  /**
   * Out-of-quota cooldown: the provider is skipped (agents fail over to another AI) until `until`.
   * Persisted in the settings table so a restart does not burn another slow failing call.
   */
  setCooldown(id: string, until: Date, message: string): void {
    this.db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      `cooldown:${id}`,
      JSON.stringify({ until: until.toISOString(), message }),
    ]);
    this.setStatus(id, 'error', message);
  }

  cooldown(id: string): { until: Date; message: string } | null {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [`cooldown:${id}`]);
    if (!row) return null;
    const v = parseJson<{ until: string; message: string } | null>(row.value, null);
    if (!v || new Date(v.until).getTime() <= Date.now()) {
      this.db.run('DELETE FROM settings WHERE key = ?', [`cooldown:${id}`]);
      return null;
    }
    return { until: new Date(v.until), message: v.message };
  }

  clearCooldown(id: string): void {
    this.db.run('DELETE FROM settings WHERE key = ?', [`cooldown:${id}`]);
  }

  recordRateLimit(id: string, info: RateLimitInfo): void {
    this.db.run('UPDATE providers SET rate_limit = ? WHERE id = ?', [JSON.stringify(info), id]);
  }
}

function hintsOf(creds: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(creds)) out[k] = maskSecret(v);
  return out;
}
