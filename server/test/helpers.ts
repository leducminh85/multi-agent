import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { createServices, type Services } from '../src/container.js';
import { ProviderError, type ProviderAdapter, type RunRequest, type RunResult } from '../src/providers/types.js';

export interface MockCall {
  system: string;
  prompt: string;
  model?: string;
  providerId?: string;
  startedAt: number;
  endedAt?: number;
}

export type MockScript = (req: RunRequest, call: MockCall, n: number) => string | Error | Promise<string | Error>;

/** Test-only adapter. Never registered in production (see ProviderRegistry DEFAULT_ADAPTERS). */
export function createMockAdapter(script: MockScript, opts: { delayMs?: number } = {}) {
  const calls: MockCall[] = [];
  let active = 0;
  let maxActive = 0;
  const adapter: ProviderAdapter = {
    descriptor: {
      type: 'mock',
      displayName: 'Mock (tests)',
      vendor: 'test',
      integration: 'api',
      description: 'test adapter',
      configFields: [],
      credentialFields: [{ key: 'apiKey', label: 'key', type: 'password' }],
      capabilities: {
        streaming: true,
        vision: false,
        transcription: false,
        video: false,
        agenticTools: false,
        usageReporting: 'tokens',
        billingApi: false,
        rateLimitHeaders: false,
        subscriptionQuotaApi: false,
      },
      suggestedModels: [],
      limitations: [],
      canExecute: true,
    },
    async run(ctx, req): Promise<RunResult> {
      const call: MockCall = { system: req.system, prompt: req.messages.map((m) => m.content).join('\n---\n'), model: req.model, providerId: ctx.providerId, startedAt: Date.now() };
      calls.push(call);
      active++;
      maxActive = Math.max(maxActive, active);
      try {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, opts.delayMs ?? 30);
          req.signal.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new ProviderError('Request cancelled', false));
          });
        });
        const out = await script(req, call, calls.length);
        if (out instanceof Error) throw out;
        req.onDelta?.(out);
        return { text: out, model: req.model ?? 'claude-sonnet-5-5', usage: { inputTokens: 100, outputTokens: 50 }, durationMs: Date.now() - call.startedAt };
      } finally {
        active--;
        call.endedAt = Date.now();
      }
    },
    async checkConnection() {
      return { ok: true, message: 'mock ok' };
    },
  };
  return { adapter, calls, get maxActive() { return maxActive; } };
}

export function makeServices(adapter?: ProviderAdapter): { s: Services; dir: string; cleanup: () => Promise<void> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mao-test-'));
  const config = loadConfig({ dataDir: dir, masterKey: Buffer.alloc(32, 7).toString('base64'), ffmpegPath: 'ffmpeg-not-installed-for-tests' });
  const s = createServices(config, { extraAdapters: adapter ? [adapter] : [] });
  s.settings.set('runtime', { ...s.settings.get('runtime'), retryBaseDelayMs: 20 });
  return {
    s,
    dir,
    async cleanup() {
      await s.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export function seedTeam(s: Services, roles: string[] = ['ceo_assistant', 'project_manager', 'researcher', 'developer', 'content']) {
  const provider = s.providers.create({ type: 'mock', name: 'Mock', config: {}, credentials: { apiKey: 'sk-test-123456' }, enabled: true, maxConcurrency: 8 });
  const agents = roles.map((key) => s.agents.create({ name: `${key}-agent`, roleId: s.roles.findByKey(key)!.id, providerId: provider.id, model: 'claude-sonnet-5-5' }));
  return { provider, agents };
}

export async function waitFor(cond: () => boolean, timeoutMs = 8000, label = 'condition') {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export const isPlanner = (req: RunRequest) => req.system.includes('## Planning mode');
export const taskTitle = (prompt: string) => /# Your task: (.+)/.exec(prompt)?.[1]?.trim() ?? '';
