import type { Database } from '../db/database.js';
import { parseJson } from '../db/database.js';
import type { EventBus } from '../core/eventBus.js';
import { HttpError, newId, notFound, nowIso } from '../core/util.js';

export interface Approval {
  id: string;
  missionId: string | null;
  taskId: string | null;
  agentId: string | null;
  actionType: string;
  description: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  decidedBy: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** Human-in-the-loop gate for sensitive actions requested by agents. */
export class ApprovalService {
  constructor(
    private db: Database,
    private bus: EventBus,
  ) {}

  private map(r: any): Approval {
    return {
      id: r.id,
      missionId: r.mission_id,
      taskId: r.task_id,
      agentId: r.agent_id,
      actionType: r.action_type,
      description: r.description,
      payload: parseJson(r.payload, {}),
      status: r.status,
      decidedBy: r.decided_by,
      decisionNote: r.decision_note,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
    };
  }

  create(a: { missionId: string | null; taskId: string | null; agentId: string | null; actionType: string; description: string; payload?: Record<string, unknown> }): Approval {
    const id = newId('apv');
    this.db.run(
      'INSERT INTO approvals (id, mission_id, task_id, agent_id, action_type, description, payload, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      [id, a.missionId, a.taskId, a.agentId, a.actionType, a.description, JSON.stringify(a.payload ?? {}), 'pending', nowIso()],
    );
    const ap = this.get(id);
    this.bus.publish('approval.updated', ap);
    return ap;
  }

  get(id: string): Approval {
    const r = this.db.get('SELECT * FROM approvals WHERE id = ?', [id]);
    if (!r) throw notFound('Approval');
    return this.map(r);
  }

  list(status?: Approval['status']): Approval[] {
    return this.db
      .all(`SELECT * FROM approvals ${status ? 'WHERE status = ?' : ''} ORDER BY created_at DESC LIMIT 200`, status ? [status] : [])
      .map((r) => this.map(r));
  }

  decide(id: string, decision: 'approved' | 'rejected', user: string, note?: string): Approval {
    const a = this.get(id);
    if (a.status !== 'pending') throw new HttpError(409, 'Approval already decided');
    this.db.run('UPDATE approvals SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ?', [decision, user, note ?? null, nowIso(), id]);
    const updated = this.get(id);
    this.bus.publish('approval.updated', updated);
    return updated;
  }

  cancelForTask(taskId: string): void {
    this.db.run("UPDATE approvals SET status = 'rejected', decision_note = 'task cancelled', decided_at = ? WHERE task_id = ? AND status = 'pending'", [nowIso(), taskId]);
  }
}
