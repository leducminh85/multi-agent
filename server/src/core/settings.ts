import type { Database } from '../db/database.js';
import type { EventBus } from './eventBus.js';

export interface ModelPrice {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M output tokens */
  output: number;
  /** USD per 1M cache-read tokens (defaults to 10% of input) */
  cacheRead?: number;
  /** USD per 1M cache-write tokens (defaults to 125% of input) */
  cacheWrite?: number;
}

export interface SettingsShape {
  runtime: {
    /** Global cap on concurrently running tasks across all agents. */
    maxConcurrentTasks: number;
    defaultMaxAttempts: number;
    retryBaseDelayMs: number;
    /** Maximum depth of agent → agent help requests. */
    maxDelegationDepth: number;
    /** After all tasks finish, the coordinator writes a consolidated report. */
    autoSynthesis: boolean;
    /** Add a QA review task when a QA agent exists. */
    autoReview: boolean;
    /** Max characters of a dependency output inlined into another task's prompt. */
    maxContextChars: number;
  };
  usage: { warnPercent: number; criticalPercent: number; billingSyncMinutes: number; healthCheckMinutes: number };
  media: { transcriptionProviderId: string | null; visionProviderId: string | null };
  orchestrator: { plannerAgentId: string | null; coordinatorAgentId: string | null };
  /** USD per 1M tokens, keyed by model id (prefix match supported with trailing *). */
  pricing: Record<string, ModelPrice>;
}

export const DEFAULT_SETTINGS: SettingsShape = {
  runtime: {
    maxConcurrentTasks: 4,
    defaultMaxAttempts: 2,
    retryBaseDelayMs: 3000,
    maxDelegationDepth: 2,
    autoSynthesis: true,
    autoReview: false,
    maxContextChars: 12000,
  },
  usage: { warnPercent: 80, criticalPercent: 95, billingSyncMinutes: 60, healthCheckMinutes: 15 },
  media: { transcriptionProviderId: null, visionProviderId: null },
  orchestrator: { plannerAgentId: null, coordinatorAgentId: null },
  // Anthropic first-party list prices (USD / 1M tokens). Edit in Settings → Pricing for other models.
  pricing: {
    'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
    'claude-opus-5': { input: 5, output: 25 },
    'claude-opus-4-8': { input: 5, output: 25 },
    'claude-opus-4-7': { input: 5, output: 25 },
    'claude-opus-4-6': { input: 5, output: 25 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
    'claude-sonnet-5': { input: 2, output: 10 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5 },
    'claude-haiku-4-5': { input: 1, output: 5 },
  },
};

type Section = keyof SettingsShape;

export class SettingsService {
  constructor(
    private db: Database,
    private bus: EventBus,
  ) {}

  get<K extends Section>(key: K): SettingsShape[K] {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    const def = DEFAULT_SETTINGS[key];
    if (!row) return structuredClone(def);
    const stored = JSON.parse(row.value);
    if (key === 'pricing') return stored as SettingsShape[K];
    return { ...(def as object), ...stored } as SettingsShape[K];
  }

  set<K extends Section>(key: K, value: SettingsShape[K]): SettingsShape[K] {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, JSON.stringify(value)],
    );
    this.bus.publish('system.updated', { settings: key });
    return this.get(key);
  }

  all(): SettingsShape {
    return {
      runtime: this.get('runtime'),
      usage: this.get('usage'),
      media: this.get('media'),
      orchestrator: this.get('orchestrator'),
      pricing: this.get('pricing'),
    };
  }

  /** Raw flags not part of the typed settings (e.g. emergency stop). */
  getFlag(key: string): boolean {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [`flag:${key}`]);
    return row ? JSON.parse(row.value) === true : false;
  }

  setFlag(key: string, value: boolean): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [`flag:${key}`, JSON.stringify(value)],
    );
    this.bus.publish('system.updated', { flag: key, value });
  }
}

export function findPrice(pricing: Record<string, ModelPrice>, model?: string | null): ModelPrice | undefined {
  if (!model) return undefined;
  if (pricing[model]) return pricing[model];
  // Strip common suffixes (dates, provider prefixes) and try prefix entries ending with '*'.
  const bare = model.replace(/^.*\//, '');
  if (pricing[bare]) return pricing[bare];
  let best: { len: number; price: ModelPrice } | undefined;
  for (const [k, v] of Object.entries(pricing)) {
    if (k.endsWith('*') && bare.startsWith(k.slice(0, -1)) && (!best || k.length > best.len)) best = { len: k.length, price: v };
  }
  return best?.price;
}
