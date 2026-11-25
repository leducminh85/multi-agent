import type { Services } from './container.js';
import { errorMessage } from './core/util.js';

/**
 * Background jobs (Usage Monitoring Service):
 *  - provider health checks (cheap endpoints: list models / --version)
 *  - official billing API sync (only providers with an admin credential)
 *  - alert evaluation (quota thresholds, stale windows, rate-limit headroom)
 */
export function startJobs(s: Services): () => void {
  const timers: NodeJS.Timeout[] = [];
  let lastHealth = 0;
  let lastBilling = 0;
  let lastQuota = 0;

  const loop = async () => {
    const cfg = s.settings.get('usage');
    const now = Date.now();
    try {
      s.usage.evaluateAll();
    } catch (e) {
      console.error('[jobs] alert evaluation failed', errorMessage(e));
    }
    if (cfg.healthCheckMinutes > 0 && now - lastHealth >= cfg.healthCheckMinutes * 60_000) {
      lastHealth = now;
      for (const p of s.providers.list().filter((x) => x.enabled)) {
        await s.providers.check(p.id).catch(() => undefined);
      }
    }
    // Plan usage that is free to read (e.g. Antigravity `agy /usage`, no tokens) every 10 minutes.
    if (now - lastQuota >= 10 * 60_000) {
      lastQuota = now;
      for (const p of s.providers.list().filter((x) => x.enabled))
        if (s.registry.get(p.type).descriptor.quotaRefresh === 'free') await s.runtime.refreshQuota(p.id).catch(() => undefined);
    }
    if (cfg.billingSyncMinutes > 0 && now - lastBilling >= cfg.billingSyncMinutes * 60_000) {
      lastBilling = now;
      for (const p of s.providers.list().filter((x) => x.enabled && x.credentialHints.adminApiKey)) {
        await s.usage.syncBilling(p.id).catch((e) => console.warn(`[jobs] billing sync ${p.name}: ${errorMessage(e)}`));
      }
    }
  };

  const t = setInterval(() => void loop(), 60_000);
  t.unref();
  timers.push(t);
  const first = setTimeout(() => void loop(), 3000);
  first.unref();
  timers.push(first);
  return () => timers.forEach(clearTimeout);
}
