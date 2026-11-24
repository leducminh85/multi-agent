import type { Database } from '../db/database.js';
import { parseJson } from '../db/database.js';
import type { EventBus } from './eventBus.js';
import { newId, nowIso } from './util.js';

export interface Activity {
  id: string;
  type: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  missionId: string | null;
  taskId: string | null;
  agentId: string | null;
  providerId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityInput {
  type: string;
  level?: Activity['level'];
  message: string;
  missionId?: string | null;
  taskId?: string | null;
  agentId?: string | null;
  providerId?: string | null;
  data?: Record<string, unknown>;
}

/** Real-time activity feed: persisted, and broadcast over the event bus. */
export class ActivityService {
  constructor(
    private db: Database,
    private bus: EventBus,
  ) {}

  record(input: ActivityInput): Activity {
    const a: Activity = {
      id: newId('act'),
      type: input.type,
      level: input.level ?? 'info',
      message: input.message,
      missionId: input.missionId ?? null,
      taskId: input.taskId ?? null,
      agentId: input.agentId ?? null,
      providerId: input.providerId ?? null,
      data: input.data ?? {},
      createdAt: nowIso(),
    };
    this.db.run(
      'INSERT INTO activities (id, type, level, message, mission_id, task_id, agent_id, provider_id, data, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [a.id, a.type, a.level, a.message, a.missionId, a.taskId, a.agentId, a.providerId, JSON.stringify(a.data), a.createdAt],
    );
    this.bus.publish('activity.created', a);
    return a;
  }

  list(filter: { agentId?: string; missionId?: string; taskId?: string; limit?: number; before?: string } = {}): Activity[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.agentId) (where.push('agent_id = ?'), params.push(filter.agentId));
    if (filter.missionId) (where.push('mission_id = ?'), params.push(filter.missionId));
    if (filter.taskId) (where.push('task_id = ?'), params.push(filter.taskId));
    if (filter.before) (where.push('created_at < ?'), params.push(filter.before));
    const limit = Math.min(filter.limit ?? 100, 500);
    return this.db
      .all<any>(`SELECT * FROM activities ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${limit}`, params)
      .map((r) => ({
        id: r.id,
        type: r.type,
        level: r.level,
        message: r.message,
        missionId: r.mission_id,
        taskId: r.task_id,
        agentId: r.agent_id,
        providerId: r.provider_id,
        data: parseJson(r.data, {}),
        createdAt: r.created_at,
      }));
  }
}
