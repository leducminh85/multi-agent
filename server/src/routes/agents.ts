import { Router } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../auth/auth.js';
import type { Services } from '../container.js';
import { HttpError } from '../core/util.js';
import { actor, ah } from './helpers.js';

const DEFAULT_TEAM: { role: string; name: string }[] = [
  { role: 'ceo_assistant', name: 'Ava (CEO Assistant)' },
  { role: 'project_manager', name: 'Max (PM)' },
  { role: 'researcher', name: 'Rin (Research)' },
  { role: 'developer', name: 'Dev (Developer)' },
  { role: 'content', name: 'Cleo (Content)' },
  { role: 'qa', name: 'Quinn (QA)' },
];

export function agentRoutes(s: Services): Router {
  const r = Router();

  // ---------- roles ----------
  r.get('/roles', (_req, res) => {
    res.json(s.roles.list());
  });
  r.post(
    '/roles',
    ah((req, res) => {
      const role = s.roles.create(req.body);
      s.audit.log(actor(req), 'role.create', { type: 'role', id: role.id }, { key: role.key }, req.ip);
      res.status(201).json(role);
    }),
  );
  r.patch(
    '/roles/:id',
    ah((req, res) => {
      const role = s.roles.update(req.params.id, req.body);
      s.audit.log(actor(req), 'role.update', { type: 'role', id: role.id }, {}, req.ip);
      res.json(role);
    }),
  );
  r.delete(
    '/roles/:id',
    ah((req, res) => {
      requireConfirmation(req);
      s.roles.delete(req.params.id);
      s.audit.log(actor(req), 'role.delete', { type: 'role', id: req.params.id }, {}, req.ip);
      res.json({ ok: true });
    }),
  );

  // ---------- agents ----------
  r.get('/agents', (_req, res) => {
    res.json(
      s.agents.list().map((a) => ({
        ...a,
        unavailableReason: s.runtime.unavailableReason(a),
        tokensToday: s.usage.agentTokensToday(a.id),
      })),
    );
  });

  r.get('/agents/:id', (req, res) => {
    const a = s.agents.get(req.params.id);
    res.json({
      ...a,
      unavailableReason: s.runtime.unavailableReason(a),
      tokensToday: s.usage.agentTokensToday(a.id),
      currentTask: a.currentTaskId ? s.store.getTask(a.currentTaskId, true) : null,
      recentTasks: s.store.listTasks({ agentId: a.id, limit: 30 }),
      activity: s.activity.list({ agentId: a.id, limit: 50 }),
      memory: s.knowledge.list({ scope: 'agent', agentId: a.id }),
    });
  });

  r.post(
    '/agents',
    ah((req, res) => {
      const a = s.agents.create(req.body);
      s.audit.log(actor(req), 'agent.create', { type: 'agent', id: a.id }, { name: a.name, role: a.roleKey, provider: a.providerId }, req.ip);
      s.activity.record({ type: 'agent.created', message: `${a.name} joined the office as ${a.roleName}`, agentId: a.id });
      res.status(201).json(a);
      void s.orchestrator.tick();
    }),
  );

  r.post(
    '/agents/team',
    ah((req, res) => {
      const { providerId, model } = z.object({ providerId: z.string(), model: z.string().optional() }).parse(req.body);
      const p = s.providers.get(providerId);
      if (!p.canExecute) throw new HttpError(400, 'This provider cannot execute tasks');
      const created = DEFAULT_TEAM.map((m) => {
        const role = s.roles.findByKey(m.role)!;
        return s.agents.create({ name: m.name, roleId: role.id, providerId, model: model || null });
      });
      s.audit.log(actor(req), 'agent.create_team', { type: 'provider', id: providerId }, { count: created.length }, req.ip);
      s.activity.record({ type: 'agent.created', message: `Default team of ${created.length} agents created on ${p.name}` });
      res.status(201).json(created);
      void s.orchestrator.tick();
    }),
  );

  r.patch(
    '/agents/:id',
    ah((req, res) => {
      const a = s.agents.update(req.params.id, req.body);
      s.audit.log(actor(req), 'agent.update', { type: 'agent', id: a.id }, { fields: Object.keys(req.body ?? {}) }, req.ip);
      res.json(a);
      void s.orchestrator.tick();
    }),
  );

  r.delete(
    '/agents/:id',
    ah((req, res) => {
      requireConfirmation(req);
      const a = s.agents.get(req.params.id);
      s.orchestrator.releaseAgent(a.id);
      s.agents.delete(a.id);
      s.audit.log(actor(req), 'agent.delete', { type: 'agent', id: a.id }, { name: a.name }, req.ip);
      s.activity.record({ type: 'agent.deleted', level: 'warning', message: `${a.name} was removed from the office` });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/agents/:id/pause',
    ah((req, res) => {
      const a = s.agents.setPaused(req.params.id, true);
      s.audit.log(actor(req), 'agent.pause', { type: 'agent', id: a.id }, {}, req.ip);
      s.activity.record({ type: 'agent.paused', message: `${a.name} paused (finishes current work, takes no new tasks)`, agentId: a.id });
      res.json(a);
    }),
  );

  r.post(
    '/agents/:id/resume',
    ah((req, res) => {
      const a = s.agents.setPaused(req.params.id, false);
      s.audit.log(actor(req), 'agent.resume', { type: 'agent', id: a.id }, {}, req.ip);
      s.activity.record({ type: 'agent.resumed', message: `${a.name} resumed`, agentId: a.id });
      res.json(a);
      void s.orchestrator.tick();
    }),
  );

  r.post(
    '/agents/:id/stop',
    ah((req, res) => {
      s.orchestrator.stopAgent(req.params.id, actor(req));
      res.json(s.agents.get(req.params.id));
    }),
  );

  /** Assign a task directly to this agent (bypasses planning). */
  r.post(
    '/agents/:id/assign',
    ah(async (req, res) => {
      const body = z
        .object({ text: z.string().min(1), title: z.string().optional(), projectId: z.string().optional(), fileIds: z.array(z.string()).default([]) })
        .parse(req.body);
      const m = await s.orchestrator.submitMission({ ...body, mode: 'direct', agentId: req.params.id }, actor(req));
      res.status(201).json(m);
    }),
  );

  r.get('/agents/:id/activity', (req, res) => {
    res.json(s.activity.list({ agentId: req.params.id, limit: Number(req.query.limit ?? 100) }));
  });

  return r;
}
