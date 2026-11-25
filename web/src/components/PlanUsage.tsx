import { RefreshCw } from 'lucide-react';
import { post } from '../lib/api';
import { useAction, useProviderTypes } from '../lib/hooks';
import { getLang } from '../lib/i18n';
import { timeAgo } from '../lib/format';
import type { QuotaEntry } from '../lib/types';
import { cx, Spinner } from './ui';

/** "7:00 PM" today, "Fri 9:00 PM" this week, otherwise a short date – in the interface language. */
export function formatResetTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const loc = getLang() === 'vi' ? 'vi-VN' : 'en-US';
  const time = d.toLocaleTimeString(loc, { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  if (d.getTime() - now.getTime() < 6.5 * 86400_000) return `${d.toLocaleDateString(loc, { weekday: 'short' })} ${time}`;
  return d.toLocaleString(loc, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

const order = (q: QuotaEntry) => (/5h|five_hour/i.test(q.metric) ? 0 : 1);
/** Rows of one model group stay together (Antigravity: "Gemini Models · …", "Claude and GPT models · …"). */
const group = (q: QuotaEntry) => (q.label.includes(' · ') && !/^Weekly/.test(q.label) ? q.label.split(' · ')[0] : '');

/**
 * Plan usage limits as the vendor reports them (Claude Code rate_limit_event, Antigravity /usage):
 * one bar per window with % used and when it resets, like the vendors' own usage panels.
 */
export default function PlanUsage({ provider, quotas, compact }: { provider: { id: string; type: string; name: string }; quotas: QuotaEntry[]; compact?: boolean }) {
  const types = useProviderTypes();
  const how = types.data?.find((t) => t.type === provider.type)?.quotaRefresh;
  const refresh = useAction(() => post(`/providers/${provider.id}/quota-refresh`), { invalidate: [['usage-overview'], ['alerts'], ['providers']] });
  const plan = quotas.filter((q) => q.unit === 'percent' && q.source === 'cli').sort((a, b) => group(a).localeCompare(group(b)) || order(a) - order(b));
  const latest = plan.reduce<string | null>((m, q) => (!m || q.capturedAt > m ? q.capturedAt : m), null);
  if (!how && !plan.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {plan.map((q) => {
        const pct = q.stale ? 0 : Math.round(q.percentUsed ?? 0);
        return (
          <div key={q.id}>
            <div className={cx('mb-1 flex items-baseline justify-between gap-2', compact ? 'text-[11px]' : 'text-xs')}>
              <span className="truncate font-medium text-slate-200">{q.label}</span>
              <span className="shrink-0 text-slate-500">
                {q.stale ? 'Reset – refresh to update' : q.resetsAt ? `Resets ${formatResetTime(q.resetsAt)}` : ''}
                <span className={cx('ml-2 font-semibold', pct >= 90 ? 'text-rose-300' : pct >= 70 ? 'text-amber-300' : 'text-slate-200')}>{pct}%</span>
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
              <div className={cx('h-full rounded-full transition-all', pct >= 90 ? 'bg-rose-500' : pct >= 70 ? 'bg-amber-500' : 'bg-sky-500')} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        );
      })}
      {how && (
        <div className="flex items-center gap-2 text-[10px] text-slate-600">
          <span className="min-w-0 flex-1 truncate">{plan.length ? `Updated ${timeAgo(latest)}` : 'No usage reading yet – press refresh.'}</span>
          <button
            className="inline-flex items-center gap-1 text-slate-400 hover:text-white disabled:opacity-50"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            title={how === 'free' ? 'Reads the limits for free (no tokens).' : 'Reads the limits with one tiny request (a few tokens).'}
          >
            {refresh.isPending ? <Spinner className="h-3 w-3" /> : <RefreshCw className="h-3 w-3" />} Refresh usage
          </button>
        </div>
      )}
    </div>
  );
}
