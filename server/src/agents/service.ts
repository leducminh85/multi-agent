import { z } from 'zod';
import type { Database } from '../db/database.js';
import { parseJson } from '../db/database.js';
import type { EventBus } from '../core/eventBus.js';
import { HttpError, newId, notFound, nowIso } from '../core/util.js';
import { defaultLimits, defaultPermissions, limitsSchema, permissionsSchema, type AgentLimits, type AgentPermissions } from './permissions.js';
import type { RoleService } from './roles.js';
import { DEPARTMENTS } from './roles.js';

export const AGENT_ACTIVITIES = [
  'idle',
  'working',
  'thinking',
  'reading',
  'writing',
  'coding',
  'discussing',
  'waiting',
  'error',
  'completed',
] as const;
export type AgentActivity = (typeof AGENT_ACTIVITIES)[number];

export interface Agent {
  id: string;
  name: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  providerId: string | null;
  providerName: string | null;
  providerType: string | null;
  model: string | null;
  systemPrompt: string;
  specialties: string;
  department: string;
  enabled: boolean;
  paused: boolean;
  activity: AgentActivity;
  activityDetail: string | null;
  currentTaskId: string | null;
  permissions: AgentPermissions;
  limits: AgentLimits;
  appearance: Record<string, unknown>;
  lastActiveAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const agentInputSchema = z.object({
  name: z.string().min(1).max(60),
  roleId: z.string().min(1),
  providerId: z.string().nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  systemPrompt: z.string().max(20000).default(''),
  specialties: z.string().max(1000).default(''),
  department: z.enum(DEPARTMENTS).nullable().optional(),
  enabled: z.boolean().default(true),
  permissions: permissionsSchema.partial().optional(),
  limits: limitsSchema.partial().optional(),
  appearance: z.record(z.unknown()).optional(),
});
export type AgentInput = z.input<typeof agentInputSchema>;

const PALETTE = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#fb923c', '#a3e635', '#e879f9'];

export class AgentService {
  constructor(
    private db: Database,
    private bus: EventBus,
    private roles: RoleService,
  ) {}

  private map(r: any): Agent {
    return {
      id: r.id,
      name: r.name,
      roleId: r.role_id,
      roleKey: r.role_key,
      roleName: r.role_name,
      providerId: r.provider_id,
      providerName: r.provider_name ?? null,
      providerType: r.provider_type ?? null,
      model: r.model,
      systemPrompt: r.system_prompt,
      specialties: r.specialties,
      department: r.department ?? r.role_department,
      enabled: !!r.enabled,
      paused: !!r.paused,
      activity: r.activity,
      activityDetail: r.activity_detail,
      currentTaskId: r.current_task_id,
      permissions: permissionsSchema.parse(parseJson(r.permissions, {})),
      limits: limitsSchema.parse(parseJson(r.limits, {})),
      appearance: parseJson(r.appearance, {}),
      lastActiveAt: r.last_active_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private static SELECT = `SELECT a.*, r.key AS role_key, r.name AS role_name, r.department AS role_department,
      p.name AS provider_name, p.type AS provider_type
    FROM agents a JOIN roles r ON r.id = a.role_id LEFT JOIN providers p ON p.id = a.provider_id`;

  list(): Agent[] {
    return this.db.all(`${AgentService.SELECT} ORDER BY a.created_at`).map((r) => this.map(r));
  }

  get(id: string): Agent {
    const r = this.db.get(`${AgentService.SELECT} WHERE a.id = ?`, [id]);
    if (!r) throw notFound('Agent');
    return this.map(r);
  }

  find(id: string): Agent | undefined {
    const r = this.db.get(`${AgentService.SELECT} WHERE a.id = ?`, [id]);
    return r ? this.map(r) : undefined;
  }

  findByName(name: string): Agent | undefined {
    const r = this.db.get(`${AgentService.SELECT} WHERE lower(a.name) = lower(?)`, [name]);
    return r ? this.map(r) : undefined;
  }

  create(input: AgentInput): Agent {
    const d = agentInputSchema.parse(input);
    const role = this.roles.get(d.roleId);
    if (d.providerId && !this.db.get('SELECT id FROM providers WHERE id = ?', [d.providerId])) throw new HttpError(400, 'Provider not found');
    const id = newId('agt');
    const now = nowIso();
    const count = (this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM agents')?.n ?? 0) as number;
    const appearance = { color: PALETTE[count % PALETTE.length], hair: count % 5, ...(d.appearance ?? {}) };
    this.db.run(
      `INSERT INTO agents (id, name, role_id, provider_id, model, system_prompt, specialties, department, enabled, paused, status, activity,
        permissions, limits, appearance, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,'idle','idle',?,?,?,?,?)`,
      [
        id,
        d.name,
        role.id,
        d.providerId ?? null,
        d.model ?? null,
        d.systemPrompt,
        d.specialties,
        d.department ?? null,
        d.enabled,
        JSON.stringify({ ...defaultPermissions(), ...(d.permissions ?? {}) }),
        JSON.stringify({ ...defaultLimits(), ...(d.limits ?? {}) }),
        JSON.stringify(appearance),
        now,
        now,
      ],
    );
    const a = this.get(id);
    this.bus.publish('agent.updated', a);
    return a;
  }

  update(id: string, patch: Partial<AgentInput>): Agent {
    const cur = this.get(id);
    const d = agentInputSchema.partial().parse(patch);
    if (d.roleId) this.roles.get(d.roleId);
    if (d.providerId && !this.db.get('SELECT id FROM providers WHERE id = ?', [d.providerId])) throw new HttpError(400, 'Provider not found');
    this.db.run(
      `UPDATE agents SET name = ?, role_id = ?, provider_id = ?, model = ?, system_prompt = ?, specialties = ?, department = ?, enabled = ?,
        permissions = ?, limits = ?, appearance = ?, updated_at = ? WHERE id = ?`,
      [
        d.name ?? cur.name,
        d.roleId ? this.roles.get(d.roleId).id : cur.roleId,
        d.providerId !== undefined ? d.providerId : cur.providerId,
        d.model !== undefined ? d.model : cur.model,
        d.systemPrompt ?? cur.systemPrompt,
        d.specialties ?? cur.specialties,
        d.department !== undefined ? d.department : this.db.get<any>('SELECT department FROM agents WHERE id = ?', [id])?.department,
        d.enabled ?? cur.enabled,
        JSON.stringify({ ...cur.permissions, ...(d.permissions ?? {}) }),
        JSON.stringify({ ...cur.limits, ...(d.limits ?? {}) }),
        JSON.stringify({ ...cur.appearance, ...(d.appearance ?? {}) }),
        nowIso(),
        id,
      ],
    );
    const a = this.get(id);
    this.bus.publish('agent.updated', a);
    return a;
  }

  delete(id: string): void {
    this.get(id);
    this.db.run('DELETE FROM agents WHERE id = ?', [id]);
    this.db.run("DELETE FROM knowledge WHERE scope = 'agent' AND agent_id = ?", [id]);
    this.bus.publish('agent.deleted', { id });
  }

  setPaused(id: string, paused: boolean): Agent {
    this.get(id);
    this.db.run('UPDATE agents SET paused = ?, updated_at = ? WHERE id = ?', [paused, nowIso(), id]);
    const a = this.get(id);
    this.bus.publish('agent.updated', a);
    return a;
  }

  /** Runtime state: what the agent is doing right now (drives dashboard + virtual office). */
  setActivity(id: string, activity: AgentActivity, detail: string | null, currentTaskId?: string | null): void {
    const sets = ['activity = ?', 'activity_detail = ?', 'last_active_at = ?'];
    const params: unknown[] = [activity, detail, nowIso()];
    if (currentTaskId !== undefined) {
      sets.push('current_task_id = ?');
      params.push(currentTaskId);
    }
    params.push(id);
    const r = this.db.run(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`, params);
    if (r.changes) this.bus.publish('agent.updated', this.get(id));
  }
}
