import fs from 'node:fs';
import { fetchWithTimeout, httpError, httpJson, rateLimitFromHeaders, sseData, trimSlash } from './http.js';
import {
  ProviderError,
  type BillingRow,
  type ChatMessage,
  type ProviderAdapter,
  type ProviderContext,
  type ProviderDescriptor,
  type RunRequest,
  type RunResult,
} from './types.js';

type Flavor = 'openai' | 'compatible' | 'ollama';

function baseUrl(ctx: ProviderContext, flavor: Flavor): string {
  const def = flavor === 'openai' ? 'https://api.openai.com/v1' : flavor === 'ollama' ? 'http://127.0.0.1:11434/v1' : '';
  const url = trimSlash(ctx.config.baseUrl || def);
  if (!url) throw new ProviderError('Base URL is not configured', false);
  return url;
}

function headers(ctx: ProviderContext, key = ctx.credentials.apiKey): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (key) h.authorization = `Bearer ${key}`;
  if (ctx.config.organization) h['OpenAI-Organization'] = ctx.config.organization;
  return h;
}

function toMessages(system: string, messages: ChatMessage[]) {
  const out: any[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.images?.length && m.role === 'user') {
      out.push({
        role: 'user',
        content: [
          ...m.images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mime};base64,${img.base64}` } })),
          { type: 'text', text: m.content },
        ],
      });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

function makeRun(flavor: Flavor) {
  return async function run(ctx: ProviderContext, req: RunRequest): Promise<RunResult> {
    const started = Date.now();
    const model = req.model || ctx.config.defaultModel;
    if (!model) throw new ProviderError('No model configured for this agent/provider', false);
    if (flavor === 'openai' && !ctx.credentials.apiKey) throw new ProviderError('OpenAI API key is not configured', false);
    const body: Record<string, unknown> = {
      model,
      messages: toMessages(req.system, req.messages),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.maxTokens) body[flavor === 'openai' ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens;
    if (ctx.config.reasoningEffort && flavor === 'openai') body.reasoning_effort = ctx.config.reasoningEffort;

    req.onStatus?.('request sent');
    const res = await fetchWithTimeout(`${baseUrl(ctx, flavor)}/chat/completions`, {
      method: 'POST',
      headers: headers(ctx),
      body: JSON.stringify(body),
      signal: req.signal,
      timeoutMs: req.timeoutMs ?? 15 * 60_000,
    });
    if (!res.ok) throw httpError(res.status, await res.text());

    let text = '';
    let usage: any = null;
    let servedModel = model;
    let finish: string | null = null;
    for await (const data of sseData(res)) {
      if (data === '[DONE]') break;
      let chunk: any;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      if (chunk.error) throw new ProviderError(chunk.error.message ?? 'Stream error', false);
      servedModel = chunk.model ?? servedModel;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta) {
        text += delta;
        req.onDelta?.(delta);
      }
      finish = chunk.choices?.[0]?.finish_reason ?? finish;
      if (chunk.usage) usage = chunk.usage;
    }
    return {
      text,
      model: servedModel,
      usage: usage
        ? {
            inputTokens: usage.prompt_tokens ?? 0,
            outputTokens: usage.completion_tokens ?? 0,
            cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
            reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
          }
        : undefined,
      rateLimit: rateLimitFromHeaders(res.headers, 'openai'),
      durationMs: Date.now() - started,
      meta: { finishReason: finish, usageReported: !!usage },
    };
  };
}

async function listModels(ctx: ProviderContext, flavor: Flavor): Promise<string[]> {
  if (flavor === 'ollama') {
    const root = baseUrl(ctx, flavor).replace(/\/v1$/, '');
    const { data } = await httpJson<{ models: { name: string }[] }>(`${root}/api/tags`, { timeoutMs: 8000 });
    return (data.models ?? []).map((m) => m.name);
  }
  const { data } = await httpJson<{ data: { id: string }[] }>(`${baseUrl(ctx, flavor)}/models`, {
    headers: headers(ctx),
    timeoutMs: 15000,
  });
  return (data.data ?? []).map((m) => m.id).sort();
}

function makeAdapter(flavor: Flavor, descriptor: ProviderDescriptor): ProviderAdapter {
  const run = makeRun(flavor);
  const adapter: ProviderAdapter = {
    descriptor,
    run,
    async checkConnection(ctx) {
      try {
        const models = await listModels(ctx, flavor);
        return { ok: true, message: `Connected – ${models.length} models available`, models };
      } catch (e: any) {
        return { ok: false, message: e?.message ?? String(e) };
      }
    },
    async describeMedia(ctx, media, prompt, signal) {
      const r = await run(ctx, {
        model: ctx.config.visionModel || undefined,
        system: 'You describe media precisely and factually for downstream AI agents.',
        messages: [{ role: 'user', content: prompt, images: [media] }],
        maxTokens: 3000,
        signal: signal ?? new AbortController().signal,
        permissions: {} as any,
      });
      return { text: r.text, usage: r.usage, model: r.model };
    },
  };
  if (flavor === 'openai') {
    adapter.transcribe = async (ctx, file, signal) => {
      if (!ctx.credentials.apiKey) throw new ProviderError('OpenAI API key is not configured', false);
      const model = ctx.config.transcriptionModel || 'whisper-1';
      const form = new FormData();
      form.append('model', model);
      form.append('file', new Blob([fs.readFileSync(file.path)], { type: file.mime }), file.name);
      const res = await fetchWithTimeout(`${baseUrl(ctx, flavor)}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ctx.credentials.apiKey}` },
        body: form,
        signal,
        timeoutMs: 10 * 60_000,
      });
      const text = await res.text();
      if (!res.ok) throw httpError(res.status, text);
      const json = JSON.parse(text);
      const u = json.usage;
      return {
        text: json.text ?? '',
        model,
        usage: u?.input_tokens != null ? { inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0 } : undefined,
      };
    };
    adapter.fetchBilling = async (ctx, from, to) => {
      const key = ctx.credentials.adminApiKey;
      if (!key) throw new ProviderError('Admin API key not configured – billing sync unavailable', false);
      const start = Math.floor(from.getTime() / 1000);
      const end = Math.floor(to.getTime() / 1000);
      const h = { authorization: `Bearer ${key}` };
      let totalUsd = 0;
      let page: string | undefined;
      do {
        const url: string = `https://api.openai.com/v1/organization/costs?start_time=${start}&end_time=${end}&bucket_width=1d&limit=31${page ? `&page=${page}` : ''}`;
        const { data }: { data: any } = await httpJson<any>(url, { headers: h, timeoutMs: 20000 });
        for (const bucket of data.data ?? []) for (const r of bucket.results ?? []) totalUsd += Number(r.amount?.value ?? 0);
        page = data.has_more ? data.next_page : undefined;
      } while (page);
      let inTok = 0;
      let outTok = 0;
      let reqs = 0;
      page = undefined;
      do {
        const url: string = `https://api.openai.com/v1/organization/usage/completions?start_time=${start}&end_time=${end}&bucket_width=1d&limit=31${page ? `&page=${page}` : ''}`;
        const { data }: { data: any } = await httpJson<any>(url, { headers: h, timeoutMs: 20000 });
        for (const bucket of data.data ?? [])
          for (const r of bucket.results ?? []) {
            inTok += Number(r.input_tokens ?? 0);
            outTok += Number(r.output_tokens ?? 0);
            reqs += Number(r.num_model_requests ?? 0);
          }
        page = data.has_more ? data.next_page : undefined;
      } while (page);
      const period = { periodStart: from.toISOString(), periodEnd: to.toISOString() };
      const rows: BillingRow[] = [
        { metric: 'api_cost', label: 'API cost (OpenAI costs API)', used: Math.round(totalUsd * 10000) / 10000, unit: 'usd', ...period },
        { metric: 'api_tokens', label: 'API tokens (in+out)', used: inTok + outTok, unit: 'tokens', ...period },
        { metric: 'api_requests', label: 'API requests', used: reqs, unit: 'requests', ...period },
      ];
      return rows;
    };
  }
  return adapter;
}

const caps = {
  streaming: true,
  vision: true,
  transcription: false,
  video: false,
  agenticTools: false,
  usageReporting: 'tokens' as const,
  billingApi: false,
  rateLimitHeaders: true,
  subscriptionQuotaApi: false,
};

export const openaiAdapter = makeAdapter('openai', {
  type: 'openai-api',
  displayName: 'OpenAI (API)',
  vendor: 'OpenAI',
  integration: 'api',
  description:
    'OpenAI models via the official REST API (Chat Completions + Audio transcription). Billed per token on platform.openai.com – separate from ChatGPT Plus/Pro.',
  configFields: [
    { key: 'defaultModel', label: 'Default model', type: 'text', placeholder: 'e.g. gpt-5' },
    { key: 'reasoningEffort', label: 'Reasoning effort', type: 'select', options: ['', 'minimal', 'low', 'medium', 'high'] },
    { key: 'transcriptionModel', label: 'Transcription model', type: 'text', placeholder: 'whisper-1', default: 'whisper-1' },
    { key: 'visionModel', label: 'Vision model (media analysis)', type: 'text', placeholder: 'defaults to default model' },
    { key: 'organization', label: 'Organization ID (optional)', type: 'text' },
    { key: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: 'https://api.openai.com/v1' },
  ],
  credentialFields: [
    { key: 'apiKey', label: 'API key', type: 'password', required: true, placeholder: 'sk-…' },
    { key: 'adminApiKey', label: 'Admin key (optional, for costs/usage sync)', type: 'password', placeholder: 'sk-admin-…' },
  ],
  capabilities: { ...caps, transcription: true, billingApi: true },
  suggestedModels: [],
  limitations: [
    'API usage does not consume or reveal ChatGPT Plus/Pro subscription limits.',
    'Cost per request is estimated from the pricing table you configure; exact spend comes from the Costs API (admin key).',
  ],
  canExecute: true,
});

export const openaiCompatibleAdapter = makeAdapter('compatible', {
  type: 'openai-compatible',
  displayName: 'OpenAI-compatible endpoint',
  vendor: 'Any (OpenRouter, LM Studio, vLLM, Groq, DeepSeek…)',
  integration: 'api',
  description: 'Any server implementing the OpenAI Chat Completions API. Use it to plug in new providers without code.',
  configFields: [
    { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, placeholder: 'https://openrouter.ai/api/v1' },
    { key: 'defaultModel', label: 'Default model', type: 'text', required: true },
    { key: 'visionModel', label: 'Vision model (optional)', type: 'text' },
  ],
  credentialFields: [{ key: 'apiKey', label: 'API key (if required)', type: 'password' }],
  capabilities: { ...caps, rateLimitHeaders: false },
  suggestedModels: [],
  limitations: ['Token usage is only recorded when the server returns a `usage` block.', 'Vision only works with vision-capable models.'],
  canExecute: true,
});

export const ollamaAdapter = makeAdapter('ollama', {
  type: 'ollama',
  displayName: 'Ollama (local models)',
  vendor: 'Ollama',
  integration: 'local-server',
  description: 'Local open-weight models served by Ollama. No cost, no quota – limited by your hardware.',
  configFields: [
    { key: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'http://127.0.0.1:11434/v1', default: 'http://127.0.0.1:11434/v1' },
    { key: 'defaultModel', label: 'Default model', type: 'text', required: true, placeholder: 'qwen2.5:7b' },
    { key: 'visionModel', label: 'Vision model (optional)', type: 'text', placeholder: 'llava' },
  ],
  credentialFields: [],
  capabilities: { ...caps, rateLimitHeaders: false },
  suggestedModels: [],
  limitations: ['Runs on local hardware: keep concurrency low (1–2) on consumer GPUs/CPUs.'],
  canExecute: true,
});
