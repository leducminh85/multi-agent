import fs from 'node:fs';
import { fetchWithTimeout, httpError, httpJson, sseData, trimSlash } from './http.js';
import { ProviderError, type ChatMessage, type ProviderAdapter, type ProviderContext, type RunRequest, type RunResult } from './types.js';

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function base(ctx: ProviderContext) {
  return trimSlash(ctx.config.baseUrl || DEFAULT_BASE);
}

function key(ctx: ProviderContext) {
  const k = ctx.credentials.apiKey;
  if (!k) throw new ProviderError('Gemini API key is not configured', false);
  return k;
}

function toContents(messages: ChatMessage[]) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(m.images ?? []).map((img) => ({ inlineData: { mimeType: img.mime, data: img.base64 } })),
      { text: m.content },
    ],
  }));
}

async function run(ctx: ProviderContext, req: RunRequest): Promise<RunResult> {
  const started = Date.now();
  const model = req.model || ctx.config.defaultModel;
  if (!model) throw new ProviderError('No Gemini model configured', false);
  const body: any = {
    contents: toContents(req.messages),
    generationConfig: { maxOutputTokens: req.maxTokens ?? 16000 },
  };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  req.onStatus?.('request sent');
  const res = await fetchWithTimeout(`${base(ctx)}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key(ctx) },
    body: JSON.stringify(body),
    signal: req.signal,
    timeoutMs: req.timeoutMs ?? 15 * 60_000,
  });
  if (!res.ok) throw httpError(res.status, await res.text());
  let text = '';
  let usage: any = null;
  let blockReason: string | undefined;
  for await (const data of sseData(res)) {
    let chunk: any;
    try {
      chunk = JSON.parse(data);
    } catch {
      continue;
    }
    if (chunk.error) throw new ProviderError(chunk.error.message ?? 'Gemini stream error', false);
    blockReason = chunk.promptFeedback?.blockReason ?? blockReason;
    for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.text === 'string' && !part.thought) {
        text += part.text;
        req.onDelta?.(part.text);
      }
    }
    if (chunk.usageMetadata) usage = chunk.usageMetadata;
  }
  if (!text && blockReason) throw new ProviderError(`Gemini blocked the prompt: ${blockReason}`, false);
  return {
    text,
    model,
    usage: usage
      ? {
          inputTokens: usage.promptTokenCount ?? 0,
          outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
          cacheReadTokens: usage.cachedContentTokenCount ?? 0,
          reasoningTokens: usage.thoughtsTokenCount ?? 0,
        }
      : undefined,
    durationMs: Date.now() - started,
  };
}

const INLINE_LIMIT = 18 * 1024 * 1024;

export const geminiAdapter: ProviderAdapter = {
  descriptor: {
    type: 'gemini-api',
    displayName: 'Google Gemini (API)',
    vendor: 'Google',
    integration: 'api',
    description:
      'Gemini models through the Gemini Developer API (AI Studio key). Natively understands images, audio and video. Billed separately from Google AI Pro/Ultra and Antigravity plans.',
    configFields: [
      { key: 'defaultModel', label: 'Default model', type: 'text', required: true, placeholder: 'e.g. gemini-2.5-flash' },
      { key: 'baseUrl', label: 'Base URL (optional)', type: 'text', placeholder: DEFAULT_BASE },
    ],
    credentialFields: [{ key: 'apiKey', label: 'API key', type: 'password', required: true }],
    capabilities: {
      streaming: true,
      vision: true,
      transcription: true,
      video: true,
      agenticTools: false,
      usageReporting: 'tokens',
      billingApi: false,
      rateLimitHeaders: false,
      subscriptionQuotaApi: false,
    },
    suggestedModels: [],
    limitations: [
      'No public billing/usage API for API keys – cost is estimated from tokens × your pricing table; check Google Cloud Billing for exact spend.',
      `Audio/video are sent inline; files larger than ${INLINE_LIMIT / 1024 / 1024} MB need ffmpeg pre-processing (done automatically when ffmpeg is installed).`,
    ],
    canExecute: true,
  },
  run,
  async checkConnection(ctx) {
    try {
      const { data } = await httpJson<any>(`${base(ctx)}/models?pageSize=200`, {
        headers: { 'x-goog-api-key': key(ctx) },
        timeoutMs: 15000,
      });
      const models = (data.models ?? []).map((m: any) => String(m.name).replace(/^models\//, ''));
      return { ok: true, message: `Connected – ${models.length} models available`, models };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  },
  async transcribe(ctx, file, signal) {
    const stat = fs.statSync(file.path);
    if (stat.size > INLINE_LIMIT) throw new ProviderError('Audio file too large for inline transcription', false);
    const r = await run(ctx, {
      system: 'You are a precise transcription engine.',
      messages: [
        {
          role: 'user',
          content: 'Transcribe this audio verbatim in its original language. Output only the transcript.',
          images: [{ mime: file.mime, base64: fs.readFileSync(file.path).toString('base64') }],
        },
      ],
      maxTokens: 16000,
      signal: signal ?? new AbortController().signal,
      permissions: {} as any,
    });
    return { text: r.text, usage: r.usage, model: r.model };
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
};
