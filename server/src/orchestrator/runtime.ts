import type { Agent, AgentActivity, AgentService } from '../agents/service.js';
import type { ActivityService } from '../core/activity.js';
import type { ProviderService } from '../providers/service.js';
import { formatReset, parseQuota } from '../providers/quota.js';
import { ProviderError, type ChatMessage, type RunResult } from '../providers/types.js';
import type { UsageService } from '../usage/service.js';

export interface InvokeOptions {
  system: string;
  messages: ChatMessage[];
  signal: AbortSignal;
  cwd?: string;
  taskId?: string | null;
  missionId?: string | null;
  onDelta?: (text: string) => void;
  onStatus?: (status: string) => void;
  /** Called when the agent's AI is out of quota and the run moves to another connected AI. */
  onFailover?: (info: { fromId: string; fromName: string; toId: string; toName: string; reason: string }) => void;
}

/** Thrown when every usable AI is out of quota. */
export class QuotaError extends ProviderError {
  constructor(
    message: string,
    readonly providerName: string,
    readonly resetAt: Date,
  ) {
    super(message, false);
  }
}

/**
 * Agent Runtime Manager: executes a single agent invocation against its provider adapter.
 * Responsible for limits, usage accounting, rate-limit capture, provider health and the
 * agent's visible activity. Execution is in-process; adapters for CLI providers spawn
 * isolated child processes confined to the project workspace.
 */
export class AgentRuntime {
  private revertTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private agents: AgentService,
    private providers: ProviderService,
    private usage: UsageService,
    private activity: ActivityService,
  ) {}

  /** Why an agent cannot run right now (null = can run). */
  unavailableReason(agent: Agent): string | null {
    if (!agent.enabled) return 'agent disabled';
    if (agent.paused) return 'agent paused';
    if (!agent.providerId) return 'no provider configured';
    const p = this.providers.get(agent.providerId);
    if (!p.enabled) return `provider ${p.name} disabled`;
    if (!p.canExecute) return `provider ${p.name} is tracking-only`;
    if (agent.limits.dailyTokenBudget && this.usage.agentTokensToday(agent.id) >= agent.limits.dailyTokenBudget) return 'daily token budget exhausted';
    const cd = this.providers.cooldown(p.id);
    if (cd && !this.fallbackProvider([p.id])) return `${p.name} is out of quota – resets in ${formatReset(cd.until)}`;
    return null;
  }

  /** Another connected AI that can take over (not in cooldown, not excluded). Connected ones first. */
  fallbackProvider(exclude: string[]) {
    const candidates = this.providers
      .list()
      .filter((p) => p.enabled && p.canExecute && !exclude.includes(p.id) && !this.providers.cooldown(p.id));
    return candidates.find((p) => p.status === 'connected') ?? candidates.find((p) => p.status !== 'error') ?? null;
  }

  async invoke(agent: Agent, opts: InvokeOptions): Promise<RunResult> {
    if (!agent.providerId) throw new ProviderError(`Agent ${agent.name} has no provider`, false);
    const tried: string[] = [];
    let providerId = agent.providerId;
    // Agent's own AI already known to be out of quota → go straight to another AI.
    const cd = this.providers.cooldown(providerId);
    if (cd) {
      const name = this.providers.get(providerId).name;
      const reason = `${name} is out of quota – resets in ${formatReset(cd.until)}`;
      const fb = this.fallbackProvider([providerId]);
      if (!fb) throw new QuotaError(reason, name, cd.until);
      opts.onFailover?.({ fromId: providerId, fromName: name, toId: fb.id, toName: fb.name, reason });
      opts.onStatus?.(`${this.providers.get(providerId).name} is out of quota – using ${fb.name}`);
      tried.push(providerId);
      providerId = fb.id;
    }
    for (;;) {
      try {
        return await this.invokeOn(agent, providerId, providerId === agent.providerId ? agent.model || undefined : undefined, opts);
      } catch (e: any) {
        const q = opts.signal.aborted ? null : parseQuota(String(e?.message ?? e));
        if (!q) throw e;
        const name = this.providers.get(providerId).name;
        const message = `${name} is out of quota${q.rateLimit ? ' (rate limit)' : ''} – resets in ${formatReset(q.resetAt)}${q.exact ? '' : ' (estimated)'}`;
        this.providers.setCooldown(providerId, q.resetAt, message);
        this.activity.record({ type: 'provider.quota', level: 'warning', message, providerId, agentId: agent.id, taskId: opts.taskId ?? null, missionId: opts.missionId ?? null });
        tried.push(providerId);
        const fb = this.fallbackProvider(tried);
        if (!fb) throw new QuotaError(message, name, q.resetAt);
        opts.onFailover?.({ fromId: providerId, fromName: name, toId: fb.id, toName: fb.name, reason: message });
        opts.onStatus?.(`${name} is out of quota – switching to ${fb.name}`);
        providerId = fb.id;
      }
    }
  }

  private async invokeOn(agent: Agent, providerId: string, model: string | undefined, opts: InvokeOptions): Promise<RunResult> {
    const ctx = this.providers.context(providerId);
    const adapter = this.providers.registry.get(ctx.type);
    if (!adapter.descriptor.canExecute) throw new ProviderError(`Provider ${ctx.name} cannot execute tasks`, false);
    const images = adapter.descriptor.capabilities.vision || adapter.descriptor.capabilities.agenticTools;
    const messages = images ? opts.messages : opts.messages.map((m) => ({ ...m, images: undefined }));
    try {
      const result = await adapter.run(ctx, {
        model,
        system: opts.system,
        messages,
        maxTokens: agent.limits.maxOutputTokens,
        timeoutMs: agent.limits.timeoutMs,
        signal: opts.signal,
        cwd: opts.cwd,
        permissions: agent.permissions,
        onDelta: opts.onDelta,
        onStatus: opts.onStatus,
      });
      this.account(agent, ctx.providerId, ctx.type, result.model ?? model ?? ctx.config.defaultModel, result, opts);
      if (result.rateLimit) this.providers.recordRateLimit(ctx.providerId, result.rateLimit);
      const p = this.providers.get(ctx.providerId);
      this.providers.clearCooldown(ctx.providerId);
      if (p.status !== 'connected') this.providers.setStatus(ctx.providerId, 'connected', 'Last request succeeded');
      return result;
    } catch (e: any) {
      if (e?.usage) this.account(agent, ctx.providerId, ctx.type, model ?? ctx.config.defaultModel, { usage: e.usage, text: '', durationMs: 0 }, opts);
      if (e instanceof ProviderError && (e.status === 401 || e.status === 403 || /not found – is the CLI installed|Authentication failed/i.test(e.message))) {
        this.providers.setStatus(ctx.providerId, 'error', e.message);
      }
      throw e;
    }
  }

  private account(agent: Agent, providerId: string, providerType: string, model: string | undefined, r: Pick<RunResult, 'usage' | 'costUsd' | 'costSource' | 'durationMs' | 'text' | 'subscription'>, opts: InvokeOptions) {
    this.usage.record({
      providerId,
      providerType,
      agentId: agent.id,
      taskId: opts.taskId ?? null,
      missionId: opts.missionId ?? null,
      model: model ?? null,
      usage: r.usage,
      costUsd: r.costUsd,
      costReported: r.costSource === 'reported',
      subscription: r.subscription,
      source: this.providers.registry.get(providerType).descriptor.integration === 'cli' ? 'cli_report' : 'api_response',
      durationMs: r.durationMs,
    });
  }

  /** Set visible activity; transient states revert to idle after `revertMs` unless something else happened. */
  setActivity(agentId: string, activity: AgentActivity, detail: string | null, opts: { currentTaskId?: string | null; revertMs?: number } = {}) {
    const prev = this.revertTimers.get(agentId);
    if (prev) clearTimeout(prev);
    this.revertTimers.delete(agentId);
    this.agents.setActivity(agentId, activity, detail, opts.currentTaskId);
    if (opts.revertMs) {
      const t = setTimeout(() => {
        this.revertTimers.delete(agentId);
        const a = this.agents.find(agentId);
        if (a && a.activity === activity && !a.currentTaskId) this.agents.setActivity(agentId, 'idle', null);
      }, opts.revertMs);
      t.unref?.();
      this.revertTimers.set(agentId, t);
    }
  }

  /** Two agents exchanging messages: show them in the meeting room while idle. */
  markDiscussing(agentIds: string[], topic: string) {
    for (const id of agentIds) {
      const a = this.agents.find(id);
      if (!a || a.currentTaskId) continue;
      this.setActivity(id, 'discussing', topic, { revertMs: 12_000 });
    }
  }

  dispose() {
    for (const t of this.revertTimers.values()) clearTimeout(t);
    this.revertTimers.clear();
  }
}
