import { Router } from 'express';
import { z } from 'zod';
import { requireConfirmation } from '../auth/auth.js';
import type { Services } from '../container.js';
import { quotaInputSchema } from '../usage/service.js';
import { actor, ah, str } from './helpers.js';
import { cliVersion } from '../providers/cli.js';
import { claudeAuthStatus, findClaudeBinaries, openClaudeLogin } from '../providers/claudeLocate.js';
import { httpJson } from '../providers/http.js';

/** What can be connected on this machine without any technical input (used by the quick-setup wizard). */
async function detectLocal() {
  const clis = [
    { type: 'codex-cli', command: 'codex', label: 'OpenAI Codex' },
    { type: 'antigravity-cli', command: 'agy', label: 'Google Antigravity' },
  ];
  const claudeCmd = findClaudeBinaries()[0] ?? 'claude';
  const [claude, ...others] = await Promise.all([
    (async () => {
      try {
        const version = await cliVersion(claudeCmd);
        const auth = await claudeAuthStatus(claudeCmd);
        return { type: 'claude-code-cli', command: claudeCmd, label: 'Claude (Claude Code)', found: true, version, loggedIn: auth ? auth.loggedIn : null, authMethod: auth?.authMethod ?? null };
      } catch {
        return { type: 'claude-code-cli', command: 'claude', label: 'Claude (Claude Code)', found: false, version: null, loggedIn: null, authMethod: null };
      }
    })(),
    ...clis.map(async (c) => {
      try {
        return { ...c, found: true, version: await cliVersion(c.command), loggedIn: null, authMethod: null };
      } catch {
        return { ...c, found: false, version: null, loggedIn: null, authMethod: null };
      }
    }),
  ]);
  let ollama: { found: boolean; models: string[] } = { found: false, models: [] };
  try {
    const { data } = await httpJson<{ models?: { name: string }[] }>('http://127.0.0.1:11434/api/tags', { timeoutMs: 2500 });
    ollama = { found: true, models: (data.models ?? []).map((m) => m.name) };
  } catch {
    /* not running */
  }
  return { cli: [claude, ...others], ollama };
}

export function providerRoutes(s: Services): Router {
  const r = Router();

  r.get('/provider-types', (_req, res) => {
    res.json(s.registry.list().map((a) => a.descriptor));
  });

  r.get(
    '/providers/detect',
    ah(async (_req, res) => {
      res.json(await detectLocal());
    }),
  );

  /** Opens the official `claude auth login` window on this computer (the user signs in in the browser). */
  r.post(
    '/providers/claude-login',
    ah(async (req, res) => {
      const command = findClaudeBinaries()[0];
      if (!command) return void res.status(404).json({ error: 'Claude Code is not installed on this computer' });
      const r2 = openClaudeLogin(command);
      s.audit.log(actor(req), 'provider.claude_login_opened', { type: 'provider', id: 'claude-code-cli' }, { opened: r2.opened }, req.ip);
      res.json(r2);
    }),
  );

  r.get('/providers', (_req, res) => {
    res.json(s.providers.list());
  });

  r.post(
    '/providers',
    ah(async (req, res) => {
      const p = s.providers.create(req.body);
      s.audit.log(actor(req), 'provider.create', { type: 'provider', id: p.id }, { type: p.type, name: p.name }, req.ip);
      s.activity.record({ type: 'provider.created', message: `Provider "${p.name}" added`, providerId: p.id });
      res.status(201).json(p);
      void s.providers.check(p.id).catch(() => undefined);
    }),
  );

  r.patch(
    '/providers/:id',
    ah((req, res) => {
      const p = s.providers.update(req.params.id, req.body);
      s.audit.log(actor(req), 'provider.update', { type: 'provider', id: p.id }, { fields: Object.keys(req.body ?? {}) }, req.ip);
      res.json(p);
    }),
  );

  r.delete(
    '/providers/:id',
    ah((req, res) => {
      requireConfirmation(req);
      const p = s.providers.get(req.params.id);
      s.providers.delete(p.id);
      s.audit.log(actor(req), 'provider.delete', { type: 'provider', id: p.id }, { name: p.name }, req.ip);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/providers/:id/check',
    ah(async (req, res) => {
      const result = await s.providers.check(req.params.id);
      res.json(result);
    }),
  );

  r.post(
    '/providers/:id/billing-sync',
    ah(async (req, res) => {
      const entries = await s.usage.syncBilling(req.params.id);
      s.audit.log(actor(req), 'provider.billing_sync', { type: 'provider', id: req.params.id }, {}, req.ip);
      res.json(entries);
    }),
  );

  // ---------- quotas ----------
  r.get('/providers/:id/quotas', (req, res) => {
    res.json(s.usage.latestQuotas(req.params.id));
  });

  r.get('/providers/:id/quotas/:metric/history', (req, res) => {
    res.json(s.usage.quotaHistory(req.params.id, req.params.metric));
  });

  r.post(
    '/providers/:id/quotas',
    ah((req, res) => {
      const q = s.usage.addQuota(req.params.id, quotaInputSchema.parse(req.body), 'manual');
      s.audit.log(actor(req), 'quota.manual_entry', { type: 'provider', id: req.params.id }, { metric: q.metric, used: q.used, limit: q.limitValue }, req.ip);
      res.status(201).json(q);
    }),
  );

  r.delete(
    '/quotas/:id',
    ah((req, res) => {
      requireConfirmation(req);
      s.usage.deleteQuota(req.params.id);
      s.audit.log(actor(req), 'quota.delete', { type: 'quota', id: req.params.id }, {}, req.ip);
      res.json({ ok: true });
    }),
  );

  // ---------- usage ----------
  r.get('/usage/summary', (req, res) => {
    res.json(s.usage.summary({ from: str(req.query.from), to: str(req.query.to) }));
  });

  r.get('/usage/timeseries', (req, res) => {
    const q = z
      .object({ period: z.enum(['day', 'week', 'month']).default('day'), groupBy: z.enum(['provider', 'agent', 'none']).default('provider'), from: z.string().optional() })
      .parse(req.query);
    res.json(s.usage.timeseries(q.period, { groupBy: q.groupBy, from: q.from }));
  });

  /** One card per provider: status, account, plan, latest quotas, rate limits and measured usage windows. */
  r.get('/usage/overview', (_req, res) => {
    const now = Date.now();
    const windows = {
      today: new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString(),
      last7d: new Date(now - 7 * 86400_000).toISOString(),
      last30d: new Date(now - 30 * 86400_000).toISOString(),
    };
    const out = s.providers.list().map((p) => {
      const measured: Record<string, unknown> = {};
      for (const [k, from] of Object.entries(windows)) {
        measured[k] = s.db.get(
          `SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens,
            COALESCE(SUM(CASE WHEN cost_source='reported' THEN cost_usd END),0) AS costReported,
            COALESCE(SUM(CASE WHEN cost_source='estimated' THEN cost_usd END),0) AS costEstimated
           FROM usage_records WHERE provider_id = ? AND created_at >= ?`,
          [p.id, from],
        );
      }
      const descriptor = s.registry.has(p.type) ? s.registry.get(p.type).descriptor : null;
      return {
        provider: p,
        capabilities: descriptor?.capabilities ?? null,
        limitations: descriptor?.limitations ?? [],
        quotas: s.usage.latestQuotas(p.id),
        measured,
        alerts: s.usage.listAlerts().filter((a) => a.providerId === p.id),
      };
    });
    res.json(out);
  });

  r.get('/alerts', (req, res) => {
    res.json(s.usage.listAlerts(req.query.all === '1'));
  });
  r.post('/alerts/:id/ack', (req, res) => {
    s.usage.acknowledgeAlert(req.params.id);
    res.json({ ok: true });
  });
  r.post('/alerts/:id/dismiss', (req, res) => {
    s.usage.dismissAlert(req.params.id);
    res.json({ ok: true });
  });

  return r;
}
