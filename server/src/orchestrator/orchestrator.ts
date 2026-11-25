import type { Agent, AgentActivity, AgentService } from '../agents/service.js';
import type { RoleService } from '../agents/roles.js';
import type { CommsService } from '../comms/service.js';
import type { ActivityService } from '../core/activity.js';
import type { AuditService } from '../core/audit.js';
import type { EventBus } from '../core/eventBus.js';
import type { SettingsService } from '../core/settings.js';
import { HttpError, errorMessage, nowIso, truncate } from '../core/util.js';
import type { FileService } from '../files/service.js';
import type { KnowledgeService } from '../knowledge/service.js';
import type { ProjectService } from '../projects/service.js';
import type { ProviderService } from '../providers/service.js';
import { ProviderError } from '../providers/types.js';
import type { ApprovalService } from './approvals.js';
import type { ContextBuilder } from './context.js';
import { extractJson, parseAgentOutput, validatePlan, type AgentActions, type Plan } from './protocol.js';
import { QuotaError, type AgentRuntime } from './runtime.js';
import { ACTIVE, TERMINAL, type ExtraContext, type Mission, type Store, type Task, type TaskStep } from './store.js';

export interface OrchestratorDeps {
  store: Store;
  agents: AgentService;
  roles: RoleService;
  providers: ProviderService;
  runtime: AgentRuntime;
  context: ContextBuilder;
  comms: CommsService;
  knowledge: KnowledgeService;
  files: FileService;
  projects: ProjectService;
  approvals: ApprovalService;
  settings: SettingsService;
  activity: ActivityService;
  audit: AuditService;
  bus: EventBus;
}

export interface SubmitMissionInput {
  text: string;
  title?: string;
  projectId?: string;
  fileIds?: string[];
  mode?: 'auto' | 'direct';
  agentId?: string;
}

const WAIT_HELP = 'help from';
const WAIT_MANAGER = 'manager answer';
const WAIT_APPROVAL = 'approval';
const MAX_RESUME_ROUNDS = 2;
const WAIT_RECOVERY = 'project manager is reviewing the failure';
const RECOVERY_LABEL = 'Recovery plan';
const MAX_RECOVERY_ROUNDS = 2;

/**
 * Central orchestrator: request → plan → tasks (DAG) → agent assignment → execution →
 * collaboration (messages, help requests, questions, approvals) → retries → synthesis → report.
 * The database is the single source of truth, so the scheduler can be restarted at any time.
 */
export class Orchestrator {
  private controllers = new Map<string, { ctrl: AbortController; agentId: string }>();
  private planControllers = new Map<string, AbortController>();
  private ticking = false;
  private tickQueued = false;
  private interval?: NodeJS.Timeout;
  private timers = new Set<NodeJS.Timeout>();
  private inflight = new Set<Promise<unknown>>();

  constructor(private d: OrchestratorDeps) {}

  // ======================================================================
  // lifecycle
  // ======================================================================
  start(): void {
    this.recover();
    this.interval = setInterval(() => void this.tick(), 5000);
    this.interval.unref?.();
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval);
    for (const t of this.timers) clearTimeout(t);
    for (const { ctrl } of this.controllers.values()) ctrl.abort();
    for (const c of this.planControllers.values()) c.abort();
    await Promise.allSettled([...this.inflight]);
  }

  /** Wait until every in-flight run/plan finished (used by tests). */
  async idle(timeoutMs = 15000): Promise<void> {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (!this.inflight.size && !this.ticking) {
        await new Promise((r) => setTimeout(r, 20));
        if (!this.inflight.size) return;
      }
      await Promise.race([Promise.allSettled([...this.inflight]), new Promise((r) => setTimeout(r, 50))]);
    }
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.inflight.add(p);
    p.finally(() => this.inflight.delete(p)).catch(() => undefined);
    return p;
  }

  private recover(): void {
    for (const t of this.d.store.listTasks({ status: ACTIVE })) {
      this.d.store.appendError(t.id, 'Interrupted by server restart – re-queued');
      this.d.store.closeOpenSteps(t.id);
      this.d.store.updateTask(t.id, { status: 'pending', attempts: Math.max(0, t.attempts - 1) });
    }
    for (const a of this.d.agents.list()) if (a.activity !== 'idle' || a.currentTaskId) this.d.agents.setActivity(a.id, 'idle', null, null);
    // A failure review interrupted by the restart: run it again.
    for (const t of this.d.store.listTasks({ status: ['waiting'] }).filter((x) => x.waitingReason === WAIT_RECOVERY)) {
      const failed = (t.agentId && this.d.agents.find(t.agentId)) || this.d.agents.list()[0];
      if (failed) this.track(this.recoverTask(t.id, failed));
      else this.failTask(t.id);
    }
    for (const m of this.d.store.listMissions({ status: 'planning' })) {
      if (!this.d.store.listTasks({ missionId: m.id }).length) this.track(this.planMission(m.id));
      else this.d.store.updateMission(m.id, { status: 'running' });
    }
  }

  private later(ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      void this.tick();
    }, ms);
    t.unref?.();
    this.timers.add(t);
  }

  // ======================================================================
  // missions
  // ======================================================================
  async submitMission(input: SubmitMissionInput, actor: string): Promise<Mission> {
    const text = input.text.trim();
    if (!text) throw new HttpError(400, 'Request text is required');
    const projectId = input.projectId ?? this.d.projects.ensureDefault().id;
    this.d.projects.get(projectId);
    if (input.mode === 'direct') {
      if (!input.agentId) throw new HttpError(400, 'agentId is required for direct assignment');
      this.d.agents.get(input.agentId);
    }
    const mission = this.d.store.createMission({
      projectId,
      title: input.title?.trim() || truncate(text.split('\n')[0], 90),
      requestText: text,
      attachments: input.fileIds ?? [],
      options: { mode: input.mode ?? 'auto', agentId: input.agentId },
    });
    this.d.audit.log(actor, 'mission.create', { type: 'mission', id: mission.id }, { mode: mission.options.mode, files: mission.attachments.length });
    this.d.activity.record({ type: 'mission.created', message: `New mission: ${mission.title}`, missionId: mission.id });
    if (input.mode !== 'direct')
      this.d.comms.post({
        channel: 'global',
        kind: 'message',
        fromType: 'user',
        fromName: actor,
        missionId: mission.id,
        content: text,
        attachments: (input.fileIds ?? []).map((id) => ({ fileId: id, name: this.safeFileName(id) })),
      });
    this.track(this.planMission(mission.id));
    return mission;
  }

  private safeFileName(id: string): string {
    try {
      return this.d.files.get(id).name;
    } catch {
      return id;
    }
  }

  private available(): Agent[] {
    return this.d.agents.list().filter((a) => !this.d.runtime.unavailableReason(a));
  }

  pickPlanner(): Agent | null {
    const cfg = this.d.settings.get('orchestrator');
    const avail = this.available();
    if (cfg.plannerAgentId) {
      const a = avail.find((x) => x.id === cfg.plannerAgentId);
      if (a) return a;
    }
    return avail.find((a) => a.roleKey === 'project_manager') ?? avail.find((a) => a.roleKey === 'ceo_assistant') ?? avail[0] ?? null;
  }

  pickCoordinator(): Agent | null {
    const cfg = this.d.settings.get('orchestrator');
    const avail = this.available();
    if (cfg.coordinatorAgentId) {
      const a = avail.find((x) => x.id === cfg.coordinatorAgentId);
      if (a) return a;
    }
    return avail.find((a) => a.roleKey === 'ceo_assistant') ?? avail.find((a) => a.roleKey === 'project_manager') ?? null;
  }

  private async planMission(missionId: string): Promise<void> {
    let mission = this.d.store.getMission(missionId);
    const ctrl = new AbortController();
    this.planControllers.set(missionId, ctrl);
    let planner: Agent | null = null;
    try {
      if (mission.attachments.length) await this.d.files.waitFor(mission.attachments);
      if (ctrl.signal.aborted) return;
      const rt = this.d.settings.get('runtime');

      if (mission.options.mode === 'direct') {
        const agent = this.d.agents.get(mission.options.agentId!);
        this.d.store.createTask({
          missionId,
          projectId: mission.projectId,
          title: mission.title,
          description: mission.requestText,
          kind: 'direct',
          roleKey: agent.roleKey,
          agentId: agent.id,
          pinned: true,
          maxAttempts: rt.defaultMaxAttempts,
        });
        this.d.store.updateMission(missionId, { status: 'running', intent: 'direct assignment', plan: { summary: `Assigned directly to ${agent.name}`, tasks: [] } });
        this.d.activity.record({ type: 'task.assigned', message: `Manager assigned "${mission.title}" directly to ${agent.name}`, missionId, agentId: agent.id });
        return void this.tick();
      }

      planner = this.pickPlanner();
      if (!planner) throw new Error('No available agent can plan this mission. Create at least one agent with a working provider (ideally a Project Manager).');
      this.d.store.updateMission(missionId, { plannerAgentId: planner.id });
      this.d.runtime.setActivity(planner.id, 'thinking', `Planning: ${mission.title}`);
      this.d.activity.record({ type: 'mission.planning', message: `${planner.name} is planning "${mission.title}"`, missionId, agentId: planner.id });

      const plan = await this.requestPlan(mission, planner, ctrl.signal);
      if (ctrl.signal.aborted) return;
      mission = this.d.store.getMission(missionId);
      if (mission.status === 'cancelled') return;
      this.materializePlan(mission, plan.plan, plan.fallbackReason);
      this.track(Promise.resolve()).then(() => this.tick());
    } catch (e) {
      if (ctrl.signal.aborted) return;
      const msg = errorMessage(e);
      this.d.store.updateMission(missionId, { status: 'failed', error: msg, finishedAt: nowIso() });
      this.d.activity.record({ type: 'mission.failed', level: 'error', message: `Planning failed for "${mission.title}": ${msg}`, missionId });
      this.d.comms.post({ channel: 'global', kind: 'error', fromType: 'system', fromName: 'Orchestrator', missionId, content: `Planning failed: ${msg}` });
    } finally {
      this.planControllers.delete(missionId);
      if (planner) {
        const a = this.d.agents.find(planner.id);
        if (a && !a.currentTaskId) this.d.runtime.setActivity(planner.id, 'idle', null);
      }
    }
  }

  private async requestPlan(mission: Mission, planner: Agent, signal: AbortSignal): Promise<{ plan: Plan; fallbackReason?: string }> {
    const rt = this.d.settings.get('runtime');
    const agents = this.d.agents.list().filter((a) => a.enabled);
    const roles = this.d.roles.list().filter((r) => r.key !== 'ceo_assistant' || !rt.autoSynthesis);
    const roster = roles
      .map((r) => {
        const staffed = agents.filter((a) => a.roleKey === r.key && !this.d.runtime.unavailableReason(a)).length;
        return `- ${r.key}: ${r.name} – ${r.description} [${staffed} agent(s) available]`;
      })
      .join('\n');
    const att = this.d.context.attachmentsBlock(planner, mission, 40_000);
    const system = `${this.d.context.systemFor(planner, { protocol: false })}

## Planning mode
You are planning work for an AI team. Analyse the manager's request and produce an execution plan.
Rules:
- Use the smallest set of concrete tasks that fully covers the request (a simple request = 1 task; typical 2–6; max 12).
- Every task description must be self-contained: include all facts, constraints and the expected output format the assignee needs.
- Express ordering with depends_on (task keys). Tasks without dependencies run in parallel.
- Assign each task the best role key from the roster. Prefer roles with available agents.
${rt.autoSynthesis ? '- Do NOT add a final "consolidate/summarise results" task – the coordinator does that automatically.\n' : ''}- Return ONLY a JSON object, no prose:
{"intent": "<what the manager wants>", "title": "<short mission title>", "summary": "<2-3 sentence approach>", "tasks": [{"key": "t1", "title": "...", "description": "...", "role": "<role key>", "depends_on": []}]}`;
    const user = `# Team roster (role key: description)\n${roster}\n\n# Manager's request\n${mission.requestText}${att.text ? `\n\n# Attached files\n${att.text}` : ''}`;
    const messages = [{ role: 'user' as const, content: user, images: att.images.length ? att.images : undefined }];
    let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const res = await this.d.runtime.invoke(planner, { system, messages, signal, missionId: mission.id, onFailover: (f) => this.announceFailover(f, planner) });
      try {
        return { plan: validatePlan(extractJson(res.text)) };
      } catch (e) {
        lastError = errorMessage(e);
        messages.push({ role: 'assistant', content: res.text, images: undefined } as any);
        messages.push({ role: 'user', content: `Your plan was invalid: ${lastError}. Return ONLY the corrected JSON object.`, images: undefined });
      }
    }
    // Planner could not produce a valid plan: honest single-task fallback.
    return {
      plan: { intent: '', summary: 'Single-task fallback plan', title: mission.title, tasks: [{ key: 't1', title: mission.title, description: mission.requestText, role: 'general', depends_on: [] }] },
      fallbackReason: `Planner output invalid twice (${lastError}) – using a single task`,
    };
  }

  private materializePlan(mission: Mission, plan: Plan, fallbackReason?: string): void {
    const rt = this.d.settings.get('runtime');
    const keyToId = new Map<string, string>();
    const created: Task[] = [];
    for (const t of plan.tasks) {
      const role = this.d.roles.findByKey(t.role) ?? this.d.roles.findByKey('general');
      const task = this.d.store.createTask({
        missionId: mission.id,
        projectId: mission.projectId,
        key: t.key,
        title: t.title,
        description: t.description,
        kind: 'work',
        roleKey: role?.key ?? 'general',
        maxAttempts: rt.defaultMaxAttempts,
        dependsOn: [],
      });
      keyToId.set(t.key, task.id);
      created.push(task);
    }
    for (const t of plan.tasks) {
      if (t.depends_on.length) this.d.store.updateTask(keyToId.get(t.key)!, { dependsOn: t.depends_on.map((k) => keyToId.get(k)!) });
    }
    const leaves = created.map((c) => c.id);
    let finalDeps = leaves;
    if (rt.autoReview && this.d.agents.list().some((a) => a.roleKey === 'qa' && !this.d.runtime.unavailableReason(a))) {
      const review = this.d.store.createTask({
        missionId: mission.id,
        projectId: mission.projectId,
        title: 'Quality review',
        description: 'Review all deliverables of this mission against the original request.',
        kind: 'review',
        roleKey: 'qa',
        dependsOn: leaves,
        maxAttempts: rt.defaultMaxAttempts,
      });
      finalDeps = [...leaves, review.id];
    }
    if (rt.autoSynthesis && created.length > 1) {
      this.d.store.createTask({
        missionId: mission.id,
        projectId: mission.projectId,
        title: 'Final report for the manager',
        description: 'Consolidate all results into the final deliverable.',
        kind: 'synthesis',
        roleKey: this.pickCoordinator()?.roleKey ?? 'ceo_assistant',
        agentId: this.pickCoordinator()?.id ?? null,
        dependsOn: finalDeps,
        maxAttempts: rt.defaultMaxAttempts,
        status: 'pending',
      });
    }
    this.d.store.updateMission(mission.id, {
      status: 'running',
      intent: plan.intent || null,
      title: plan.title?.trim() ? truncate(plan.title.trim(), 120) : mission.title,
      plan: { ...plan, fallbackReason: fallbackReason ?? null },
    });
    const coordinator = this.pickCoordinator();
    const lines = plan.tasks.map((t, i) => `${i + 1}. **${t.title}** → ${t.role}${t.depends_on.length ? ` (after ${t.depends_on.join(', ')})` : ''}`);
    this.d.comms.post({
      channel: 'global',
      kind: 'report',
      fromType: coordinator ? 'agent' : 'system',
      fromId: coordinator?.id ?? null,
      fromName: coordinator?.name ?? 'Orchestrator',
      missionId: mission.id,
      content: `Plan ready for "${mission.title}"${fallbackReason ? ` (⚠ ${fallbackReason})` : ''}:\n${plan.summary ? `${plan.summary}\n` : ''}${lines.join('\n')}`,
    });
    this.d.activity.record({ type: 'mission.planned', level: fallbackReason ? 'warning' : 'success', message: `Plan with ${plan.tasks.length} task(s) for "${mission.title}"`, missionId: mission.id });
  }

  cancelMission(missionId: string, actor: string): Mission {
    const mission = this.d.store.getMission(missionId);
    this.planControllers.get(missionId)?.abort();
    for (const t of this.d.store.listTasks({ missionId })) if (!TERMINAL.includes(t.status)) this.cancelTaskInternal(t, 'Mission cancelled by manager');
    this.d.store.updateMission(missionId, { status: 'cancelled', finishedAt: nowIso() });
    this.d.audit.log(actor, 'mission.cancel', { type: 'mission', id: missionId });
    this.d.activity.record({ type: 'mission.cancelled', level: 'warning', message: `Mission "${mission.title}" cancelled`, missionId });
    void this.tick();
    return this.d.store.getMission(missionId);
  }

  /** Re-plan a mission whose planning failed. */
  replan(missionId: string, actor: string): Mission {
    const m = this.d.store.getMission(missionId);
    if (m.status !== 'failed' || this.d.store.listTasks({ missionId }).length) throw new HttpError(409, 'Only missions that failed during planning can be re-planned; retry individual tasks instead');
    this.d.store.updateMission(missionId, { status: 'planning', error: null, finishedAt: null });
    this.d.audit.log(actor, 'mission.replan', { type: 'mission', id: missionId });
    this.track(this.planMission(missionId));
    return this.d.store.getMission(missionId);
  }

  // ======================================================================
  // scheduling
  // ======================================================================
  async tick(): Promise<void> {
    if (this.ticking) {
      this.tickQueued = true;
      return;
    }
    this.ticking = true;
    try {
      do {
        this.tickQueued = false;
        this.scheduleOnce();
      } while (this.tickQueued);
    } finally {
      this.ticking = false;
    }
  }

  get emergencyStopped(): boolean {
    return this.d.settings.getFlag('emergency_stop');
  }

  private scheduleOnce(): void {
    if (this.emergencyStopped) return;
    const rt = this.d.settings.get('runtime');
    let running = this.d.store.countRunning();
    for (const task of this.d.store.schedulable()) {
      if (running >= rt.maxConcurrentTasks) break;
      const deps = task.dependsOn.map((id) => this.d.store.findTask(id)).filter(Boolean) as Task[];
      if (deps.some((x) => !TERMINAL.includes(x.status))) continue;
      const bad = deps.filter((x) => x.status !== 'completed');
      if (bad.length && (task.kind !== 'synthesis' || bad.length === deps.length)) {
        this.cancelTaskInternal(task, `Dependency "${bad[0].title}" ${bad[0].status}`);
        this.onTaskTerminal(task.id);
        continue;
      }
      const sel = this.selectAgent(task);
      if (sel.fail) {
        this.d.store.appendError(task.id, sel.fail);
        this.d.store.updateTask(task.id, { status: 'failed', finishedAt: nowIso(), waitingReason: null });
        this.d.activity.record({ type: 'task.failed', level: 'error', message: `"${task.title}" failed: ${sel.fail}`, taskId: task.id, missionId: task.missionId });
        this.onTaskTerminal(task.id);
        continue;
      }
      if (sel.wait) {
        if (task.waitingReason !== sel.wait) this.d.store.updateTask(task.id, { waitingReason: sel.wait });
        continue;
      }
      running++;
      this.track(this.runTask(task, sel.agent!));
    }
  }

  private providerHasCapacity(providerId: string | null): boolean {
    if (!providerId) return false;
    const p = this.d.providers.get(providerId);
    return this.d.store.countRunning({ providerId }) < p.maxConcurrency;
  }

  private agentHasCapacity(a: Agent): boolean {
    return this.d.store.countRunning({ agentId: a.id }) < a.limits.maxConcurrentTasks && this.providerHasCapacity(a.providerId);
  }

  selectAgent(task: Task): { agent?: Agent; wait?: string; fail?: string } {
    const all = this.d.agents.list();
    if (task.agentId && task.pinned) {
      const a = all.find((x) => x.id === task.agentId);
      if (!a) return { fail: 'Assigned agent no longer exists' };
      const why = this.d.runtime.unavailableReason(a);
      if (why) return { wait: `${a.name}: ${why}` };
      if (!this.agentHasCapacity(a)) return { wait: `${a.name} is busy` };
      return { agent: a };
    }
    const eligible = all.filter((a) => !this.d.runtime.unavailableReason(a));
    let pool = eligible.filter((a) => a.roleKey === task.roleKey);
    if (!pool.length) pool = eligible.filter((a) => a.roleKey === 'general');
    if (!pool.length) pool = eligible.filter((a) => a.roleKey !== 'ceo_assistant');
    if (!pool.length) pool = eligible;
    if (!pool.length) {
      return all.some((a) => a.enabled && a.providerId)
        ? { wait: 'No agent available (paused, disabled or over budget)' }
        : { fail: 'No executable agents are configured' };
    }
    const free = pool.filter((a) => this.agentHasCapacity(a));
    if (!free.length) return { wait: `All suitable agents are busy (${pool.map((a) => a.name).join(', ')})` };
    const previous = task.attempts > 0 ? task.agentId : null;
    free.sort((a, b) => {
      if (previous && (a.id === previous) !== (b.id === previous)) return a.id === previous ? 1 : -1; // error recovery: try someone else first
      if (task.agentId && !previous && (a.id === task.agentId) !== (b.id === task.agentId)) return a.id === task.agentId ? -1 : 1;
      const ra = this.d.store.countRunning({ agentId: a.id });
      const rb = this.d.store.countRunning({ agentId: b.id });
      if (ra !== rb) return ra - rb;
      return (a.lastActiveAt ?? '').localeCompare(b.lastActiveAt ?? '');
    });
    return { agent: free[0] };
  }

  // ======================================================================
  // execution
  // ======================================================================
  private async runTask(task: Task, agent: Agent): Promise<void> {
    const ctrl = new AbortController();
    this.controllers.set(task.id, { ctrl, agentId: agent.id });
    const attempt = task.attempts + 1;
    const provider = this.d.providers.get(agent.providerId!);
    const role = this.d.roles.get(agent.roleId);
    this.d.store.updateTask(task.id, {
      status: task.kind === 'review' || task.kind === 'synthesis' ? 'reviewing' : 'running',
      agentId: agent.id,
      providerId: provider.id,
      attempts: attempt,
      startedAt: task.startedAt ?? nowIso(),
      waitingReason: null,
      notBefore: null,
    });
    const mission = task.missionId ? this.d.store.getMission(task.missionId) : null;
    this.d.runtime.setActivity(agent.id, 'reading', `Preparing: ${task.title}`, { currentTaskId: task.id });
    this.d.activity.record({
      type: 'task.started',
      message: `${agent.name} started "${task.title}"${attempt > 1 ? ` (attempt ${attempt})` : ''}`,
      taskId: task.id,
      missionId: task.missionId,
      agentId: agent.id,
      providerId: provider.id,
    });

    let built;
    const prep = this.d.store.addStep(task.id, attempt > 1 ? `Attempt ${attempt}: preparing context` : 'Preparing context');
    try {
      built = this.d.context.buildForTask(this.d.store.getTask(task.id), agent, mission);
      const s = built.stats;
      this.d.store.finishStep(
        prep.id,
        'done',
        `${s.dependencies} dependency output(s), ${s.files} file(s), ${s.images} image(s), ${s.knowledge} knowledge item(s), ${s.inbox} message(s) – ${s.chars} chars`,
      );
    } catch (e) {
      this.d.store.finishStep(prep.id, 'failed', errorMessage(e));
      this.controllers.delete(task.id);
      return this.handleFailure(task.id, agent, e);
    }

    const sent = this.d.store.addStep(task.id, `Request sent to ${provider.name}${agent.model ? ` · ${agent.model}` : ''}`);
    this.d.runtime.setActivity(agent.id, 'thinking', task.title, { currentTaskId: task.id });
    let streamStep: TaskStep | null = null;
    let streamed = 0;
    let pending = '';
    let lastFlush = 0;
    const flush = () => {
      if (!pending) return;
      this.d.bus.publish('task.stream', { taskId: task.id, agentId: agent.id, delta: pending, total: streamed });
      pending = '';
      lastFlush = Date.now();
      if (streamStep) this.d.store.updateStepDetail(streamStep.id, `${streamed} characters received`);
    };
    const onDelta = (delta: string) => {
      if (ctrl.signal.aborted) return;
      if (!streamStep) {
        this.d.store.finishStep(sent.id, 'done');
        streamStep = this.d.store.addStep(task.id, 'Receiving output');
        this.d.runtime.setActivity(agent.id, role.workActivity as AgentActivity, task.title, { currentTaskId: task.id });
      }
      streamed += delta.length;
      pending += delta;
      if (Date.now() - lastFlush > 400) flush();
    };
    const onStatus = (status: string) => {
      if (ctrl.signal.aborted) return;
      if (status === 'CLI process started') {
        this.d.store.finishStep(sent.id, 'done');
        this.d.runtime.setActivity(agent.id, role.workActivity as AgentActivity, task.title, { currentTaskId: task.id });
      }
      if (status !== 'request sent') this.d.store.addStep(task.id, status, 'info');
    };

    try {
      const result = await this.d.runtime.invoke(agent, {
        system: built.system,
        messages: built.messages,
        signal: ctrl.signal,
        cwd: task.projectId ? this.d.projects.workspaceDir(task.projectId) : undefined,
        taskId: task.id,
        missionId: task.missionId,
        onDelta,
        onStatus,
        onFailover: (f) => this.announceFailover(f, agent),
      });
      flush();
      this.d.store.closeOpenSteps(task.id, 'done');
      const u = result.usage;
      this.d.store.addStep(
        task.id,
        'Response received',
        'done',
        `${u ? `${u.inputTokens} in / ${u.outputTokens} out tokens` : 'no usage reported'} · ${(result.durationMs / 1000).toFixed(1)} s${result.model ? ` · ${result.model}` : ''}`,
      );
      this.controllers.delete(task.id);
      this.handleOutput(task.id, agent, result.text);
    } catch (e) {
      this.controllers.delete(task.id);
      if (ctrl.signal.aborted) {
        this.d.store.closeOpenSteps(task.id, 'failed');
        this.afterAgentRun(agent.id, 'idle', null);
      } else this.handleFailure(task.id, agent, e);
    } finally {
      void this.tick();
    }
  }

  private announcedFailover = new Set<string>();
  /** Tell the manager once per provider outage that work moved to another AI. */
  private announceFailover(f: { fromId: string; fromName: string; toId: string; toName: string; reason: string }, agent: Agent) {
    const cd = this.d.providers.cooldown(f.fromId);
    const key = `${f.fromId}:${cd?.until.toISOString() ?? ''}:${f.toId}`;
    if (this.announcedFailover.has(key)) return;
    this.announcedFailover.add(key);
    this.d.comms.post({
      channel: 'global',
      kind: 'message',
      fromType: 'system',
      fromName: 'Office',
      content: `${f.reason}. Work for ${agent.name} and other employees on ${f.fromName} continues on ${f.toName} until then.`,
    });
  }

  private afterAgentRun(agentId: string, activity: AgentActivity, detail: string | null, revertMs?: number) {
    const others = this.d.store.listTasks({ agentId, status: ACTIVE });
    if (others.length) {
      this.d.agents.setActivity(agentId, this.d.agents.get(agentId).activity, others[0].title, others[0].id);
      return;
    }
    this.d.runtime.setActivity(agentId, activity, detail, { currentTaskId: null, revertMs });
  }

  private resolveAgentRef(ref: string): Agent | undefined {
    const byName = this.d.agents.findByName(ref.replace(/\s*\(.*\)$/, '').trim());
    if (byName) return byName;
    return this.d.agents.list().find((a) => a.roleKey === ref.trim() && a.enabled);
  }

  private handleOutput(taskId: string, agent: Agent, text: string): void {
    const task = this.d.store.getTask(taskId);
    if (!ACTIVE.includes(task.status)) return; // cancelled / reassigned meanwhile
    const rt = this.d.settings.get('runtime');
    const { output, actions, actionError } = parseAgentOutput(text);
    if (actionError) this.d.store.addStep(taskId, 'Action block ignored', 'info', actionError);
    if (!output && !hasActions(actions)) return this.handleFailure(taskId, agent, new ProviderError('Empty response from provider', true));

    // Agent memory (agent-scoped knowledge).
    for (const m of actions.memory ?? [])
      this.d.knowledge.create(
        { scope: 'agent', agentId: agent.id, projectId: task.projectId, title: truncate(m, 80), content: m, tags: 'memory' },
        { type: 'agent_memory', id: task.id },
      );

    // Agent-to-agent messages.
    if (actions.messages?.length) {
      if (!agent.permissions.canMessageAgents) this.d.store.addStep(taskId, 'Messages not sent (no permission)', 'info');
      else
        for (const msg of actions.messages) {
          const target = this.resolveAgentRef(msg.to);
          this.d.comms.post({
            channel: 'agents',
            kind: 'message',
            fromType: 'agent',
            fromId: agent.id,
            fromName: agent.name,
            toType: target ? 'agent' : 'broadcast',
            toId: target?.id ?? null,
            toName: target?.name ?? msg.to,
            missionId: task.missionId,
            taskId,
            content: msg.content,
          });
          if (target) this.d.runtime.markDiscussing([target.id], `Message from ${agent.name}`);
        }
    }

    const resumeRounds = task.extraContext.filter((x) => x.kind === 'note' && x.label === 'Resumed').length;
    const canWait = task.kind !== 'synthesis' && resumeRounds < MAX_RESUME_ROUNDS;
    const waits: string[] = [];

    if (actions.help_requests?.length) {
      if (!canWait || !agent.permissions.canDelegate || task.depth >= rt.maxDelegationDepth) {
        this.d.store.addStep(taskId, 'Help request ignored', 'info', !agent.permissions.canDelegate ? 'agent may not delegate' : 'delegation depth / round limit reached');
      } else {
        for (const hr of actions.help_requests) {
          const role = this.d.roles.findByKey(hr.role) ?? this.d.roles.findByKey('general')!;
          const child = this.d.store.createTask({
            missionId: task.missionId,
            projectId: task.projectId,
            parentTaskId: task.id,
            title: hr.title?.trim() || `Help for "${truncate(task.title, 40)}"`,
            description: `${hr.request}\n\n(Requested by ${agent.name} while working on "${task.title}".)`,
            kind: 'help',
            roleKey: role.key,
            maxAttempts: rt.defaultMaxAttempts,
            depth: task.depth + 1,
          });
          this.d.comms.post({
            channel: 'agents',
            kind: 'help_request',
            fromType: 'agent',
            fromId: agent.id,
            fromName: agent.name,
            toType: 'broadcast',
            toName: role.name,
            missionId: task.missionId,
            taskId: child.id,
            content: hr.request,
          });
          waits.push(`${WAIT_HELP} ${role.name}`);
        }
        this.d.activity.record({ type: 'task.delegated', message: `${agent.name} requested help (${actions.help_requests.length}) for "${task.title}"`, taskId, missionId: task.missionId, agentId: agent.id });
      }
    }

    if (actions.question_for_manager && canWait) {
      this.d.comms.post({
        channel: 'global',
        kind: 'question',
        fromType: 'agent',
        fromId: agent.id,
        fromName: agent.name,
        toType: 'user',
        missionId: task.missionId,
        taskId,
        content: `Question about "${task.title}": ${actions.question_for_manager}`,
      });
      waits.push(WAIT_MANAGER);
    }

    if (actions.approval_request && canWait) {
      const ap = this.d.approvals.create({
        missionId: task.missionId,
        taskId,
        agentId: agent.id,
        actionType: actions.approval_request.action,
        description: actions.approval_request.reason,
        payload: { details: actions.approval_request.details ?? null },
      });
      this.d.comms.post({
        channel: 'global',
        kind: 'question',
        fromType: 'agent',
        fromId: agent.id,
        fromName: agent.name,
        toType: 'user',
        missionId: task.missionId,
        taskId,
        content: `Approval requested: ${ap.actionType}${ap.description ? ` – ${ap.description}` : ''}`,
      });
      waits.push(WAIT_APPROVAL);
    }

    if (waits.length) {
      const extra: ExtraContext[] = [...task.extraContext, { kind: 'previous_output', label: 'Your previous (partial) output', content: output, at: nowIso() }];
      this.d.store.updateTask(taskId, { status: 'waiting', waitingReason: waits.join('; '), output, extraContext: extra });
      this.d.store.addStep(taskId, `Waiting: ${waits.join(', ')}`, 'info');
      this.d.activity.record({ type: 'task.waiting', message: `"${task.title}" is waiting for ${waits.join(', ')}`, taskId, missionId: task.missionId, agentId: agent.id });
      this.afterAgentRun(agent.id, 'waiting', `Waiting: ${waits.join(', ')}`, 15_000);
      return;
    }

    this.d.store.updateTask(taskId, { status: 'completed', output, progress: 100, finishedAt: nowIso(), waitingReason: null });
    this.d.store.addStep(taskId, 'Completed', 'done');
    if (task.kind !== 'synthesis')
      this.d.comms.post({
        channel: 'agents',
        kind: 'result',
        fromType: 'agent',
        fromId: agent.id,
        fromName: agent.name,
        toType: 'broadcast',
        missionId: task.missionId,
        taskId,
        content: `Finished "${task.title}":\n${truncate(output, 1200)}`,
      });
    // A task the manager answered a question for reports back in the main chat, so the conversation has an end.
    if (task.kind !== 'synthesis' && task.extraContext.some((x) => x.kind === 'manager_answer'))
      this.d.comms.post({
        channel: 'global',
        kind: 'result',
        fromType: 'agent',
        fromId: agent.id,
        fromName: agent.name,
        toType: 'user',
        missionId: task.missionId,
        taskId,
        content: `Done with "${task.title}" using your answer:\n${truncate(output, 1500)}`,
      });
    this.d.activity.record({ type: 'task.completed', level: 'success', message: `${agent.name} completed "${task.title}"`, taskId, missionId: task.missionId, agentId: agent.id });
    this.afterAgentRun(agent.id, 'completed', `Completed: ${task.title}`, 8000);
    this.onTaskTerminal(taskId);
  }

  private hasAlternativeAgent(task: Task, failed: Agent): boolean {
    return this.d.agents
      .list()
      .some((a) => a.id !== failed.id && !this.d.runtime.unavailableReason(a) && (a.roleKey === task.roleKey || a.roleKey === 'general'));
  }

  private handleFailure(taskId: string, agent: Agent, e: unknown): void {
    const msg = errorMessage(e);
    const retryable = e instanceof ProviderError ? e.retryable : true;
    const task = this.d.store.getTask(taskId);
    this.d.store.appendError(taskId, `attempt ${task.attempts} by ${agent.name}: ${msg}`);
    this.d.store.closeOpenSteps(taskId, 'failed');
    this.d.store.addStep(taskId, 'Attempt failed', 'failed', msg);
    this.d.comms.post({
      channel: 'agents',
      kind: 'error',
      fromType: 'agent',
      fromId: agent.id,
      fromName: agent.name,
      toType: 'broadcast',
      missionId: task.missionId,
      taskId,
      content: `Error on "${task.title}": ${msg}`,
    });
    this.d.activity.record({ type: 'task.error', level: 'error', message: `${agent.name} failed "${task.title}": ${msg}`, taskId, missionId: task.missionId, agentId: agent.id });
    this.afterAgentRun(agent.id, 'error', truncate(msg, 160), 20_000);
    if (e instanceof QuotaError)
      this.d.comms.post({
        channel: 'global',
        kind: 'error',
        fromType: 'system',
        fromName: 'Office',
        missionId: task.missionId,
        taskId,
        content: `${msg}. No other AI is available to take over "${task.title}". Connect another AI or switch the employee (More → Employees → Switch whole team to…), then press Retry on the task.`,
      });
    if (!ACTIVE.includes(task.status)) return;
    const alternative = !task.pinned && this.hasAlternativeAgent(task, agent);
    if (task.attempts < task.maxAttempts && (retryable || alternative)) {
      const delay = this.d.settings.get('runtime').retryBaseDelayMs * 2 ** Math.max(0, task.attempts - 1);
      this.d.store.updateTask(taskId, {
        status: 'pending',
        notBefore: new Date(Date.now() + delay).toISOString(),
        waitingReason: `Retry ${task.attempts + 1}/${task.maxAttempts} in ${Math.round(delay / 1000)} s${alternative ? ' (another agent preferred)' : ''}`,
      });
      this.d.store.addStep(taskId, `Retry scheduled in ${Math.round(delay / 1000)} s`, 'info');
      this.later(delay + 50);
    } else if (this.recoveryRounds(task) < MAX_RECOVERY_ROUNDS && this.pickRecoveryReviewer(agent)) {
      // Do not stop at the error: the PM (or the next manager up) reviews it and hands over / changes the approach.
      this.d.store.updateTask(taskId, { status: 'waiting', waitingReason: WAIT_RECOVERY, notBefore: null });
      this.d.store.addStep(taskId, 'Failed – the project manager is reviewing a backup plan', 'info');
      this.track(this.recoverTask(taskId, agent));
    } else {
      this.failTask(taskId);
    }
  }

  private failTask(taskId: string): void {
    this.d.store.updateTask(taskId, { status: 'failed', finishedAt: nowIso(), waitingReason: null });
    this.onTaskTerminal(taskId);
  }

  private recoveryRounds(task: Task): number {
    return task.extraContext.filter((x) => x.kind === 'note' && x.label.startsWith(RECOVERY_LABEL)).length;
  }

  /** Who reviews a failure: the PM, else the CEO assistant, else any other available agent – preferably not the one that failed. */
  private pickRecoveryReviewer(failed: Agent): Agent | null {
    const avail = this.available();
    const others = avail.filter((a) => a.id !== failed.id);
    const pool = others.length ? others : avail;
    return pool.find((a) => a.roleKey === 'project_manager') ?? pool.find((a) => a.roleKey === 'ceo_assistant') ?? pool[0] ?? null;
  }

  /**
   * Failure recovery: the reviewer sees the task, the errors and the available team and decides to
   * hand the task to another agent, retry with a different (backup) approach, skip it with a workaround
   * so the mission continues, or – only when nothing can work – give up and explain to the manager.
   */
  private async recoverTask(taskId: string, failedAgent: Agent): Promise<void> {
    const task = this.d.store.getTask(taskId);
    const reviewer = this.pickRecoveryReviewer(failedAgent);
    const still = () => {
      const t = this.d.store.findTask(taskId);
      return t && t.status === 'waiting' && t.waitingReason === WAIT_RECOVERY ? t : null;
    };
    if (!reviewer) return void (still() && this.failTask(taskId));
    const mission = task.missionId ? this.d.store.getMission(task.missionId) : null;
    const team = this.available()
      .filter((a) => a.roleKey !== 'ceo_assistant' || a.id === task.agentId)
      .map((a) => {
        let p: { name: string } | null = null;
        try {
          p = a.providerId ? this.d.providers.get(a.providerId) : null;
        } catch {
          /* removed provider */
        }
        return `- id=${a.id} | ${a.name} | role ${a.roleKey} | AI ${p?.name ?? '?'}${a.model ? ` (${a.model})` : ''}${a.id === failedAgent.id ? ' | ← failed this task' : ''}`;
      })
      .join('\n');
    const errors = task.errorLog.split('\n').filter(Boolean).slice(-6).join('\n');
    const previousPlans = task.extraContext.filter((x) => x.kind === 'note' && x.label.startsWith(RECOVERY_LABEL)).map((x) => `- ${x.content.slice(0, 600)}`).join('\n');
    const system = `${this.d.context.systemFor(reviewer, { protocol: false })}

## Failure recovery mode
A task in your team failed after all automatic retries. As the responsible manager you must NOT just report the error:
find a way to still get the result. Options:
- "reassign": hand the task to another agent (better suited, or using a different AI) – give them clear instructions.
- "new_approach": retry with a different, backup way of doing it (other tool, simpler method, smaller scope, other source) – the instructions must describe that approach concretely; you may also pick the agent.
- "skip": the task is not essential or can be worked around – give the output/notes the following tasks should use instead.
- "give_up": only if nothing can work without the manager (e.g. needs a login, money or a decision only the manager can make). Explain exactly what the manager must do.
Do not repeat a plan that already failed. Return ONLY a JSON object:
{"decision": "reassign|new_approach|skip|give_up", "agent_id": "<id from the team list or empty>", "instructions": "<self-contained instructions for the new attempt>", "output": "<for skip: what to pass on>", "reason": "<1-2 sentences for the manager>", "message": "<short note to the team chat saying what failed and what happens now>"}
Write "reason" and "message" in the language the manager used in the mission.`;
    const user = `${mission ? `# Mission\n${truncate(mission.requestText, 3000)}\n\n` : ''}# Failed task: ${task.title}\n${truncate(task.description, 4000)}\n\n# Errors (latest last)\n${truncate(errors, 3000)}\n\n${previousPlans ? `# Backup plans already tried (they failed too)\n${previousPlans}\n\n` : ''}# Available team\n${team || '(nobody else)'}`;
    this.d.runtime.setActivity(reviewer.id, 'thinking', `Fixing a failure: ${task.title}`);
    type Decision = { decision?: string; agent_id?: string; instructions?: string; output?: string; reason?: string; message?: string };
    let decision = null as Decision | null;
    try {
      const res = await this.d.runtime.invoke(reviewer, { system, messages: [{ role: 'user', content: user }], signal: new AbortController().signal, missionId: task.missionId ?? undefined, onFailover: (f) => this.announceFailover(f, reviewer) });
      decision = extractJson(res.text) as Decision;
    } catch (e) {
      this.d.store.appendError(taskId, `recovery review by ${reviewer.name} failed: ${errorMessage(e)}`);
    } finally {
      const a = this.d.agents.find(reviewer.id);
      if (a && !a.currentTaskId) this.d.runtime.setActivity(reviewer.id, 'idle', null);
    }
    const t = still();
    if (!t) return;
    const kind = String(decision?.decision ?? '').toLowerCase();
    const reason = String(decision?.reason ?? '').trim();
    const note = String(decision?.message ?? '').trim();
    const say = (content: string, channel: 'agents' | 'global' = 'agents') =>
      this.d.comms.post({ channel, kind: 'message', fromType: 'agent', fromId: reviewer.id, fromName: reviewer.name, toType: channel === 'global' ? 'user' : 'broadcast', missionId: t.missionId, taskId, content });

    if (kind === 'skip') {
      const output = `⚠️ Skipped by ${reviewer.name} after a failure${reason ? `: ${reason}` : ''}\n\n${String(decision?.output ?? '').trim()}`.trim();
      this.d.store.updateTask(taskId, { status: 'completed', output, finishedAt: nowIso(), waitingReason: null, progress: 100 });
      this.d.store.addStep(taskId, `Skipped with a workaround by ${reviewer.name}`, 'info', reason || null);
      say(note ? `🔧 ${note}` : `🔧 "${t.title}" failed. I am skipping it with a workaround so the rest of the work continues.${reason ? `\n${reason}` : ''}`);
      this.d.activity.record({ type: 'task.recovered', level: 'warning', message: `${reviewer.name} skipped "${t.title}" with a workaround`, taskId, missionId: t.missionId, agentId: reviewer.id });
      this.onTaskTerminal(taskId);
      return void this.tick();
    }
    if (kind === 'reassign' || kind === 'new_approach') {
      const target = this.available().find((a) => a.id === decision?.agent_id);
      const instructions = String(decision?.instructions ?? '').trim();
      const plan: ExtraContext = {
        kind: 'note',
        label: `${RECOVERY_LABEL} by ${reviewer.name}`,
        content: `${kind === 'reassign' ? 'Handed over' : 'New approach'} after the previous attempt failed (${truncate(errors.split('\n').pop() ?? '', 300)}).${instructions ? `\nInstructions: ${instructions}` : ''}`,
        at: nowIso(),
      };
      this.d.store.updateTask(taskId, {
        status: target ? 'assigned' : 'pending',
        agentId: target?.id ?? null,
        pinned: !!target,
        roleKey: target?.roleKey ?? t.roleKey,
        attempts: 0,
        notBefore: null,
        waitingReason: null,
        progress: null,
        extraContext: [...t.extraContext, plan],
      });
      const who = target ? target.name : 'another available agent';
      this.d.store.addStep(taskId, kind === 'reassign' ? `Handed over to ${who} by ${reviewer.name}` : `Backup approach by ${reviewer.name} – assigned to ${who}`, 'info', instructions || null);
      say(note ? `🔧 ${note}` : `🔧 "${t.title}" failed (${failedAgent.name}). ${kind === 'reassign' ? `Handing it to ${who}.` : `Trying a backup approach with ${who}.`}${reason ? `\n${reason}` : ''}`);
      this.d.activity.record({ type: 'task.recovered', level: 'warning', message: `${reviewer.name} ${kind === 'reassign' ? 'handed' : 'reworked'} "${t.title}" → ${who}`, taskId, missionId: t.missionId, agentId: reviewer.id });
      return void this.tick();
    }
    // give_up or no usable decision → fail, with the reviewer's explanation for the manager.
    if (reason || note) say(`⚠️ "${t.title}" could not be completed even with a backup plan.\n${note || reason}`, 'global');
    this.failTask(taskId);
  }

  private onTaskTerminal(taskId: string): void {
    const task = this.d.store.getTask(taskId);
    if (task.parentTaskId) {
      const parent = this.d.store.findTask(task.parentTaskId);
      if (parent && parent.status === 'waiting') {
        const children = this.d.store.listTasks({ missionId: parent.missionId ?? undefined }).filter((c) => c.parentTaskId === parent.id);
        if (children.every((c) => TERMINAL.includes(c.status))) {
          const fresh = children.filter((c) => !parent.extraContext.some((x) => x.kind === 'help_result' && x.label.includes(c.id)));
          const extra = [
            ...parent.extraContext,
            ...fresh.map<ExtraContext>((c) => ({
              kind: 'help_result',
              label: `Help result from ${c.agentName ?? c.roleKey} – "${c.title}" [${c.id}] (${c.status})`,
              content: c.status === 'completed' ? (c.output ?? '') : `Help could not be provided: ${c.errorLog.split('\n').filter(Boolean).pop() ?? c.status}`,
              at: nowIso(),
            })),
          ];
          this.resolveWait(parent.id, (w) => !w.startsWith(WAIT_HELP), extra);
        }
      }
    }
    if (task.missionId) this.checkMission(task.missionId);
  }

  /** Remove satisfied wait reasons; resume the task when nothing is left to wait for. */
  private resolveWait(taskId: string, keep: (reason: string) => boolean, extraContext: ExtraContext[]): Task {
    const t = this.d.store.getTask(taskId);
    const remaining = (t.waitingReason ?? '').split('; ').filter(Boolean).filter(keep);
    if (remaining.length) return this.d.store.updateTask(taskId, { waitingReason: remaining.join('; '), extraContext });
    const updated = this.d.store.updateTask(taskId, {
      status: t.agentId && t.pinned ? 'assigned' : 'pending',
      waitingReason: null,
      extraContext: [...extraContext, { kind: 'note', label: 'Resumed', content: 'All requested inputs are available above. Complete your task now; do not request the same help again.', at: nowIso() }],
      attempts: Math.max(0, t.attempts - 1),
    });
    this.d.store.addStep(taskId, 'Resumed – inputs received', 'info');
    void this.tick();
    return updated;
  }

  private checkMission(missionId: string): void {
    const mission = this.d.store.getMission(missionId);
    if (['completed', 'cancelled'].includes(mission.status)) return;
    if (mission.status === 'planning') return;
    const tasks = this.d.store.listTasks({ missionId });
    if (!tasks.length || tasks.some((t) => !TERMINAL.includes(t.status))) {
      if (mission.status === 'failed') this.d.store.updateMission(missionId, { status: 'running', finishedAt: null });
      return;
    }
    const synthesis = tasks.find((t) => t.kind === 'synthesis');
    const work = tasks.filter((t) => t.kind !== 'synthesis' && t.kind !== 'help').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const failed = tasks.filter((t) => t.status === 'failed');
    let result: string;
    let ok: boolean;
    if (synthesis?.status === 'completed') {
      result = synthesis.output ?? '';
      ok = true;
    } else {
      ok = work.every((t) => t.status === 'completed');
      result = work
        .map((t) => `## ${t.title} (${t.agentName ?? '—'}, ${t.status})\n${t.status === 'completed' ? t.output ?? '' : t.errorLog.split('\n').filter(Boolean).pop() ?? ''}`)
        .join('\n\n');
    }
    if (mission.status === 'completed' && ok) return;
    this.d.store.updateMission(missionId, {
      status: ok ? 'completed' : 'failed',
      result,
      error: ok ? null : `${failed.length} task(s) failed`,
      finishedAt: nowIso(),
    });
    const coordinator = this.pickCoordinator();
    this.d.comms.post({
      channel: 'global',
      kind: 'report',
      fromType: coordinator ? 'agent' : 'system',
      fromId: coordinator?.id ?? null,
      fromName: coordinator?.name ?? 'Orchestrator',
      toType: 'user',
      missionId,
      content: `${ok ? '✅ Mission completed' : '⚠️ Mission finished with failures'}: "${mission.title}"\n\n${result}`,
    });
    this.d.activity.record({
      type: ok ? 'mission.completed' : 'mission.failed',
      level: ok ? 'success' : 'error',
      message: `Mission "${mission.title}" ${ok ? 'completed' : `finished with ${failed.length} failed task(s)`}`,
      missionId,
    });
  }

  // ======================================================================
  // manager interventions
  // ======================================================================
  private cancelTaskInternal(task: Task, reason: string): void {
    const running = this.controllers.get(task.id);
    this.d.store.appendError(task.id, reason);
    this.d.store.updateTask(task.id, { status: 'cancelled', finishedAt: nowIso(), waitingReason: null });
    this.d.store.closeOpenSteps(task.id, 'failed');
    this.d.store.addStep(task.id, 'Cancelled', 'info', reason);
    this.d.approvals.cancelForTask(task.id);
    if (running) running.ctrl.abort();
    // Cancel help sub-tasks of a cancelled parent.
    for (const child of this.d.store.listTasks({ missionId: task.missionId ?? undefined }).filter((c) => c.parentTaskId === task.id && !TERMINAL.includes(c.status)))
      this.cancelTaskInternal(child, 'Parent task cancelled');
  }

  cancelTask(taskId: string, actor: string): Task {
    const t = this.d.store.getTask(taskId);
    if (TERMINAL.includes(t.status)) throw new HttpError(409, `Task already ${t.status}`);
    this.cancelTaskInternal(t, `Cancelled by ${actor}`);
    this.d.audit.log(actor, 'task.cancel', { type: 'task', id: taskId });
    this.d.activity.record({ type: 'task.cancelled', level: 'warning', message: `"${t.title}" cancelled by manager`, taskId, missionId: t.missionId });
    this.onTaskTerminal(taskId);
    void this.tick();
    return this.d.store.getTask(taskId);
  }

  retryTask(taskId: string, actor: string): Task {
    const t = this.d.store.getTask(taskId);
    if (!['failed', 'cancelled'].includes(t.status)) throw new HttpError(409, 'Only failed or cancelled tasks can be retried');
    const reset = (task: Task) =>
      this.d.store.updateTask(task.id, {
        status: task.pinned && task.agentId ? 'assigned' : 'pending',
        attempts: 0,
        notBefore: null,
        finishedAt: null,
        waitingReason: null,
        progress: null,
      });
    reset(t);
    // Re-open dependants that were cancelled because of this task.
    if (t.missionId) {
      const all = this.d.store.listTasks({ missionId: t.missionId });
      const queue = [t.id];
      while (queue.length) {
        const id = queue.shift()!;
        for (const dep of all.filter((x) => x.dependsOn.includes(id) && x.status === 'cancelled' && /Dependency/.test(x.errorLog))) {
          reset(dep);
          queue.push(dep.id);
        }
      }
      const m = this.d.store.getMission(t.missionId);
      if (m.status !== 'running') this.d.store.updateMission(t.missionId, { status: 'running', finishedAt: null, error: null });
    }
    this.d.audit.log(actor, 'task.retry', { type: 'task', id: taskId });
    this.d.activity.record({ type: 'task.retry', message: `Manager retried "${t.title}"`, taskId, missionId: t.missionId });
    void this.tick();
    return this.d.store.getTask(taskId);
  }

  reassignTask(taskId: string, agentId: string | null, actor: string): Task {
    const t = this.d.store.getTask(taskId);
    if (TERMINAL.includes(t.status)) throw new HttpError(409, `Task already ${t.status} – retry it first`);
    const agent = agentId ? this.d.agents.get(agentId) : null;
    const running = this.controllers.get(taskId);
    this.d.store.updateTask(taskId, {
      agentId: agent?.id ?? null,
      pinned: !!agent,
      roleKey: agent?.roleKey ?? t.roleKey,
      ...(running ? { status: agent ? 'assigned' : 'pending', attempts: Math.max(0, t.attempts - 1) } : {}),
      ...(t.status === 'pending' && agent ? { status: 'assigned' } : {}),
      ...(t.status === 'assigned' && !agent ? { status: 'pending' } : {}),
    });
    if (running) {
      this.d.store.addStep(taskId, `Reassigned by manager to ${agent?.name ?? 'automatic selection'}`, 'info');
      running.ctrl.abort();
    }
    this.d.audit.log(actor, 'task.reassign', { type: 'task', id: taskId }, { agentId });
    this.d.activity.record({ type: 'task.reassigned', message: `"${t.title}" reassigned to ${agent?.name ?? 'automatic selection'}`, taskId, missionId: t.missionId, agentId });
    void this.tick();
    return this.d.store.getTask(taskId);
  }

  respondToTask(taskId: string, answer: string, actor: string, fileIds: string[] = []): Task {
    const t = this.d.store.getTask(taskId);
    if (t.status !== 'waiting' || !(t.waitingReason ?? '').includes(WAIT_MANAGER)) throw new HttpError(409, 'Task is not waiting for a manager answer');
    const files = fileIds.map((id) => this.d.files.get(id));
    this.d.comms.post({
      channel: 'global',
      kind: 'message',
      fromType: 'user',
      fromName: actor,
      toType: 'agent',
      toId: t.agentId,
      toName: t.agentName,
      missionId: t.missionId,
      taskId,
      content: answer,
      attachments: files.map((f) => ({ fileId: f.id, name: f.name })),
    });
    this.d.audit.log(actor, 'task.respond', { type: 'task', id: taskId });
    const resumed = this.resolveWait(taskId, (w) => w !== WAIT_MANAGER, [
      ...t.extraContext,
      {
        kind: 'manager_answer',
        label: "Manager's answer to your question",
        content: files.length ? `${answer}\n\n(Attached: ${files.map((f) => f.name).join(', ')} – see "Files attached by the manager")` : answer,
        at: nowIso(),
        fileIds: files.map((f) => f.id),
      },
    ]);
    // Tell the manager the answer landed and work goes on – otherwise CLI agents (no streaming) look frozen for minutes.
    const agent = t.agentId ? this.d.agents.find(t.agentId) : null;
    // Name the AI that will really do the work (the agent's own one may be out of quota → failover).
    let aiName = agent?.providerName ?? null;
    if (agent?.providerId && this.d.providers.cooldown(agent.providerId)) aiName = this.d.runtime.fallbackProvider([agent.providerId])?.name ?? aiName;
    const stillWaiting = resumed.status === 'waiting';
    this.d.comms.post({
      channel: 'global',
      kind: 'message',
      fromType: 'system',
      fromName: 'Office',
      missionId: t.missionId,
      taskId,
      content: stillWaiting
        ? `${t.agentName ?? 'The agent'} received your answer for "${t.title}" and is still waiting for: ${resumed.waitingReason}.`
        : `${t.agentName ?? 'The agent'} received your answer and is continuing "${t.title}"${aiName ? ` (${aiName})` : ''}. You will see the result here when it is done.`,
    });
    return resumed;
  }

  decideApproval(approvalId: string, decision: 'approved' | 'rejected', note: string | undefined, actor: string) {
    const ap = this.d.approvals.decide(approvalId, decision, actor, note);
    this.d.audit.log(actor, `approval.${decision}`, { type: 'approval', id: approvalId }, { action: ap.actionType });
    this.d.activity.record({ type: 'approval.decided', level: decision === 'approved' ? 'success' : 'warning', message: `Manager ${decision} "${ap.actionType}"`, taskId: ap.taskId, agentId: ap.agentId });
    if (ap.taskId) {
      const t = this.d.store.findTask(ap.taskId);
      if (t && t.status === 'waiting') {
        this.resolveWait(t.id, (w) => w !== WAIT_APPROVAL, [
          ...t.extraContext,
          {
            kind: 'approval',
            label: `Manager decision on "${ap.actionType}"`,
            content: `${decision.toUpperCase()}${note ? ` – note: ${note}` : ''}. ${decision === 'approved' ? 'You may proceed with the action.' : 'Do NOT perform the action; complete the task without it.'}`,
            at: nowIso(),
          },
        ]);
      }
    }
    return ap;
  }

  /** Stop an agent: pause it and abort its running work (tasks go back to the queue). */
  stopAgent(agentId: string, actor: string): void {
    const agent = this.d.agents.setPaused(agentId, true);
    for (const [taskId, { ctrl, agentId: aid }] of this.controllers) {
      if (aid !== agentId) continue;
      const t = this.d.store.getTask(taskId);
      this.d.store.updateTask(taskId, { status: t.pinned ? 'assigned' : 'pending', attempts: Math.max(0, t.attempts - 1), agentId: t.pinned ? t.agentId : null });
      this.d.store.addStep(taskId, `Interrupted: ${agent.name} was stopped by the manager`, 'info');
      ctrl.abort();
    }
    this.d.runtime.setActivity(agentId, 'idle', 'Stopped by manager', { currentTaskId: null });
    this.d.audit.log(actor, 'agent.stop', { type: 'agent', id: agentId });
    this.d.activity.record({ type: 'agent.stopped', level: 'warning', message: `${agent.name} stopped by manager`, agentId });
    void this.tick();
  }

  /** Before deleting an agent: release its non-terminal tasks. */
  releaseAgent(agentId: string): void {
    this.stopAgent(agentId, 'system');
    for (const t of this.d.store.listTasks({ agentId })) {
      if (!TERMINAL.includes(t.status)) this.d.store.updateTask(t.id, { agentId: null, pinned: false, status: t.status === 'assigned' ? 'pending' : t.status });
    }
  }

  emergencyStop(actor: string): number {
    this.d.settings.setFlag('emergency_stop', true);
    let n = 0;
    for (const [taskId, { ctrl }] of this.controllers) {
      const t = this.d.store.getTask(taskId);
      this.d.store.updateTask(taskId, { status: t.pinned ? 'assigned' : 'pending', attempts: Math.max(0, t.attempts - 1), waitingReason: 'Emergency stop – queue paused' });
      this.d.store.addStep(taskId, 'Interrupted by emergency stop', 'info');
      ctrl.abort();
      n++;
    }
    for (const c of this.planControllers.values()) c.abort();
    this.d.audit.log(actor, 'system.emergency_stop', { type: 'system' }, { interrupted: n });
    this.d.activity.record({ type: 'system.emergency_stop', level: 'error', message: `EMERGENCY STOP by ${actor}: ${n} running task(s) interrupted, queue paused` });
    return n;
  }

  resume(actor: string): void {
    this.d.settings.setFlag('emergency_stop', false);
    this.d.audit.log(actor, 'system.resume', { type: 'system' });
    this.d.activity.record({ type: 'system.resumed', level: 'success', message: `Queue resumed by ${actor}` });
    for (const m of this.d.store.listMissions({ status: 'planning' })) if (!this.planControllers.has(m.id) && !this.d.store.listTasks({ missionId: m.id }).length) this.track(this.planMission(m.id));
    void this.tick();
  }

  // ======================================================================
  // global chat with the CEO Assistant
  // ======================================================================
  async chat(text: string, fileIds: string[], actor: string): Promise<void> {
    this.d.comms.post({
      channel: 'global',
      kind: 'message',
      fromType: 'user',
      fromName: actor,
      toType: 'agent',
      content: text,
      attachments: fileIds.map((id) => ({ fileId: id, name: this.safeFileName(id) })),
    });
    this.track(this.replyAsCoordinator(text, fileIds, actor));
  }

  private statusSnapshot(): string {
    const missions = this.d.store.listMissions({ limit: 10 });
    const agents = this.d.agents.list();
    const approvals = this.d.approvals.list('pending');
    const waiting = this.d.store.listTasks({ status: ['waiting'], limit: 20 });
    return [
      `Now: ${nowIso()}`,
      `Agents (${agents.length}): ${agents.map((a) => `${a.name} [${a.roleKey}] ${a.paused ? 'paused' : a.activity}${a.activityDetail ? ` – ${a.activityDetail}` : ''}`).join('; ') || 'none'}`,
      `Recent missions:\n${missions.map((m) => `- ${m.title}: ${m.status} (${m.progress?.completed ?? 0}/${m.progress?.total ?? 0} tasks done)`).join('\n') || '- none'}`,
      `Tasks waiting: ${waiting.map((t) => `"${t.title}" (${t.waitingReason})`).join('; ') || 'none'}`,
      `Pending approvals: ${approvals.map((a) => a.actionType).join('; ') || 'none'}`,
      `Queue: ${this.emergencyStopped ? 'PAUSED (emergency stop)' : 'running'}`,
    ].join('\n');
  }

  private async replyAsCoordinator(text: string, fileIds: string[], actor: string): Promise<void> {
    const coord = this.pickCoordinator();
    if (!coord) {
      this.d.comms.post({
        channel: 'global',
        kind: 'error',
        fromType: 'system',
        fromName: 'Orchestrator',
        content: 'No CEO Assistant is available. Create an agent with the "CEO Assistant" role (Agents page) to chat, or submit work through the Command Center.',
      });
      return;
    }
    if (fileIds.length) await this.d.files.waitFor(fileIds);
    this.d.runtime.setActivity(coord.id, 'thinking', 'Replying to the manager');
    try {
      const history = this.d.comms
        .list({ channel: 'global', limit: 16 })
        .map((m) => `[${m.fromType === 'user' ? 'Manager' : m.fromName ?? m.fromType}] ${truncate(m.content, 1500)}`)
        .join('\n');
      const pseudoMission = { attachments: fileIds, projectId: this.d.projects.ensureDefault().id } as Mission;
      const att = this.d.context.attachmentsBlock(coord, pseudoMission, 60_000);
      const system = `${this.d.context.systemFor(coord, { protocol: false })}

## Chat mode
You are chatting with the manager in the Global Chat. Use the office status snapshot to answer questions about progress.
When the manager asks for actual work to be done by the team (research, writing, coding, analysis…), launch a mission by appending:
\`\`\`mao-actions
{"create_mission": {"title": "<short title>", "request": "<complete, self-contained request including all details from the conversation>"}}
\`\`\`
and briefly confirm what you launched. Do not launch missions for simple questions you can answer yourself. Never invent progress that is not in the snapshot.`;
      const user = `# Office status snapshot\n${this.statusSnapshot()}\n\n# Conversation so far\n${history}\n\n# Manager's new message\n${text}${att.text ? `\n\n# Attached files\n${att.text}` : ''}`;
      const ctrl = new AbortController();
      const res = await this.d.runtime.invoke(coord, { system, messages: [{ role: 'user', content: user, images: att.images.length ? att.images : undefined }], signal: ctrl.signal, onFailover: (f) => this.announceFailover(f, coord) });
      const { output, actions } = parseAgentOutput(res.text);
      this.d.comms.post({ channel: 'global', kind: 'message', fromType: 'agent', fromId: coord.id, fromName: coord.name, toType: 'user', content: output || '(no reply text)' });
      if (actions.create_mission) {
        const m = await this.submitMission({ text: actions.create_mission.request, title: actions.create_mission.title, fileIds }, actor);
        this.d.activity.record({ type: 'mission.created', message: `${coord.name} launched mission "${m.title}" from chat`, missionId: m.id, agentId: coord.id });
      }
      this.d.runtime.setActivity(coord.id, 'idle', null);
    } catch (e) {
      this.d.comms.post({ channel: 'global', kind: 'error', fromType: 'system', fromName: 'Orchestrator', content: `${coord.name} could not reply: ${errorMessage(e)}` });
      this.d.runtime.setActivity(coord.id, 'error', truncate(errorMessage(e), 160), { revertMs: 20_000 });
    }
  }

  // ======================================================================
  // introspection
  // ======================================================================
  runningTaskIds(): string[] {
    return [...this.controllers.keys()];
  }
}

function hasActions(a: AgentActions): boolean {
  return !!(a.help_requests?.length || a.question_for_manager || a.approval_request || a.messages?.length);
}
