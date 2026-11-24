import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType, StatementSync } from 'node:sqlite';
import { migrate } from './migrations.js';

// node:sqlite is loaded through require so bundlers/test runners never try to resolve it.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

type Param = string | number | bigint | null | Uint8Array;
export type Params = Record<string, unknown> | unknown[] | undefined;

function normalizeValue(v: unknown): Param {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (v instanceof Uint8Array) return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

function normalize(params: Params): Param[] | Record<string, Param> {
  if (!params) return [];
  if (Array.isArray(params)) return params.map(normalizeValue);
  const out: Record<string, Param> = {};
  for (const [k, v] of Object.entries(params)) out[k] = normalizeValue(v);
  return out;
}

/**
 * Thin synchronous wrapper around Node's built-in SQLite.
 * All domain services go through this class so the storage engine can be swapped
 * (e.g. PostgreSQL) by re-implementing this small surface.
 */
export class Database {
  readonly raw: DatabaseSyncType;
  private cache = new Map<string, StatementSync>();
  private txDepth = 0;

  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON;');
    this.raw.exec('PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL;');
    migrate(this.raw);
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  all<T = Record<string, unknown>>(sql: string, params?: Params): T[] {
    const p = normalize(params);
    const s = this.stmt(sql);
    return (Array.isArray(p) ? s.all(...p) : s.all(p)) as T[];
  }

  get<T = Record<string, unknown>>(sql: string, params?: Params): T | undefined {
    const p = normalize(params);
    const s = this.stmt(sql);
    return (Array.isArray(p) ? s.get(...p) : s.get(p)) as T | undefined;
  }

  run(sql: string, params?: Params): { changes: number } {
    const p = normalize(params);
    const s = this.stmt(sql);
    const r = Array.isArray(p) ? s.run(...p) : s.run(p);
    return { changes: Number(r.changes) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) return fn();
    this.txDepth++;
    this.raw.exec('BEGIN');
    try {
      const r = fn();
      this.raw.exec('COMMIT');
      return r;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    } finally {
      this.txDepth--;
    }
  }

  /** Online backup into a standalone file (consistent snapshot). */
  backupTo(file: string): void {
    this.raw.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  }

  close(): void {
    this.raw.close();
  }
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
