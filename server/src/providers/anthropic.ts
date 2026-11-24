import Anthropic from '@anthropic-ai/sdk';
import { rateLimitFromHeaders } from './http.js';
import {
  ProviderError,
  type BillingRow,
  type ChatMessage,
  type ProviderAdapter,
  type ProviderContext,
  type RunRequest,
  type RunResult,
} from './types.js';

const DEFAULT_MODEL = 'claude-opus-5-5';
/** Models that support the server-side refusal fallback beta. */
const FALLBACK_MODELS = /^(claude-opus-5-5|claude-opus-5|claude-fable-5-[12]|claude-sonnet-5-5)$/;

function client(ctx: ProviderContext, key = ctx.credentials.apiKey): Anthropic {
  if (!key) throw new ProviderError('Anthropic API key is not configured', false);
  return new Anthropic({ apiKey: key, baseURL: ctx.config.baseUrl || undefined, maxRetries: 1 });
}

function toMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (!m.images?.length || m.role !== 'user') return { role: m.role, content: m.content };
    const blocks: Anthropic.ContentBlockParam[] = m.images.map((img) => ({
      type: 'image',
      source: { type: 'base64', media_type: img.mime as 'image/png', data: img.base64 },
    }));
    blocks.push({ type: 'text', text: m.content });
    return { role: m.role, content: blocks };
  });
}

function mapError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new ProviderError('Request cancelled', false);
  if (e instanceof Anthropic.RateLimitError) return new ProviderError(`Rate limited: ${e.message}`, true, 429);
  if (e instanceof Anthropic.AuthenticationError) return new ProviderError(`Authentication failed: ${e.message}`, false, 401);
  if (e instanceof Anthropic.NotFoundError) return new ProviderError(`Not found (check model id): ${e.message}`, false, 404);
  if (e instanceof Anthropic.BadRequestError) return new ProviderError(`Bad request: ${e.message}`, false, 400);
  if (e instanceof Anthropic.APIConnectionError) return new ProviderError(`Connection error: ${e.message}`, true);
  if (e instanceof Anthropic.APIError) {
    const status = e.status ?? 0;
    return new ProviderError(e.message, status >= 500 || status === 408 || status === 409, status);
  }
  return new ProviderError(e instanceof Error ? e.message : String(e), false);
}

async function run(ctx: ProviderContext, req: RunRequest): Promise<RunResult> {
  const started = Date.now();
  const model = req.model || ctx.config.defaultModel || DEFAULT_MODEL;
  const anthropic = client(ctx);
  const useFallback = ctx.config.serverSideFallback !== false && FALLBACK_MODELS.test(model);
  const params: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens ?? 16000,
    system: req.system,
    messages: toMessages(req.messages),
    stream: true,
  };
  if (ctx.config.effort) params.output_config = { effort: ctx.config.effort };
  if (useFallback) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let stopReason: string | null = null;
  let stopDetails: any = null;
  let servedModel = model;
  try {
    req.onStatus?.('request sent');
    const api: any = useFallback ? anthropic.beta.messages : anthropic.messages;
    const { data: stream, response } = await api.create(params, { signal: req.signal }).withResponse();
    for await (const ev of stream as AsyncIterable<any>) {
      switch (ev.type) {
        case 'message_start':
          servedModel = ev.message?.model ?? servedModel;
          inputTokens = ev.message?.usage?.input_tokens ?? 0;
          cacheRead = ev.message?.usage?.cache_read_input_tokens ?? 0;
          cacheWrite = ev.message?.usage?.cache_creation_input_tokens ?? 0;
          outputTokens = ev.message?.usage?.output_tokens ?? 0;
          break;
        case 'content_block_delta':
          if (ev.delta?.type === 'text_delta') {
            text += ev.delta.text;
            req.onDelta?.(ev.delta.text);
          }
          break;
        case 'message_delta':
          if (ev.usage?.output_tokens != null) outputTokens = ev.usage.output_tokens;
          if (ev.usage?.input_tokens != null) inputTokens = ev.usage.input_tokens;
          stopReason = ev.delta?.stop_reason ?? stopReason;
          stopDetails = ev.delta?.stop_details ?? stopDetails;
          break;
      }
    }
    const usage = { inputTokens, outputTokens, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite };
    if (stopReason === 'refusal') {
      const err = new ProviderError(
        `Model declined the request (refusal${stopDetails?.category ? `: ${stopDetails.category}` : ''})`,
        false,
      );
      (err as any).usage = usage;
      throw err;
    }
    return {
      text,
      model: servedModel,
      usage,
      rateLimit: rateLimitFromHeaders(response.headers, 'anthropic'),
      durationMs: Date.now() - started,
      meta: { stopReason },
    };
  } catch (e) {
    throw mapError(e);
  }
}

export const anthropicAdapter: ProviderAdapter = {
  descriptor: {
    type: 'anthropic-api',
    displayName: 'Anthropic Claude (API)',
    vendor: 'Anthropic',
    integration: 'api',
    description:
      'Claude models through the official Anthropic Messages API (official TypeScript SDK). Billed per token on your Console account – separate from Claude Pro/Max subscriptions.',
    configFields: [
      { key: 'defaultModel', label: 'Default model', type: 'text', placeholder: DEFAULT_MODEL, default: DEFAULT_MODEL },
      { key: 'effort', label: 'Effort', type: 'select', options: ['', 'low', 'medium', 'high', 'xhigh', 'max'], help: 'output_config.effort – leave empty for model default' },
      { key: 'serverSideFallback', label: 'Server-side refusal fallback', type: 'boolean', default: true, help: 'Re-routes refused requests to a fallback model (beta, supported models only)' },
      { key: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.anthropic.com' },
    ],
    credentialFields: [
      { key: 'apiKey', label: 'API key', type: 'password', required: true, placeholder: 'sk-ant-…' },
      { key: 'adminApiKey', label: 'Admin API key (optional, for cost/usage sync)', type: 'password', placeholder: 'sk-ant-admin…' },
    ],
    capabilities: {
      streaming: true,
      vision: true,
      transcription: false,
      video: false,
      agenticTools: false,
      usageReporting: 'tokens',
      billingApi: true,
      rateLimitHeaders: true,
      subscriptionQuotaApi: false,
    },
    suggestedModels: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-2'],
    limitations: [
      'API usage is billed per token; it does NOT consume or reveal Claude Pro/Max subscription limits.',
      'Cost per request is estimated from the pricing table (the API reports tokens, not dollars). Exact spend comes from the Admin cost API (admin key required).',
    ],
    canExecute: true,
  },
  run,
  async checkConnection(ctx) {
    try {
      const page = await client(ctx).models.list({ limit: 50 });
      const models = page.data.map((m) => m.id);
      return { ok: true, message: `Connected – ${models.length} models available`, models };
    } catch (e) {
      return { ok: false, message: mapError(e).message };
    }
  },
  async describeMedia(ctx, media, prompt, signal) {
    const r = await run(ctx, {
      system: 'You describe media precisely and factually for downstream AI agents.',
      messages: [{ role: 'user', content: prompt, images: [media] }],
      maxTokens: 4000,
      signal: signal ?? new AbortController().signal,
      permissions: {} as any,
    });
    return { text: r.text, usage: r.usage, model: r.model };
  },
  async fetchBilling(ctx, from, to): Promise<BillingRow[]> {
    const adminKey = ctx.credentials.adminApiKey;
    if (!adminKey) throw new ProviderError('Admin API key not configured – billing sync unavailable', false);
    const admin: any = client(ctx, adminKey);
    const rows: BillingRow[] = [];
    try {
      let total = 0;
      const iter = admin.beta.organization.analytics.cost.list({
        starting_at: from.toISOString(),
        ending_at: to.toISOString(),
      });
      for await (const row of iter as AsyncIterable<any>) {
        const amount = Number(row?.amount?.value ?? row?.amount ?? row?.cost_usd ?? row?.cost ?? 0);
        if (Number.isFinite(amount)) total += amount;
      }
      rows.push({
        metric: 'api_cost',
        label: 'API cost (Anthropic analytics)',
        used: Math.round(total * 10000) / 10000,
        unit: 'usd',
        periodStart: from.toISOString(),
        periodEnd: to.toISOString(),
        note: 'From /v1/organizations/analytics/cost (beta). Data may lag several hours.',
      });
    } catch (e) {
      throw mapError(e);
    }
    return rows;
  },
};
