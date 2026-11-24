import type { Database } from '../db/database.js';
import { parseJson } from '../db/database.js';
import type { EventBus } from '../core/eventBus.js';
import { newId, nowIso } from '../core/util.js';

export type MessageKind = 'message' | 'result' | 'help_request' | 'error' | 'proposal' | 'document' | 'question' | 'report';
export type Channel = 'global' | 'agents';

export interface Message {
  id: string;
  missionId: string | null;
  taskId: string | null;
  channel: Channel;
  kind: MessageKind;
  fromType: 'user' | 'agent' | 'system';
  fromId: string | null;
  fromName: string | null;
  toType: 'user' | 'agent' | 'broadcast' | null;
  toId: string | null;
  toName: string | null;
  content: string;
  attachments: { fileId: string; name: string }[];
  createdAt: string;
}

export interface MessageInput {
  missionId?: string | null;
  taskId?: string | null;
  channel: Channel;
  kind?: MessageKind;
  fromType: Message['fromType'];
  fromId?: string | null;
  fromName?: string | null;
  toType?: Message['toType'];
  toId?: string | null;
  toName?: string | null;
  content: string;
  attachments?: Message['attachments'];
}

/**
 * Communication Center.
 * - channel "global": manager ⇄ CEO Assistant conversation (and agent questions to the manager)
 * - channel "agents": agent-to-agent messages (results, help requests, proposals, error reports)
 */
export class CommsService {
  constructor(
    private db: Database,
    private bus: EventBus,
  ) {}

  post(input: MessageInput): Message {
    const m: Message = {
      id: newId('msg'),
      missionId: input.missionId ?? null,
      taskId: input.taskId ?? null,
      channel: input.channel,
      kind: input.kind ?? 'message',
      fromType: input.fromType,
      fromId: input.fromId ?? null,
      fromName: input.fromName ?? null,
      toType: input.toType ?? null,
      toId: input.toId ?? null,
      toName: input.toName ?? null,
      content: input.content,
      attachments: input.attachments ?? [],
      createdAt: nowIso(),
    };
    this.db.run(
      `INSERT INTO messages (id, mission_id, task_id, channel, kind, from_type, from_id, from_name, to_type, to_id, to_name, content, attachments, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [m.id, m.missionId, m.taskId, m.channel, m.kind, m.fromType, m.fromId, m.fromName, m.toType, m.toId, m.toName, m.content, JSON.stringify(m.attachments), m.createdAt],
    );
    this.bus.publish('message.created', m);
    return m;
  }

  list(filter: { channel?: Channel; missionId?: string; agentId?: string; taskId?: string; limit?: number; before?: string } = {}): Message[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.channel) (where.push('channel = ?'), params.push(filter.channel));
    if (filter.missionId) (where.push('mission_id = ?'), params.push(filter.missionId));
    if (filter.taskId) (where.push('task_id = ?'), params.push(filter.taskId));
    if (filter.agentId) (where.push('(from_id = ? OR to_id = ?)'), params.push(filter.agentId, filter.agentId));
    if (filter.before) (where.push('created_at < ?'), params.push(filter.before));
    const limit = Math.min(filter.limit ?? 200, 1000);
    const rows = this.db.all<any>(
      `SELECT * FROM messages ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${limit}`,
      params,
    );
    return rows.reverse().map((r) => ({
      id: r.id,
      missionId: r.mission_id,
      taskId: r.task_id,
      channel: r.channel,
      kind: r.kind,
      fromType: r.from_type,
      fromId: r.from_id,
      fromName: r.from_name,
      toType: r.to_type,
      toId: r.to_id,
      toName: r.to_name,
      content: r.content,
      attachments: parseJson(r.attachments, []),
      createdAt: r.created_at,
    }));
  }

  /** Messages addressed to an agent that it has not seen yet within a mission (injected into its next prompt). */
  inboxFor(agentId: string, missionId: string | null, since?: string): Message[] {
    return this.list({ channel: 'agents', missionId: missionId ?? undefined, limit: 50 }).filter(
      (m) => (m.toId === agentId || m.toType === 'broadcast') && m.fromId !== agentId && (!since || m.createdAt > since),
    );
  }
}
