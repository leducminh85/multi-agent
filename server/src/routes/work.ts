import { Router } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../auth/auth.js';
import type { Services } from '../container.js';
import { HttpError } from '../core/util.js';
import { ACTIVE, TASK_STATUSES } from '../orchestrator/store.js';
import { actor, ah, str } from './helpers.js';

const submitSchema = z.object({
  text: z.string().min(1).max(100_000),
  title: z.string().max(200).optional(),
  projectId: z.string().optional(),
  fileIds: z.array(z.string()).max(50).default([]),
});

export function workRoutes(s: Services): Router {
  const r = Router();

  // ---------- missions ----------
  r.get('/missions', (req, res) => {
    res.json(s.store.listMissions({ projectId: str(req.query.projectId), status: str(req.query.status), limit: Number(req.query.limit ?? 100) }));
  });

  r.get('/missions/:id', (req, res) => {
    const m = s.store.getMission(req.params.id);
    res.json({ ...m, tasks: s.store.listTasks({ missionId: m.id }).reverse() });
  });

  r.post(
    '/missions',
    ah(async (req, res) => {
      const body = submitSchema.parse(req.body);
      const m = await s.orchestrator.submitMission(body, actor(req));
      res.status(201).json(m);
    }),
  );

  r.post(
    '/missions/:id/cancel',
    ah((req, res) => {
      res.json(s.orchestrator.cancelMission(req.params.id, actor(req)));
    }),
  );

  r.post(
    '/missions/:id/replan',
    ah((req, res) => {
      res.json(s.orchestrator.replan(req.params.id, actor(req)));
    }),
  );

  r.delete(
    '/missions/:id',
    ah((req, res) => {
      requireConfirmation(req);
      const m = s.store.getMission(req.params.id);
      if (['planning', 'running'].includes(m.status)) throw new HttpError(409, 'Cancel the mission before deleting it');
      s.store.deleteMission(m.id);
      s.audit.log(actor(req), 'mission.delete', { type: 'mission', id: m.id }, { title: m.title }, req.ip);
      res.json({ ok: true });
    }),
  );

  // ---------- tasks ----------
  r.get('/tasks', (req, res) => {
    const status = str(req.query.status)
      ?.split(',')
      .filter((x) => (TASK_STATUSES as readonly string[]).includes(x));
    res.json(
      s.store.listTasks({
        missionId: str(req.query.missionId),
        projectId: str(req.query.projectId),
        agentId: str(req.query.agentId),
        status,
        limit: Number(req.query.limit ?? 500),
      }),
    );
  });

  r.get('/tasks/:id', (req, res) => {
    const t = s.store.getTask(req.params.id, true);
    res.json({
      ...t,
      isRunning: ACTIVE.includes(t.status),
      subtasks: s.store.listTasks({ missionId: t.missionId ?? undefined }).filter((x) => x.parentTaskId === t.id),
      dependencies: t.dependsOn.map((id) => s.store.findTask(id)).filter(Boolean),
      messages: s.comms.list({ taskId: t.id }),
      usage: s.db.all('SELECT * FROM usage_records WHERE task_id = ? ORDER BY created_at', [t.id]),
      approvals: s.approvals.list().filter((a) => a.taskId === t.id),
    });
  });

  r.post(
    '/tasks/:id/cancel',
    ah((req, res) => {
      res.json(s.orchestrator.cancelTask(req.params.id, actor(req)));
    }),
  );
  r.post(
    '/tasks/:id/retry',
    ah((req, res) => {
      res.json(s.orchestrator.retryTask(req.params.id, actor(req)));
    }),
  );
  r.post(
    '/tasks/:id/reassign',
    ah((req, res) => {
      const { agentId } = z.object({ agentId: z.string().nullable() }).parse(req.body);
      res.json(s.orchestrator.reassignTask(req.params.id, agentId, actor(req)));
    }),
  );
  r.post(
    '/tasks/:id/respond',
    ah((req, res) => {
      const { answer, fileIds } = z
        .object({ answer: z.string().max(50_000).default(''), fileIds: z.array(z.string()).max(20).default([]) })
        .refine((b) => b.answer.trim() || b.fileIds.length, 'Write an answer or attach a file')
        .parse(req.body);
      res.json(s.orchestrator.respondToTask(req.params.id, answer.trim() || '(see attached files)', actor(req), fileIds));
    }),
  );
  r.post(
    '/tasks/:id/save-knowledge',
    ah((req, res) => {
      const t = s.store.getTask(req.params.id);
      if (!t.output) throw new HttpError(400, 'Task has no output');
      const { scope } = z.object({ scope: z.enum(['global', 'project']).default('project') }).parse(req.body ?? {});
      const k = s.knowledge.create(
        { scope, projectId: t.projectId, title: t.title, content: t.output, tags: `task,${t.roleKey ?? ''}` },
        { type: 'task_output', id: t.id },
      );
      s.audit.log(actor(req), 'knowledge.from_task', { type: 'task', id: t.id }, { knowledgeId: k.id }, req.ip);
      res.status(201).json(k);
    }),
  );

  // ---------- approvals ----------
  r.get('/approvals', (req, res) => {
    const status = str(req.query.status) as 'pending' | 'approved' | 'rejected' | undefined;
    res.json(s.approvals.list(status));
  });
  r.post(
    '/approvals/:id/decide',
    ah((req, res) => {
      const { decision, note } = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().max(2000).optional() }).parse(req.body);
      res.json(s.orchestrator.decideApproval(req.params.id, decision, note, actor(req)));
    }),
  );

  // ---------- communication ----------
  r.get('/messages', (req, res) => {
    const channel = str(req.query.channel) as 'global' | 'agents' | undefined;
    res.json(
      s.comms.list({
        channel,
        missionId: str(req.query.missionId),
        agentId: str(req.query.agentId),
        before: str(req.query.before),
        limit: Number(req.query.limit ?? 200),
      }),
    );
  });

  r.post(
    '/chat',
    ah(async (req, res) => {
      const { text, fileIds } = z.object({ text: z.string().min(1).max(50_000), fileIds: z.array(z.string()).max(20).default([]) }).parse(req.body);
      await s.orchestrator.chat(text, fileIds, actor(req));
      res.status(202).json({ ok: true });
    }),
  );

  r.get('/activity', (req, res) => {
    res.json(
      s.activity.list({
        agentId: str(req.query.agentId),
        missionId: str(req.query.missionId),
        taskId: str(req.query.taskId),
        before: str(req.query.before),
        limit: Number(req.query.limit ?? 100),
      }),
    );
  });

  return r;
}
