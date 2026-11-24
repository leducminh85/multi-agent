import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Database } from '../db/database.js';
import type { EventBus } from '../core/eventBus.js';
import { HttpError, newId, notFound, nowIso } from '../core/util.js';

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
  stats?: { missions: number; tasks: number; runningTasks: number; files: number; knowledge: number };
}

export const projectInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(2000).default(''),
  status: z.enum(['active', 'archived']).default('active'),
});

export class ProjectService {
  constructor(
    private db: Database,
    private bus: EventBus,
    private workspacesDir: string,
  ) {}

  private map(r: any): Project {
    return { id: r.id, name: r.name, description: r.description, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  /** A project is required for every mission – create "General" on first start. */
  ensureDefault(): Project {
    const first = this.db.get('SELECT * FROM projects ORDER BY created_at LIMIT 1');
    if (first) return this.map(first);
    return this.create({ name: 'General', description: 'Default project' });
  }

  list(): Project[] {
    return this.db.all('SELECT * FROM projects ORDER BY created_at').map((r) => {
      const p = this.map(r);
      const s = this.db.get<any>(
        `SELECT
          (SELECT COUNT(*) FROM missions WHERE project_id = ?) AS missions,
          (SELECT COUNT(*) FROM tasks WHERE project_id = ?) AS tasks,
          (SELECT COUNT(*) FROM tasks WHERE project_id = ? AND status = 'running') AS running,
          (SELECT COUNT(*) FROM files WHERE project_id = ?) AS files,
          (SELECT COUNT(*) FROM knowledge WHERE project_id = ?) AS knowledge`,
        [p.id, p.id, p.id, p.id, p.id],
      );
      p.stats = { missions: s.missions, tasks: s.tasks, runningTasks: s.running, files: s.files, knowledge: s.knowledge };
      return p;
    });
  }

  get(id: string): Project {
    const r = this.db.get('SELECT * FROM projects WHERE id = ?', [id]);
    if (!r) throw notFound('Project');
    return this.map(r);
  }

  create(input: z.input<typeof projectInputSchema>): Project {
    const d = projectInputSchema.parse(input);
    const id = newId('prj');
    const now = nowIso();
    this.db.run('INSERT INTO projects (id, name, description, status, created_at, updated_at) VALUES (?,?,?,?,?,?)', [
      id,
      d.name,
      d.description,
      d.status,
      now,
      now,
    ]);
    fs.mkdirSync(this.workspaceDir(id), { recursive: true });
    const p = this.get(id);
    this.bus.publish('project.updated', p);
    return p;
  }

  update(id: string, patch: Partial<z.input<typeof projectInputSchema>>): Project {
    const cur = this.get(id);
    const d = projectInputSchema.partial().parse(patch);
    this.db.run('UPDATE projects SET name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?', [
      d.name ?? cur.name,
      d.description ?? cur.description,
      d.status ?? cur.status,
      nowIso(),
      id,
    ]);
    const p = this.get(id);
    this.bus.publish('project.updated', p);
    return p;
  }

  delete(id: string): void {
    this.get(id);
    const count = this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM projects')?.n ?? 0;
    if (count <= 1) throw new HttpError(400, 'At least one project must exist');
    const running = this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE project_id = ? AND status IN ('running','assigned','waiting')", [id]);
    if (running && running.n > 0) throw new HttpError(409, 'Project has active tasks – cancel them first');
    this.db.run('DELETE FROM projects WHERE id = ?', [id]);
    this.db.run('DELETE FROM knowledge WHERE project_id = ?', [id]);
    this.bus.publish('project.updated', { id, deleted: true });
  }

  /** Per-project shared workspace directory (cwd for CLI agents). */
  workspaceDir(id: string): string {
    if (!/^prj_[a-z0-9]+$/.test(id)) throw new HttpError(400, 'Invalid project id');
    return path.join(this.workspacesDir, id);
  }

  /** List files in the project workspace (read-only browse). */
  listWorkspace(id: string, sub = ''): { path: string; name: string; type: 'file' | 'dir'; size: number; modifiedAt: string }[] {
    const root = this.workspaceDir(id);
    const target = path.resolve(root, sub);
    if (!target.startsWith(path.resolve(root))) throw new HttpError(400, 'Path escapes workspace');
    if (!fs.existsSync(target)) return [];
    return fs
      .readdirSync(target, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.mao-'))
      .map((d) => {
        const full = path.join(target, d.name);
        const st = fs.statSync(full);
        return {
          path: path.relative(root, full).replace(/\\/g, '/'),
          name: d.name,
          type: d.isDirectory() ? ('dir' as const) : ('file' as const),
          size: st.size,
          modifiedAt: st.mtime.toISOString(),
        };
      })
      .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  }

  resolveWorkspaceFile(id: string, rel: string): string {
    const root = path.resolve(this.workspaceDir(id));
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep)) throw new HttpError(400, 'Path escapes workspace');
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw notFound('File');
    return target;
  }
}
