import { z } from 'zod';
import type { Database } from '../db/database.js';
import type { EventBus } from '../core/eventBus.js';
import { badRequest, newId, notFound, nowIso, truncate } from '../core/util.js';

export type KnowledgeScope = 'global' | 'project' | 'agent';

export interface KnowledgeEntry {
  id: string;
  scope: KnowledgeScope;
  projectId: string | null;
  agentId: string | null;
  title: string;
  content: string;
  tags: string;
  sourceType: 'manual' | 'task_output' | 'file' | 'agent_memory';
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const knowledgeInputSchema = z.object({
  scope: z.enum(['global', 'project', 'agent']),
  projectId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(200_000),
  tags: z.string().max(500).default(''),
});

const STOP = new Set('the a an and or of to in on for with is are be this that it as at by from le la de và của là các cho với trong một những được có không'.split(' '));

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

/**
 * Knowledge & memory with three permission scopes:
 *  global  – visible to every agent allowed to read global knowledge
 *  project – visible to agents working on that project
 *  agent   – private memory of one agent
 */
export class KnowledgeService {
  constructor(
    private db: Database,
    private bus: EventBus,
  ) {}

  private map(r: any): KnowledgeEntry {
    return {
      id: r.id,
      scope: r.scope,
      projectId: r.project_id,
      agentId: r.agent_id,
      title: r.title,
      content: r.content,
      tags: r.tags,
      sourceType: r.source_type,
      sourceId: r.source_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  list(filter: { scope?: KnowledgeScope; projectId?: string; agentId?: string; q?: string } = {}): KnowledgeEntry[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.scope) (where.push('scope = ?'), params.push(filter.scope));
    if (filter.projectId) (where.push('project_id = ?'), params.push(filter.projectId));
    if (filter.agentId) (where.push('agent_id = ?'), params.push(filter.agentId));
    if (filter.q) (where.push('(title LIKE ? OR content LIKE ? OR tags LIKE ?)'), params.push(`%${filter.q}%`, `%${filter.q}%`, `%${filter.q}%`));
    return this.db
      .all(`SELECT * FROM knowledge ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 500`, params)
      .map((r) => this.map(r));
  }

  get(id: string): KnowledgeEntry {
    const r = this.db.get('SELECT * FROM knowledge WHERE id = ?', [id]);
    if (!r) throw notFound('Knowledge entry');
    return this.map(r);
  }

  create(input: z.input<typeof knowledgeInputSchema>, source: { type?: KnowledgeEntry['sourceType']; id?: string } = {}): KnowledgeEntry {
    const d = knowledgeInputSchema.parse(input);
    if (d.scope === 'project' && !d.projectId) throw badRequest('projectId is required for project knowledge');
    if (d.scope === 'agent' && !d.agentId) throw badRequest('agentId is required for agent knowledge');
    const id = newId('kno');
    const now = nowIso();
    this.db.run(
      `INSERT INTO knowledge (id, scope, project_id, agent_id, title, content, tags, source_type, source_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        d.scope,
        d.scope === 'project' ? d.projectId : d.scope === 'agent' ? (d.projectId ?? null) : null,
        d.scope === 'agent' ? d.agentId : null,
        d.title,
        d.content,
        d.tags,
        source.type ?? 'manual',
        source.id ?? null,
        now,
        now,
      ],
    );
    this.bus.publish('knowledge.updated', { id });
    return this.get(id);
  }

  update(id: string, patch: { title?: string; content?: string; tags?: string }): KnowledgeEntry {
    const cur = this.get(id);
    this.db.run('UPDATE knowledge SET title = ?, content = ?, tags = ?, updated_at = ? WHERE id = ?', [
      patch.title ?? cur.title,
      patch.content ?? cur.content,
      patch.tags ?? cur.tags,
      nowIso(),
      id,
    ]);
    this.bus.publish('knowledge.updated', { id });
    return this.get(id);
  }

  delete(id: string): void {
    this.get(id);
    this.db.run('DELETE FROM knowledge WHERE id = ?', [id]);
    this.bus.publish('knowledge.updated', { id, deleted: true });
  }

  /**
   * Retrieve knowledge visible to an agent, ranked by keyword overlap with the query.
   * Permission filtering happens here (scopes allowed by the agent's permissions).
   */
  retrieve(opts: { agentId: string; projectId: string | null; scopes: KnowledgeScope[]; query: string; maxChars: number }): KnowledgeEntry[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.scopes.includes('global')) clauses.push("scope = 'global'");
    if (opts.scopes.includes('project') && opts.projectId) (clauses.push("(scope = 'project' AND project_id = ?)"), params.push(opts.projectId));
    if (opts.scopes.includes('agent')) (clauses.push("(scope = 'agent' AND agent_id = ?)"), params.push(opts.agentId));
    if (!clauses.length) return [];
    const rows = this.db.all(`SELECT * FROM knowledge WHERE ${clauses.join(' OR ')} ORDER BY updated_at DESC LIMIT 300`, params).map((r) => this.map(r));
    const q = new Set(tokens(opts.query));
    const scored = rows
      .map((k) => {
        const t = tokens(`${k.title} ${k.tags} ${k.content.slice(0, 5000)}`);
        let score = 0;
        for (const tok of t) if (q.has(tok)) score++;
        // Pinned-ish: short manual project/global notes are generally relevant instructions.
        if (k.sourceType === 'manual' && k.content.length < 2000) score += 0.5;
        return { k, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);
    const out: KnowledgeEntry[] = [];
    let budget = opts.maxChars;
    for (const { k } of scored) {
      if (budget <= 200) break;
      const content = truncate(k.content, Math.min(budget, 4000));
      out.push({ ...k, content });
      budget -= content.length + k.title.length;
    }
    return out;
  }
}
