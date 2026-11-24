import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../auth/auth.js';
import type { Services } from '../container.js';
import { DEFAULT_SETTINGS } from '../core/settings.js';
import { HttpError } from '../core/util.js';
import { SCHEMA_VERSION } from '../db/migrations.js';
import { Ffmpeg } from '../files/media.js';
import { actor, ah } from './helpers.js';

const priceSchema = z.object({ input: z.number().min(0), output: z.number().min(0), cacheRead: z.number().min(0).optional(), cacheWrite: z.number().min(0).optional() });
const sectionSchemas = {
  runtime: z.object({
    maxConcurrentTasks: z.number().int().min(1).max(256),
    defaultMaxAttempts: z.number().int().min(1).max(10),
    retryBaseDelayMs: z.number().int().min(0).max(600_000),
    maxDelegationDepth: z.number().int().min(0).max(5),
    autoSynthesis: z.boolean(),
    autoReview: z.boolean(),
    maxContextChars: z.number().int().min(1000).max(500_000),
  }),
  usage: z.object({
    warnPercent: z.number().min(1).max(100),
    criticalPercent: z.number().min(1).max(100),
    billingSyncMinutes: z.number().int().min(0).max(1440),
    healthCheckMinutes: z.number().int().min(0).max(1440),
  }),
  media: z.object({ transcriptionProviderId: z.string().nullable(), visionProviderId: z.string().nullable() }),
  orchestrator: z.object({ plannerAgentId: z.string().nullable(), coordinatorAgentId: z.string().nullable() }),
  pricing: z.record(priceSchema),
};

export function systemRoutes(s: Services): Router {
  const r = Router();
  const ffmpeg = new Ffmpeg(s.config.ffmpegPath);

  r.get('/overview', (_req, res) => {
    const agents = s.agents.list();
    const taskCounts = Object.fromEntries(s.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM tasks GROUP BY status').map((x) => [x.status, x.n]));
    const today = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();
    const usageToday = s.db.get('SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens+output_tokens),0) AS tokens, COALESCE(SUM(cost_usd),0) AS cost FROM usage_records WHERE created_at >= ?', [today]);
    const usage30 = s.db.get('SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens+output_tokens),0) AS tokens, COALESCE(SUM(cost_usd),0) AS cost FROM usage_records WHERE created_at >= ?', [
      new Date(Date.now() - 30 * 86400_000).toISOString(),
    ]);
    res.json({
      agents: {
        total: agents.length,
        active: agents.filter((a) => !!a.currentTaskId).length,
        idle: agents.filter((a) => !a.currentTaskId && a.enabled && !a.paused).length,
        paused: agents.filter((a) => a.paused).length,
        disabled: agents.filter((a) => !a.enabled).length,
      },
      tasks: taskCounts,
      missions: s.store.listMissions({ limit: 8 }),
      usage: { today: usageToday, last30d: usage30 },
      providers: s.providers.list().map((p) => ({ id: p.id, name: p.name, type: p.type, status: p.status, statusMessage: p.statusMessage, enabled: p.enabled })),
      alerts: s.usage.listAlerts().length,
      pendingApprovals: s.approvals.list('pending').length,
      waitingForManager: s.store.listTasks({ status: ['waiting'] }).filter((t) => (t.waitingReason ?? '').includes('manager answer')).length,
      emergencyStopped: s.orchestrator.emergencyStopped,
    });
  });

  r.get('/settings', (_req, res) => {
    res.json(s.settings.all());
  });

  r.put(
    '/settings/:section',
    ah((req, res) => {
      const section = req.params.section as keyof typeof sectionSchemas;
      const schema = sectionSchemas[section];
      if (!schema) throw new HttpError(404, 'Unknown settings section');
      const current = s.settings.get(section);
      const value = section === 'pricing' ? schema.parse(req.body) : schema.parse({ ...(current as object), ...req.body });
      const saved = s.settings.set(section, value as never);
      s.audit.log(actor(req), `settings.${section}`, { type: 'settings', id: section }, {}, req.ip);
      res.json(saved);
      void s.orchestrator.tick();
    }),
  );

  r.post(
    '/settings/pricing/reset',
    ah((req, res) => {
      requireConfirmation(req);
      res.json(s.settings.set('pricing', DEFAULT_SETTINGS.pricing));
    }),
  );

  r.get('/audit', (req, res) => {
    res.json(s.audit.list({ limit: Number(req.query.limit ?? 200), before: req.query.before as string | undefined, action: req.query.action as string | undefined }));
  });

  r.post(
    '/system/emergency-stop',
    ah((req, res) => {
      requireConfirmation(req);
      const interrupted = s.orchestrator.emergencyStop(actor(req));
      res.json({ ok: true, interrupted });
    }),
  );

  r.post(
    '/system/resume',
    ah((req, res) => {
      s.orchestrator.resume(actor(req));
      res.json({ ok: true });
    }),
  );

  r.post(
    '/system/backup',
    ah((req, res) => {
      const name = `office-${new Date().toISOString().replace(/[:.]/g, '-')}.db`;
      const file = path.join(s.config.backupsDir, name);
      s.db.backupTo(file);
      s.audit.log(actor(req), 'system.backup', { type: 'backup', id: name }, {}, req.ip);
      s.activity.record({ type: 'system.backup', level: 'success', message: `Database backup created: ${name}` });
      res.status(201).json({ name, size: fs.statSync(file).size });
    }),
  );

  r.get('/system/backups', (_req, res) => {
    const list = fs
      .readdirSync(s.config.backupsDir)
      .filter((f) => f.endsWith('.db'))
      .map((name) => {
        const st = fs.statSync(path.join(s.config.backupsDir, name));
        return { name, size: st.size, createdAt: st.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json(list);
  });

  r.get('/system/backups/:name', (req, res) => {
    const name = path.basename(req.params.name);
    const file = path.join(s.config.backupsDir, name);
    if (!name.endsWith('.db') || !fs.existsSync(file)) throw new HttpError(404, 'Backup not found');
    s.audit.log(actor(req), 'system.backup_download', { type: 'backup', id: name }, {}, req.ip);
    res.download(file);
  });

  r.get(
    '/system/info',
    ah(async (_req, res) => {
      res.json({
        version: '0.1.0',
        schemaVersion: SCHEMA_VERSION,
        node: process.version,
        dataDir: s.config.dataDir,
        masterKeySource: s.masterKeySource,
        ffmpegAvailable: await ffmpeg.isAvailable(),
        runningTasks: s.orchestrator.runningTaskIds().length,
        emergencyStopped: s.orchestrator.emergencyStopped,
      });
    }),
  );

  return r;
}
