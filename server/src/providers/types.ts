import type { AgentPermissions } from '../agents/permissions.js';

export type IntegrationKind = 'api' | 'cli' | 'local-server' | 'tracking-only';

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
  default?: string | number | boolean;
}

export interface ProviderCapabilities {
  /** Streams partial output while running. */
  streaming: boolean;
  /** Accepts images as input. */
  vision: boolean;
  /** Can transcribe audio files. */
  transcription: boolean;
  /** Can analyse video natively. */
  video: boolean;
  /** Runs an agent loop with real tools (shell, file edits) inside a workspace. */
  agenticTools: boolean;
  /** What the provider reports per request. */
  usageReporting: 'tokens' | 'tokens+cost' | 'none';
  /** Organisation billing / usage API available (needs admin credential). */
  billingApi: boolean;
  /** Rate-limit headers returned per request. */
  rateLimitHeaders: boolean;
  /** Official API exposing consumer-subscription quota (Pro/Max/Plus…). Currently false for every vendor. */
  subscriptionQuotaApi: boolean;
}

export interface ProviderDescriptor {
  type: string;
  displayName: string;
  vendor: string;
  integration: IntegrationKind;
  description: string;
  configFields: FieldDef[];
  credentialFields: FieldDef[];
  capabilities: ProviderCapabilities;
  suggestedModels: string[];
  /** Honest list of what this integration can NOT do. */
  limitations: string[];
  /** false = provider can be configured for tracking but cannot execute tasks */
  canExecute: boolean;
}

export interface InputImage {
  mime: string;
  base64: string;
  name?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  images?: InputImage[];
}

export interface RateLimitInfo {
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsReset?: string;
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensReset?: string;
  capturedAt: string;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

export interface RunRequest {
  model?: string;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  signal: AbortSignal;
  /** Working directory for CLI agents (project workspace). */
  cwd?: string;
  permissions: AgentPermissions;
  timeoutMs?: number;
  onDelta?: (text: string) => void;
  onStatus?: (status: string) => void;
}

export interface RunResult {
  text: string;
  model?: string;
  usage?: UsageInfo;
  costUsd?: number;
  /** 'reported' = the provider returned the cost; otherwise we estimate from pricing table. */
  costSource?: 'reported';
  /** Run on a flat-rate subscription login: no per-request spend, so no cost is recorded or estimated. */
  subscription?: boolean;
  rateLimit?: RateLimitInfo;
  durationMs: number;
  meta?: Record<string, unknown>;
}

export interface ProviderContext {
  providerId: string;
  config: Record<string, any>;
  credentials: Record<string, string>;
}

export interface ConnectionCheck {
  ok: boolean;
  message: string;
  models?: string[];
  details?: Record<string, unknown>;
}

export interface BillingRow {
  metric: string;
  label: string;
  used: number;
  unit: 'usd' | 'tokens' | 'requests';
  periodStart: string;
  periodEnd: string;
  note?: string;
}

export interface ProviderAdapter {
  descriptor: ProviderDescriptor;
  run(ctx: ProviderContext, req: RunRequest): Promise<RunResult>;
  checkConnection(ctx: ProviderContext): Promise<ConnectionCheck>;
  /** Organisation billing data via the vendor's official API (admin credential). */
  fetchBilling?(ctx: ProviderContext, from: Date, to: Date): Promise<BillingRow[]>;
  transcribe?(ctx: ProviderContext, file: { path: string; mime: string; name: string }, signal?: AbortSignal): Promise<{ text: string; usage?: UsageInfo; model?: string }>;
  /** Describe an image or video (inline). */
  describeMedia?(ctx: ProviderContext, media: InputImage, prompt: string, signal?: AbortSignal): Promise<{ text: string; usage?: UsageInfo; model?: string }>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
  }
}
