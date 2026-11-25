import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireConfirmation } from '../auth/auth.js';
import type { Services } from '../container.js';
import { HttpError } from '../core/util.js';
import { knowledgeInputSchema } from '../knowledge/service.js';
import { actor, ah, str } from './helpers.js';

export function dataRoutes(s: Services): Router {
  const r = Router();
  const tmpDir = path.join(os.tmpdir(), 'mao-uploads');
  fs.mkdirSync(tmpDir, { recursive: true });
  const upload = multer({ dest: tmpDir, limits: { fileSize: s.config.maxUploadMb * 1024 * 1024, files: 20 } });

  // ---------- projects ----------
  r.get('/projects', (_req, res) => {
    res.json(s.projects.list());
  });
  r.get('/projects/:id', (req, res) => {
    const p = s.projects.get(req.params.id);
    res.json({
      ...p,
      missions: s.store.listMissions({ projectId: p.id, limit: 50 }),
      knowledge: s.knowledge.list({ scope: 'project', projectId: p.id }),
      files: s.files.list({ projectId: p.id }),
    });
  });
  r.post(
    '/projects',
    ah((req, res) => {
      const p = s.projects.create(req.body);
      s.audit.log(actor(req), 'project.create', { type: 'project', id: p.id }, { name: p.name }, req.ip);
      res.status(201).json(p);
    }),
  );
  r.patch(
    '/projects/:id',
    ah((req, res) => {
      const p = s.projects.update(req.params.id, req.body);
      s.audit.log(actor(req), 'project.update', { type: 'project', id: p.id }, {}, req.ip);
      res.json(p);
    }),
  );
  r.delete(
    '/projects/:id',
    ah((req, res) => {
      requireConfirmation(req);
      const p = s.projects.get(req.params.id);
      s.projects.delete(p.id);
      s.audit.log(actor(req), 'project.delete', { type: 'project', id: p.id }, { name: p.name }, req.ip);
      res.json({ ok: true });
    }),
  );
  r.get('/projects/:id/workspace', (req, res) => {
    res.json(s.projects.listWorkspace(req.params.id, str(req.query.path) ?? ''));
  });
  r.get('/projects/:id/workspace/file', (req, res) => {
    const file = s.projects.resolveWorkspaceFile(req.params.id, str(req.query.path) ?? '');
    res.download(file);
  });

  // ---------- media referenced by agents ----------
  /**
   * Serve an image / video / file an agent referenced by path (absolute, file:// or workspace-relative) so the UI can
   * show it inline. Only files inside the project workspaces or the upload store are served – anything else is 403.
   */
  r.get('/media', (req, res) => {
    let p = (str(req.query.path) ?? '').trim();
    if (!p) throw new HttpError(400, 'path required');
    if (/^file:/i.test(p)) {
      try {
        p = fileURLToPath(p);
      } catch {
        throw new HttpError(400, 'Invalid file URL');
      }
    }
    let projectId = str(req.query.projectId) ?? null;
    const taskId = str(req.query.taskId);
    const missionId = str(req.query.missionId);
    if (!projectId && taskId) projectId = s.store.findTask(taskId)?.projectId ?? null;
    if (!projectId && missionId) {
      try {
        projectId = s.store.getMission(missionId).projectId;
      } catch {
        /* unknown mission */
      }
    }
    const roots = [s.config.workspacesDir, s.config.storageDir].map((x) => path.resolve(x));
    let full: string;
    if (path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p)) full = path.resolve(p);
    else {
      if (!projectId) throw new HttpError(404, 'Relative path without a project');
      full = path.resolve(s.projects.workspaceDir(projectId), p);
    }
    const inside = roots.some((root) => full === root || full.toLowerCase().startsWith((root + path.sep).toLowerCase()));
    if (!inside) throw new HttpError(403, 'Only files inside the office workspaces can be shown');
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new HttpError(404, 'File not found');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Opened directly, an SVG/HTML file must not run scripts in the office origin.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox");
    res.sendFile(full);
  });

  // ---------- knowledge ----------
  r.get('/knowledge', (req, res) => {
    res.json(
      s.knowledge.list({
        scope: str(req.query.scope) as 'global' | 'project' | 'agent' | undefined,
        projectId: str(req.query.projectId),
        agentId: str(req.query.agentId),
        q: str(req.query.q),
      }),
    );
  });
  r.post(
    '/knowledge',
    ah((req, res) => {
      const k = s.knowledge.create(knowledgeInputSchema.parse(req.body));
      s.audit.log(actor(req), 'knowledge.create', { type: 'knowledge', id: k.id }, { scope: k.scope }, req.ip);
      res.status(201).json(k);
    }),
  );
  r.patch(
    '/knowledge/:id',
    ah((req, res) => {
      const body = z.object({ title: z.string().min(1).optional(), content: z.string().min(1).optional(), tags: z.string().optional() }).parse(req.body);
      res.json(s.knowledge.update(req.params.id, body));
    }),
  );
  r.delete(
    '/knowledge/:id',
    ah((req, res) => {
      requireConfirmation(req);
      s.knowledge.delete(req.params.id);
      s.audit.log(actor(req), 'knowledge.delete', { type: 'knowledge', id: req.params.id }, {}, req.ip);
      res.json({ ok: true });
    }),
  );

  // ---------- files ----------
  r.get('/files', (req, res) => {
    res.json(
      s.files.list({
        scope: str(req.query.scope) as any,
        projectId: str(req.query.projectId),
        agentId: str(req.query.agentId),
        missionId: str(req.query.missionId),
      }),
    );
  });

  r.post(
    '/files',
    upload.array('files', 20),
    ah((req, res) => {
      const files = (req.files as Express.Multer.File[]) ?? [];
      if (!files.length) throw new HttpError(400, 'No files uploaded (field name "files")');
      const meta = z
        .object({
          scope: z.enum(['global', 'project', 'agent', 'mission']).default('project'),
          projectId: z.string().optional(),
          agentId: z.string().optional(),
        })
        .parse(req.body ?? {});
      const projectId = meta.projectId ?? (meta.scope === 'project' || meta.scope === 'mission' ? s.projects.ensureDefault().id : undefined);
      if (projectId) s.projects.get(projectId);
      if (meta.agentId) s.agents.get(meta.agentId);
      const out = files.map((f) =>
        s.files.ingest({
          tempPath: f.path,
          // multer decodes names as latin1; restore UTF-8 (Vietnamese file names etc.)
          originalName: Buffer.from(f.originalname, 'latin1').toString('utf8'),
          mime: f.mimetype,
          scope: meta.scope,
          projectId: projectId ?? null,
          agentId: meta.agentId ?? null,
          uploadedBy: actor(req),
        }),
      );
      s.audit.log(actor(req), 'file.upload', { type: 'file' }, { count: out.length, names: out.map((f) => f.name) }, req.ip);
      res.status(201).json(out);
    }),
  );

  r.get('/files/:id', (req, res) => {
    res.json(s.files.get(req.params.id));
  });
  r.get('/files/:id/text', (req, res) => {
    res.json({ text: s.files.text(req.params.id) });
  });
  r.get('/files/:id/download', (req, res) => {
    const f = s.files.get(req.params.id);
    const inline = req.query.inline === '1' && /^(image|audio|video)\//.test(f.mime);
    res.setHeader('Content-Type', f.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (inline) res.sendFile(s.files.absolutePath(f.id));
    else res.download(s.files.absolutePath(f.id), f.name);
  });
  r.post(
    '/files/:id/reprocess',
    ah(async (req, res) => {
      res.json(await s.files.reprocess(req.params.id));
    }),
  );
  r.delete(
    '/files/:id',
    ah((req, res) => {
      requireConfirmation(req);
      const f = s.files.get(req.params.id);
      s.files.delete(f.id);
      s.audit.log(actor(req), 'file.delete', { type: 'file', id: f.id }, { name: f.name }, req.ip);
      res.json({ ok: true });
    }),
  );

  return r;
}
