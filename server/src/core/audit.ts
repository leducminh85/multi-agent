import type { Database } from '../db/database.js';
import { parseJson } from '../db/database.js';
import { newId, nowIso } from './util.js';

export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  ip: string | null;
  createdAt: string;
}

/** Append-only audit trail of every mutating action (users and the orchestrator). */
export class AuditService {
  constructor(private db: Database) {}

  log(actor: string, action: string, target?: { type: string; id?: string | null }, details: Record<string, unknown> = {}, ip?: string): void {
    this.db.run(
      'INSERT INTO audit_log (id, actor, action, target_type, target_id, details, ip, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [newId('aud'), actor, action, target?.type ?? null, target?.id ?? null, JSON.stringify(redact(details)), ip ?? null, nowIso()],
    );
  }

  list(opts: { limit?: number; before?: string; action?: string } = {}): AuditEntry[] {
    const limit = Math.min(opts.limit ?? 100, 500);
    const where: string[] = [];
    const params: unknown[] = [];
    if (opts.before) {
      where.push('created_at < ?');
      params.push(opts.before);
    }
    if (opts.action) {
      where.push('action LIKE ?');
      params.push(`${opts.action}%`);
    }
    const rows = this.db.all<any>(
      `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${limit}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      actor: r.actor,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      details: parseJson(r.details, {}),
      ip: r.ip,
      createdAt: r.created_at,
    }));
  }
}

const SECRET_KEYS = /pass(word)?|secret|token|api[-_]?key|credential/i;

/** Never write secrets into the audit log. */
export function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.test(k)) out[k] = v ? '[redacted]' : v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = redact(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}
