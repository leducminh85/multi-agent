import { anthropicAdapter } from './anthropic.js';
import { antigravityCliAdapter, claudeCliAdapter, codexCliAdapter } from './cliAdapters.js';
import { geminiAdapter } from './gemini.js';
import { ollamaAdapter, openaiAdapter, openaiCompatibleAdapter } from './openai.js';
import { ProviderError, type ProviderAdapter } from './types.js';

/** Tracking-only provider: holds a subscription account for quota monitoring, cannot run tasks. */
export const subscriptionTrackerAdapter: ProviderAdapter = {
  descriptor: {
    type: 'subscription-tracker',
    displayName: 'Subscription account (tracking only)',
    vendor: 'Any',
    integration: 'tracking-only',
    description:
      'Represents a consumer subscription (Claude Pro/Max, ChatGPT Plus/Pro, Google AI Pro/Antigravity…) whose quota has no official API. Record usage/limits manually; alerts work the same way.',
    configFields: [
      { key: 'vendor', label: 'Vendor', type: 'select', options: ['Anthropic', 'OpenAI', 'Google', 'Other'] },
      { key: 'dashboardUrl', label: 'Official usage page (for reference)', type: 'text', placeholder: 'https://…' },
    ],
    credentialFields: [],
    capabilities: {
      streaming: false,
      vision: false,
      transcription: false,
      video: false,
      agenticTools: false,
      usageReporting: 'none',
      billingApi: false,
      rateLimitHeaders: false,
      subscriptionQuotaApi: false,
    },
    suggestedModels: [],
    limitations: ['Cannot execute tasks.', 'All quota values come from manual entries – shown with source "manual".'],
    canExecute: false,
  },
  async run() {
    throw new ProviderError('This provider is tracking-only and cannot execute tasks', false);
  },
  async checkConnection() {
    return { ok: true, message: 'Tracking-only account (no connection to test)' };
  },
};

/** Test-only adapter registered by the test-suite (never part of the production registry). */
export class ProviderRegistry {
  private adapters = new Map<string, ProviderAdapter>();

  constructor(adapters: ProviderAdapter[] = DEFAULT_ADAPTERS) {
    for (const a of adapters) this.register(a);
  }

  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.descriptor.type, adapter);
  }

  get(type: string): ProviderAdapter {
    const a = this.adapters.get(type);
    if (!a) throw new ProviderError(`Unknown provider type "${type}"`, false);
    return a;
  }

  has(type: string): boolean {
    return this.adapters.has(type);
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }
}

export const DEFAULT_ADAPTERS: ProviderAdapter[] = [
  anthropicAdapter,
  claudeCliAdapter,
  openaiAdapter,
  codexCliAdapter,
  geminiAdapter,
  antigravityCliAdapter,
  ollamaAdapter,
  openaiCompatibleAdapter,
  subscriptionTrackerAdapter,
];
