import type { Database } from '../db/database.js';
import { parseJson } from '../db/database.js';
import type { EventBus } from '../core/eventBus.js';
import { newId, notFound, nowIso } from '../core/util.js';

export const TASK_STATUSES = ['pending', 'planning', 'assigned', 'running', 'waiting', 'reviewing', 'completed', 'failed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TERMINAL: TaskStatus[] = ['completed', 'failed', 'cancelled'];
/** Statuses that occupy an execution slot. */
export const ACTIVE: TaskStatus[] = ['running', 'reviewing'];
export type TaskKind = 'work' | 'help' | 'review' | 'synthesis' | 'direct';

export type MissionStatus = 'planning' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ExtraContext {
  kind: 'help_result' | 'manager_answer' | 'approval' | 'note' | 'previous_output';
  label: string;
  content: string;
  at: string;
}

export interface TaskStep {
  id: string;
  taskId: string;
  label: string;
  status: 'running' | 'done' | 'failed' | 'info';
  detail: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Task {
  id: string;
  missionId: string | null;
  projectId: string | null;
  parentTaskId: string | null;
  key: string | null;
  title: string;
  description: string;
  kind: TaskKind;
  roleKey: string | null;
  agentId: string | null;
  agentName: string | null;
  providerId: string | null;
  providerName: string | null;
  status: TaskStatus;
  progress: number | null;
  dependsOn: string[];
  output: string | null;
  errorLog: string;
  attempts: number;
  maxAttempts: number;
  waitingReason: string | null;
  extraContext: ExtraContext[];
  pinned: boolean;
  notBefore: string | null;
  depth: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  steps?: TaskStep[];
}

export interface Mission {
  id: string;
  projectId: string;
  title: string;
  requestText: string;
  attachments: string[];
  status: MissionStatus;
  intent: string | null;
  plan: unknown;
  result: string | null;
  error: string | null;
  plannerAgentId: string | null;
  options: { mode?: 'auto' | 'direct'; agentId?: string };
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  taskCounts?: Record<string, number>;
  progress?: { completed: number; total: number };
}

export interface NewTask {
  missionId: string | null;
  projectId: string | null;
  parentTaskId?: string | null;
  key?: string | null;
  title: string;
  description: string;
  kind?: TaskKind;
  roleKey?: string | null;
  agentId?: string | null;
  pinned?: boolean;
  dependsOn?: string[];
  maxAttempts: number;
  depth?: number;
  status?: TaskStatus;
}

const TASK_SELECT = `SELECT t.*, a.name AS agent_name, p.name AS provider_name FROM tasks t
  LEFT JOIN agents a ON a.id = t.agent_id LEFT JOIN providers p ON p.id = t.provider_id`;

/** Persistence for missions, tasks and task steps (the task queue's source of truth). */
export class Store {
  constructor(
    private db: Database,
    private bus: EventBus,
  ) {}

  // ---------------- missions ----------------
  private mapMission(r: any): Mission {
    return {
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      requestText: r.request_text,
      attachments: parseJson(r.attachments, []),
      status: r.status,
      intent: r.intent,
      plan: parseJson(r.plan, null),
      result: r.result,
      error: r.error,
      plannerAgentId: r.planner_agent_id,
      options: parseJson(r.options, {}),
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
    };
  }

  createMission(m: { projectId: string; title: string; requestText: string; attachments: string[]; options: Mission['options'] }): Mission {
    const id = newId('mis');
    this.db.run(
      'INSERT INTO missions (id, project_id, title, request_text, attachments, status, options, created_at, started_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, m.projectId, m.title, m.requestText, JSON.stringify(m.attachments), 'planning', JSON.stringify(m.options), nowIso(), nowIso()],
    );
    return this.publishMission(id);
  }

  updateMission(id: string, patch: Partial<Pick<Mission, 'status' | 'intent' | 'plan' | 'result' | 'error' | 'plannerAgentId' | 'title' | 'finishedAt'>>): Mission {
    const cols: Record<string, string> = {
      status: 'status',
      intent: 'intent',
      plan: 'plan',
      result: 'result',
      error: 'error',
      plannerAgentId: 'planner_agent_id',
      title: 'title',
      finishedAt: 'finished_at',
    };
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${cols[k]} = ?`);
      params.push(k === 'plan' ? JSON.stringify(v) : v);
    }
    if (sets.length) this.db.run(`UPDATE missions SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    return this.publishMission(id);
  }

  private publishMission(id: string): Mission {
    const m = this.getMission(id);
    this.bus.publish('mission.updated', m);
    return m;
  }

  getMission(id: string): Mission {
    const r = this.db.get('SELECT * FROM missions WHERE id = ?', [id]);
    if (!r) throw notFound('Mission');
    return this.withCounts(this.mapMission(r));
  }

  private withCounts(m: Mission): Mission {
    const rows = this.db.all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM tasks WHERE mission_id = ? GROUP BY status", [m.id]);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      counts[r.status] = r.n;
      if (r.status !== 'cancelled') total += r.n;
    }
    m.taskCounts = counts;
    m.progress = { completed: counts.completed ?? 0, total };
    return m;
  }

  listMissions(filter: { projectId?: string; status?: string; limit?: number } = {}): Mission[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.projectId) (where.push('project_id = ?'), params.push(filter.projectId));
    if (filter.status) (where.push('status = ?'), params.push(filter.status));
    return this.db
      .all(`SELECT * FROM missions ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${Math.min(filter.limit ?? 100, 500)}`, params)
      .map((r) => this.withCounts(this.mapMission(r)));
  }

  deleteMission(id: string): void {
    this.db.run('DELETE FROM missions WHERE id = ?', [id]);
    this.bus.publish('mission.updated', { id, deleted: true });
  }

  // ---------------- tasks ----------------
  private mapTask(r: any): Task {
    return {
      id: r.id,
      missionId: r.mission_id,
      projectId: r.project_id,
      parentTaskId: r.parent_task_id,
      key: r.key,
      title: r.title,
      description: r.description,
      kind: r.kind,
      roleKey: r.role_key,
      agentId: r.agent_id,
      agentName: r.agent_name ?? null,
      providerId: r.provider_id,
      providerName: r.provider_name ?? null,
      status: r.status,
      progress: r.progress,
      dependsOn: parseJson(r.depends_on, []),
      output: r.output,
      errorLog: r.error_log,
      attempts: r.attempts,
      maxAttempts: r.max_attempts,
      waitingReason: r.waiting_reason,
      extraContext: parseJson(r.extra_context, []),
      pinned: !!r.pinned,
      notBefore: r.not_before,
      depth: r.depth,
      createdAt: r.created_at,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      updatedAt: r.updated_at,
    };
  }

  createTask(t: NewTask): Task {
    const id = newId('tsk');
    const now = nowIso();
    this.db.run(
      `INSERT INTO tasks (id, mission_id, project_id, parent_task_id, key, title, description, kind, role_key, agent_id, status, depends_on,
        max_attempts, pinned, depth, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        t.missionId,
        t.projectId,
        t.parentTaskId ?? null,
        t.key ?? null,
        t.title,
        t.description,
        t.kind ?? 'work',
        t.roleKey ?? null,
        t.agentId ?? null,
        t.status ?? (t.agentId ? 'assigned' : 'pending'),
        JSON.stringify(t.dependsOn ?? []),
        t.maxAttempts,
        !!t.pinned,
        t.depth ?? 0,
        now,
        now,
      ],
    );
    return this.publishTask(id);
  }

  updateTask(
    id: string,
    patch: Partial<{
      status: TaskStatus;
      agentId: string | null;
      providerId: string | null;
      progress: number | null;
      output: string | null;
      attempts: number;
      maxAttempts: number;
      waitingReason: string | null;
      extraContext: ExtraContext[];
      pinned: boolean;
      notBefore: string | null;
      startedAt: string | null;
      finishedAt: string | null;
      dependsOn: string[];
      title: string;
      description: string;
      roleKey: string | null;
    }>,
  ): Task {
    const map: Record<string, string> = {
      status: 'status',
      agentId: 'agent_id',
      providerId: 'provider_id',
      progress: 'progress',
      output: 'output',
      attempts: 'attempts',
      maxAttempts: 'max_attempts',
      waitingReason: 'waiting_reason',
      extraContext: 'extra_context',
      pinned: 'pinned',
      notBefore: 'not_before',
      startedAt: 'started_at',
      finishedAt: 'finished_at',
      dependsOn: 'depends_on',
      title: 'title',
      description: 'description',
      roleKey: 'role_key',
    };
    const sets: string[] = ['updated_at = ?'];
    const params: unknown[] = [nowIso()];
    for (const [k, v] of Object.entries(patch)) {
      sets.push(`${map[k]} = ?`);
      params.push(v);
    }
    this.db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    return this.publishTask(id);
  }

  appendError(id: string, line: string): void {
    this.db.run("UPDATE tasks SET error_log = error_log || ? WHERE id = ?", [`[${nowIso()}] ${line}\n`, id]);
  }

  private publishTask(id: string): Task {
    const t = this.getTask(id);
    this.bus.publish('task.updated', t);
    return t;
  }

  getTask(id: string, withSteps = false): Task {
    const r = this.db.get(`${TASK_SELECT} WHERE t.id = ?`, [id]);
    if (!r) throw notFound('Task');
    const t = this.mapTask(r);
    if (withSteps) t.steps = this.steps(id);
    return t;
  }

  findTask(id: string): Task | undefined {
    const r = this.db.get(`${TASK_SELECT} WHERE t.id = ?`, [id]);
    return r ? this.mapTask(r) : undefined;
  }

  listTasks(filter: { missionId?: string; projectId?: string; agentId?: string; status?: string[]; limit?: number } = {}): Task[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.missionId) (where.push('t.mission_id = ?'), params.push(filter.missionId));
    if (filter.projectId) (where.push('t.project_id = ?'), params.push(filter.projectId));
    if (filter.agentId) (where.push('t.agent_id = ?'), params.push(filter.agentId));
    if (filter.status?.length) {
      where.push(`t.status IN (${filter.status.map(() => '?').join(',')})`);
      params.push(...filter.status);
    }
    return this.db
      .all(`${TASK_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.created_at DESC LIMIT ${Math.min(filter.limit ?? 500, 2000)}`, params)
      .map((r) => this.mapTask(r));
  }

  /** Tasks that may be scheduled: not terminal/running and past their retry delay. */
  schedulable(): Task[] {
    return this.db
      .all(`${TASK_SELECT} WHERE t.status IN ('pending','assigned') AND (t.not_before IS NULL OR t.not_before <= ?) ORDER BY t.created_at`, [nowIso()])
      .map((r) => this.mapTask(r));
  }

  countRunning(filter: { agentId?: string; providerId?: string } = {}): number {
    if (filter.agentId) return this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('running','reviewing') AND agent_id = ?", [filter.agentId])!.n;
    if (filter.providerId) return this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('running','reviewing') AND provider_id = ?", [filter.providerId])!.n;
    return this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('running','reviewing')")!.n;
  }

  // ---------------- steps ----------------
  addStep(taskId: string, label: string, status: TaskStep['status'] = 'running', detail: string | null = null): TaskStep {
    const s: TaskStep = { id: newId('stp'), taskId, label, status, detail, createdAt: nowIso(), finishedAt: status === 'running' ? null : nowIso() };
    this.db.run('INSERT INTO task_steps (id, task_id, label, status, detail, created_at, finished_at) VALUES (?,?,?,?,?,?,?)', [
      s.id,
      s.taskId,
      s.label,
      s.status,
      s.detail,
      s.createdAt,
      s.finishedAt,
    ]);
    this.bus.publish('task.step', s);
    return s;
  }

  finishStep(stepId: string, status: 'done' | 'failed', detail?: string | null): void {
    this.db.run('UPDATE task_steps SET status = ?, detail = COALESCE(?, detail), finished_at = ? WHERE id = ?', [status, detail ?? null, nowIso(), stepId]);
    const r = this.db.get<any>('SELECT * FROM task_steps WHERE id = ?', [stepId]);
    if (r)
      this.bus.publish('task.step', {
        id: r.id,
        taskId: r.task_id,
        label: r.label,
        status: r.status,
        detail: r.detail,
        createdAt: r.created_at,
        finishedAt: r.finished_at,
      });
  }

  updateStepDetail(stepId: string, detail: string): void {
    this.db.run('UPDATE task_steps SET detail = ? WHERE id = ?', [detail, stepId]);
  }

  steps(taskId: string): TaskStep[] {
    return this.db.all<any>('SELECT * FROM task_steps WHERE task_id = ? ORDER BY created_at, rowid', [taskId]).map((r) => ({
      id: r.id,
      taskId: r.task_id,
      label: r.label,
      status: r.status,
      detail: r.detail,
      createdAt: r.created_at,
      finishedAt: r.finished_at,
    }));
  }

  /** Close any step left "running" (e.g. after a crash or cancellation). */
  closeOpenSteps(taskId: string, status: 'done' | 'failed' = 'failed'): void {
    this.db.run("UPDATE task_steps SET status = ?, finished_at = ? WHERE task_id = ? AND status = 'running'", [status, nowIso(), taskId]);
  }
}
