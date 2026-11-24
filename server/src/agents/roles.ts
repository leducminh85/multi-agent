import { z } from 'zod';
import type { Database } from '../db/database.js';
import type { EventBus } from '../core/eventBus.js';
import { HttpError, newId, notFound, nowIso } from '../core/util.js';

export const DEPARTMENTS = ['manager', 'main', 'research', 'development', 'design', 'content', 'meeting', 'server'] as const;
export type Department = (typeof DEPARTMENTS)[number];

/** What an agent of this role visibly does while producing output (drives the virtual office). */
export const WORK_ACTIVITIES = ['working', 'writing', 'coding', 'reading', 'thinking'] as const;

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
  department: Department;
  systemPrompt: string;
  workActivity: (typeof WORK_ACTIVITIES)[number];
  builtin: boolean;
  createdAt: string;
}

export const BUILTIN_ROLES: Omit<Role, 'id' | 'createdAt' | 'builtin'>[] = [
  {
    key: 'ceo_assistant',
    name: 'CEO Assistant',
    description: 'Executive assistant: receives requests from the manager, coordinates the team and reports back.',
    department: 'manager',
    workActivity: 'writing',
    systemPrompt:
      'You are the CEO Assistant of an AI office. You speak directly with the manager (CEO). Be concise, structured and honest about uncertainty. When you consolidate the team\'s work, produce a clear executive report: outcome, key results, open issues, next steps.',
  },
  {
    key: 'project_manager',
    name: 'Project Manager',
    description: 'Analyses requests, breaks them into tasks, sets dependencies and assigns roles.',
    department: 'main',
    workActivity: 'writing',
    systemPrompt:
      'You are an experienced technical project manager. You decompose goals into small, concrete, verifiable tasks with explicit dependencies, and pick the most suitable specialist role for each task.',
  },
  {
    key: 'researcher',
    name: 'Research Agent',
    description: 'Researches topics, gathers and synthesises information, cites sources when available.',
    department: 'research',
    workActivity: 'reading',
    systemPrompt:
      'You are a meticulous research analyst. Gather relevant facts, compare sources, separate facts from assumptions and clearly flag anything you could not verify. Never invent citations.',
  },
  {
    key: 'developer',
    name: 'Developer Agent',
    description: 'Writes, reviews and debugs code; designs technical solutions.',
    department: 'development',
    workActivity: 'coding',
    systemPrompt:
      'You are a senior software engineer. Produce correct, maintainable, well-structured code with brief explanations. State assumptions, handle errors, and include tests or verification steps where relevant.',
  },
  {
    key: 'designer',
    name: 'Designer Agent',
    description: 'UI/UX and visual design: layouts, design specs, image prompts, SVG.',
    department: 'design',
    workActivity: 'working',
    systemPrompt:
      'You are a senior product & visual designer. Deliver concrete design specifications: layout, hierarchy, colour, typography, components and states. When visuals are needed, provide precise image-generation prompts or SVG.',
  },
  {
    key: 'content',
    name: 'Content Agent',
    description: 'Writes and edits content: articles, copy, documentation, translations.',
    department: 'content',
    workActivity: 'writing',
    systemPrompt:
      'You are a professional writer and editor. Write clear, engaging, audience-appropriate content in the language requested. Respect tone, length and format constraints.',
  },
  {
    key: 'data_analyst',
    name: 'Data Analyst',
    description: 'Analyses datasets (CSV/XLSX), computes statistics and explains insights.',
    department: 'research',
    workActivity: 'thinking',
    systemPrompt:
      'You are a rigorous data analyst. Inspect the data provided, describe its structure, compute only what the data supports, and explain insights with caveats. Show calculations when useful.',
  },
  {
    key: 'qa',
    name: 'QA Agent',
    description: 'Reviews deliverables for correctness, completeness and quality.',
    department: 'development',
    workActivity: 'reading',
    systemPrompt:
      'You are a demanding QA reviewer. Check deliverables against the original request: correctness, completeness, consistency and quality. List concrete issues with severity and suggested fixes, then give a verdict.',
  },
  {
    key: 'general',
    name: 'General Agent',
    description: 'Versatile agent for any task without a dedicated specialist.',
    department: 'main',
    workActivity: 'working',
    systemPrompt: 'You are a capable generalist assistant. Complete the assigned task thoroughly and precisely.',
  },
];

export const roleInputSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{1,40}$/, 'key must be lowercase snake_case')
    .optional(),
  name: z.string().min(1).max(60),
  description: z.string().max(500).default(''),
  department: z.enum(DEPARTMENTS).default('main'),
  systemPrompt: z.string().min(1).max(20000),
  workActivity: z.enum(WORK_ACTIVITIES).default('working'),
});

export class RoleService {
  constructor(
    private db: Database,
    private bus: EventBus,
  ) {}

  seedBuiltins(): void {
    for (const r of BUILTIN_ROLES) {
      const exists = this.db.get('SELECT id FROM roles WHERE key = ?', [r.key]);
      if (!exists)
        this.db.run(
          'INSERT INTO roles (id, key, name, description, department, system_prompt, work_activity, builtin, created_at) VALUES (?,?,?,?,?,?,?,1,?)',
          [newId('rol'), r.key, r.name, r.description, r.department, r.systemPrompt, r.workActivity, nowIso()],
        );
    }
  }

  private map(r: any): Role {
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      department: r.department,
      systemPrompt: r.system_prompt,
      workActivity: r.work_activity,
      builtin: !!r.builtin,
      createdAt: r.created_at,
    };
  }

  list(): Role[] {
    return this.db.all('SELECT * FROM roles ORDER BY builtin DESC, name').map((r) => this.map(r));
  }

  get(id: string): Role {
    const r = this.db.get('SELECT * FROM roles WHERE id = ? OR key = ?', [id, id]);
    if (!r) throw notFound('Role');
    return this.map(r);
  }

  findByKey(key: string): Role | undefined {
    const r = this.db.get('SELECT * FROM roles WHERE key = ?', [key]);
    return r ? this.map(r) : undefined;
  }

  create(input: z.input<typeof roleInputSchema>): Role {
    const d = roleInputSchema.parse(input);
    const key = d.key ?? d.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(key)) throw new HttpError(400, 'Cannot derive a valid role key; provide one');
    if (this.findByKey(key)) throw new HttpError(409, `Role key "${key}" already exists`);
    const id = newId('rol');
    this.db.run(
      'INSERT INTO roles (id, key, name, description, department, system_prompt, work_activity, builtin, created_at) VALUES (?,?,?,?,?,?,?,0,?)',
      [id, key, d.name, d.description, d.department, d.systemPrompt, d.workActivity, nowIso()],
    );
    this.bus.publish('system.updated', { roles: true });
    return this.get(id);
  }

  update(id: string, patch: Partial<z.input<typeof roleInputSchema>>): Role {
    const cur = this.get(id);
    const d = roleInputSchema.partial().parse(patch);
    this.db.run('UPDATE roles SET name = ?, description = ?, department = ?, system_prompt = ?, work_activity = ? WHERE id = ?', [
      d.name ?? cur.name,
      d.description ?? cur.description,
      d.department ?? cur.department,
      d.systemPrompt ?? cur.systemPrompt,
      d.workActivity ?? cur.workActivity,
      cur.id,
    ]);
    this.bus.publish('system.updated', { roles: true });
    return this.get(cur.id);
  }

  delete(id: string): void {
    const role = this.get(id);
    if (role.builtin) throw new HttpError(400, 'Built-in roles cannot be deleted');
    const used = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM agents WHERE role_id = ?', [role.id]);
    if (used && used.n > 0) throw new HttpError(409, 'Role is used by agents – reassign them first');
    this.db.run('DELETE FROM roles WHERE id = ?', [role.id]);
    this.bus.publish('system.updated', { roles: true });
  }
}
