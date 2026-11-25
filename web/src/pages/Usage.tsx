import PlanUsage from '../components/PlanUsage';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BellOff, Check, CloudDownload, Info, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Card, Empty, Field, Modal, PageHeader, ProgressBar, Stat, StatusBadge, Tabs, useConfirm } from '../components/ui';
import { del, get, post } from '../lib/api';
import { useAction, useAlerts } from '../lib/hooks';
import { fmtDate, fmtNum, fmtUsd, timeAgo } from '../lib/format';
import type { Provider, QuotaEntry } from '../lib/types';

const SERIES_COLORS = ['#818cf8', '#34d399', '#f472b6', '#fbbf24', '#22d3ee', '#fb923c', '#a78bfa', '#f87171', '#a3e635', '#e879f9'];

const SOURCE_LABEL: Record<string, string> = {
  manual: 'Manual entry',
  provider_api: 'Official API',
  cli: 'CLI report',
  computed: 'Computed',
};

export default function UsagePage() {
  const [period, setPeriod] = useState<'day' | 'week' | 'month'>('day');
  const [groupBy, setGroupBy] = useState<'provider' | 'agent'>('provider');
  const overview = useQuery({ queryKey: ['usage-overview'], queryFn: () => get<any[]>('/usage/overview') });
  const summary = useQuery({ queryKey: ['usage', 'summary'], queryFn: () => get<any>('/usage/summary') });
  const series = useQuery({ queryKey: ['usage', 'ts', period, groupBy], queryFn: () => get<any>(`/usage/timeseries?period=${period}&groupBy=${groupBy}`) });
  const alerts = useAlerts();
  const [quotaFor, setQuotaFor] = useState<Provider | null>(null);
  const t = summary.data?.totals;

  const chart = useMemo(() => {
    const rows = series.data?.rows ?? [];
    const names = [...new Set(rows.map((r: any) => r.series))] as string[];
    const byBucket = new Map<string, any>();
    for (const r of rows) {
      const b = byBucket.get(r.bucket) ?? { bucket: r.bucket };
      b[r.series] = r.tokens;
      byBucket.set(r.bucket, b);
    }
    return { names, data: [...byBucket.values()] };
  }, [series.data]);

  return (
    <>
      <PageHeader title="Usage & Subscription" subtitle="Measured usage, provider-reported cost, official billing data and subscription quotas – every number shows where it comes from." />

      <div className="card mb-5 flex gap-3 border-sky-500/20 p-4 text-sm text-slate-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
        <div className="space-y-1">
          <div>
            <b className="text-white">API billing ≠ subscription limits.</b> API keys (Anthropic Console, OpenAI Platform, Gemini API) are billed per token. Consumer plans (Claude Pro/Max, ChatGPT Plus/Pro, Google AI / Antigravity) have usage windows
            that no vendor exposes through an official API.
          </div>
          <div className="text-slate-400">
            Measured = tokens reported by the provider on each request made by this office. Cost is <i>reported</i> when the provider returns it (Claude Code CLI), <i>estimated</i> from your pricing table otherwise, and blank when unknown.
            Subscription quotas come from official billing APIs (admin keys) or manual entries, labelled with confidence and capture time. Nothing is scraped or simulated.
          </div>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Requests (30d)" value={fmtNum(t?.requests)} />
        <Stat label="Input tokens" value={fmtNum(t?.input_tokens)} hint={t?.cache_read_tokens ? `${fmtNum(t.cache_read_tokens)} cache reads` : undefined} />
        <Stat label="Output tokens" value={fmtNum(t?.output_tokens)} hint={t?.reasoning_tokens ? `${fmtNum(t.reasoning_tokens)} reasoning` : undefined} />
        <Stat label="Cost reported" value={fmtUsd(t?.cost_reported)} hint="returned by provider" />
        <Stat label="Cost estimated" value={fmtUsd(t?.cost_estimated)} hint="tokens × pricing table" tone="warn" />
        <Stat label="Without cost" value={fmtNum(t?.requests_without_cost)} hint="no price known" />
      </div>

      {(alerts.data ?? []).length > 0 && (
        <Card title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-300" /> Active alerts</span>} className="mb-5">
          <AlertList />
        </Card>
      )}

      <div className="mb-5 grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {(overview.data ?? []).map((o) => (
          <ProviderUsageCard key={o.provider.id} data={o} onAddQuota={() => setQuotaFor(o.provider)} />
        ))}
        {!overview.data?.length && (
          <div className="card lg:col-span-2">
            <Empty title="No provider accounts">Add providers in Settings. For subscriptions without an API, add a "Subscription account (tracking only)".</Empty>
          </div>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Token usage over time"
          actions={
            <div className="flex gap-2">
              <Tabs value={groupBy} onChange={setGroupBy} tabs={[{ id: 'provider', label: 'By provider' }, { id: 'agent', label: 'By agent' }]} />
              <Tabs value={period} onChange={setPeriod} tabs={[{ id: 'day', label: 'Day' }, { id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }]} />
            </div>
          }
        >
          {!chart.data.length ? (
            <Empty title="No usage recorded yet" />
          ) : (
            <div className="h-72">
              <ResponsiveContainer>
                <BarChart data={chart.data}>
                  <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
                  <XAxis dataKey="bucket" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} tickFormatter={(v) => fmtNum(v)} />
                  <Tooltip contentStyle={{ background: '#11152a', border: '1px solid rgba(255,255,255,.1)', borderRadius: 8 }} formatter={(v: any) => fmtNum(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {chart.names.map((n, i) => (
                    <Bar key={n} dataKey={n} stackId="a" fill={SERIES_COLORS[i % SERIES_COLORS.length]} radius={i === chart.names.length - 1 ? [3, 3, 0, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
        <Card title="By agent (30 days)">
          {!summary.data?.byAgent.length && <div className="text-sm text-slate-500">No agent usage yet.</div>}
          <ul className="space-y-2">
            {(summary.data?.byAgent ?? []).map((a: any) => {
              const max = Math.max(...summary.data.byAgent.map((x: any) => x.input_tokens + x.output_tokens));
              const total = a.input_tokens + a.output_tokens;
              return (
                <li key={a.agent_id} className="text-sm">
                  <div className="flex justify-between text-slate-300">
                    <span className="truncate">{a.agent_name ?? 'deleted agent'}</span>
                    <span className="text-slate-500">
                      {fmtNum(total)} · {fmtUsd(a.cost)}
                    </span>
                  </div>
                  <ProgressBar value={(total / max) * 100} />
                </li>
              );
            })}
          </ul>
          <h4 className="label mt-5">By model</h4>
          <ul className="space-y-1 text-sm">
            {(summary.data?.byModel ?? []).map((m: any) => (
              <li key={m.model ?? 'unknown'} className="flex justify-between text-slate-400">
                <span className="truncate">{m.model ?? 'unknown'}</span>
                <span>
                  {m.requests} req · {fmtNum(m.input_tokens + m.output_tokens)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <QuotaModal provider={quotaFor} onClose={() => setQuotaFor(null)} />
    </>
  );
}

function AlertList() {
  const alerts = useAlerts();
  const ack = useAction((id: string) => post(`/alerts/${id}/dismiss`), { success: 'Alert dismissed', invalidate: [['alerts']] });
  return (
    <ul className="space-y-2">
      {(alerts.data ?? []).map((a) => (
        <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-ink-850 px-3 py-2 text-sm">
          <span className="flex items-center gap-2">
            <Badge className={a.level === 'critical' ? 'border-rose-500/30 text-rose-300' : a.level === 'warning' ? 'border-amber-500/30 text-amber-300' : 'border-sky-500/30 text-sky-300'}>{a.level}</Badge>
            <span className="text-slate-300">{a.message}</span>
          </span>
          <span className="flex items-center gap-2 text-xs text-slate-500">
            {timeAgo(a.createdAt)}
            <button className="btn-ghost btn-sm" onClick={() => ack.mutate(a.id)} title="Dismiss">
              <BellOff className="h-3.5 w-3.5" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function QuotaRow({ q }: { q: QuotaEntry }) {
  const confirm = useConfirm();
  const remove = useAction(() => del(`/quotas/${q.id}`), { success: 'Entry deleted', invalidate: [['usage-overview']] });
  const pct = q.percentUsed;
  const remaining = q.limitValue != null && q.used != null && q.unit !== 'percent' ? q.limitValue - q.used : pct != null ? 100 - pct : null;
  return (
    <li className={q.stale ? 'opacity-60' : ''}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="truncate text-slate-200">{q.label}</span>
        <span className="shrink-0 tabular-nums text-slate-300">
          {q.used ?? '?'}
          {q.unit === 'percent' ? '%' : ''}
          {q.limitValue != null && q.unit !== 'percent' ? ` / ${fmtNum(q.limitValue)} ${q.unit}` : q.unit !== 'percent' ? ` ${q.unit}` : ''}
        </span>
      </div>
      {pct != null && <ProgressBar value={pct} tone={pct >= 95 ? 'bad' : pct >= 80 ? 'warn' : 'good'} />}
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
        <Badge className={q.confidence === 'actual' ? 'border-emerald-500/30 text-emerald-300' : q.confidence === 'estimated' ? 'border-amber-500/30 text-amber-300' : 'border-slate-500/30 text-slate-400'}>
          {q.confidence}
        </Badge>
        <span>{SOURCE_LABEL[q.source] ?? q.source}</span>
        <span>· updated {timeAgo(q.capturedAt)}</span>
        {remaining != null && <span>· remaining {q.unit === 'percent' ? `${Math.round(remaining * 10) / 10}%` : `${fmtNum(remaining)} ${q.unit}`}</span>}
        {q.resetsAt && <span>· {q.stale ? 'window reset – update needed' : `resets ${fmtDate(q.resetsAt)}`}</span>}
        <button className="ml-auto text-slate-600 hover:text-rose-300" onClick={async () => (await confirm({ title: 'Delete quota entry?', message: q.label, danger: true })) && remove.mutate()}>
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {q.note && <div className="text-[11px] text-slate-600">{q.note}</div>}
    </li>
  );
}

function ProviderUsageCard({ data, onAddQuota }: { data: any; onAddQuota: () => void }) {
  const p: Provider = data.provider;
  const check = useAction(() => post(`/providers/${p.id}/check`), { success: (r: any) => (r.ok ? 'Connection OK' : `Failed: ${r.message}`), invalidate: [['usage-overview']] });
  const sync = useAction(() => post(`/providers/${p.id}/billing-sync`), { success: 'Billing data synced', invalidate: [['usage-overview']] });
  const m = data.measured;
  const rl = p.rateLimit;
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium text-white">{p.name}</div>
          <div className="truncate text-xs text-slate-500">
            {p.displayName} · {p.accountLabel ?? 'account not labelled'} · {p.planName ?? 'plan not set'}
          </div>
        </div>
        <StatusBadge status={p.enabled ? p.status : 'disabled'} />
      </div>
      {p.statusMessage && <div className="mt-1 truncate text-xs text-slate-500" title={p.statusMessage}>{p.statusMessage}</div>}

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {(['today', 'last7d', 'last30d'] as const).map((k) => (
          <div key={k} className="rounded-lg bg-ink-850 px-2 py-2">
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{k === 'today' ? 'Today' : k === 'last7d' ? '7 days' : '30 days'}</div>
            <div className="text-sm font-semibold tabular-nums text-white">{fmtNum(m[k].inputTokens + m[k].outputTokens)}</div>
            <div className="text-[10px] text-slate-500">
              {m[k].requests} req · {m[k].costReported ? fmtUsd(m[k].costReported) : m[k].costEstimated ? `~${fmtUsd(m[k].costEstimated)}` : '—'}
            </div>
          </div>
        ))}
      </div>

      {rl && (
        <div className="mt-3 rounded-lg bg-ink-850 px-3 py-2 text-xs text-slate-400">
          <div className="mb-1 font-medium text-slate-300">Rate limit (from response headers, {timeAgo(rl.capturedAt)})</div>
          {rl.requestsLimit != null && (
            <div>
              Requests: {rl.requestsRemaining}/{rl.requestsLimit} remaining{rl.requestsReset ? ` · reset ${rl.requestsReset}` : ''}
            </div>
          )}
          {rl.tokensLimit != null && (
            <div>
              Tokens: {fmtNum(rl.tokensRemaining)}/{fmtNum(rl.tokensLimit)} remaining{rl.tokensReset ? ` · reset ${rl.tokensReset}` : ''}
            </div>
          )}
        </div>
      )}

      <div className="mt-3">
        <div className="label flex items-center justify-between">
          Quotas & limits
          <button className="btn-ghost btn-sm normal-case" onClick={onAddQuota}>
            <Plus className="h-3 w-3" /> Manual entry
          </button>
        </div>
        <PlanUsage provider={data.provider} quotas={data.quotas} />
        {!data.quotas.length && !['claude-code-cli', 'antigravity-cli'].includes(data.provider.type) ? (
          <div className="text-xs text-slate-500">
            {data.capabilities?.subscriptionQuotaApi ? 'No quota data yet.' : 'Quota: unknown – this provider exposes no official quota API. Add a manual entry from the vendor\'s usage page.'}
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {data.quotas
              .filter((q: QuotaEntry) => q.source !== 'cli')
              .map((q: QuotaEntry) => (
                <QuotaRow key={q.id} q={q} />
              ))}
          </ul>
        )}
      </div>

      {data.alerts.length > 0 && (
        <div className="mt-3 space-y-1">
          {data.alerts.map((a: any) => (
            <div key={a.id} className={a.level === 'critical' ? 'text-xs text-rose-300' : 'text-xs text-amber-300'}>
              ⚠ {a.message}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3">
        <button className="btn-outline btn-sm" onClick={() => check.mutate()} disabled={check.isPending}>
          <RefreshCw className="h-3.5 w-3.5" /> Test connection
        </button>
        {data.capabilities?.billingApi && (
          <button className="btn-outline btn-sm" onClick={() => sync.mutate()} disabled={sync.isPending || !p.credentialHints.adminApiKey} title={p.credentialHints.adminApiKey ? '' : 'Add an admin key to this provider first'}>
            <CloudDownload className="h-3.5 w-3.5" /> Sync billing
          </button>
        )}
      </div>
      {data.limitations.length > 0 && (
        <details className="mt-2 text-xs text-slate-500">
          <summary className="cursor-pointer">Integration limits</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {data.limitations.map((l: string, i: number) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

const PRESETS = [
  { metric: 'session_5h', label: '5-hour session limit', unit: 'percent' },
  { metric: 'weekly', label: 'Weekly limit', unit: 'percent' },
  { metric: 'weekly_opus', label: 'Weekly limit (top model)', unit: 'percent' },
  { metric: 'monthly_credits', label: 'Monthly credits', unit: 'credits' },
  { metric: 'messages_daily', label: 'Daily messages', unit: 'messages' },
  { metric: 'api_budget', label: 'Monthly API budget', unit: 'usd' },
];

function QuotaModal({ provider, onClose }: { provider: Provider | null; onClose: () => void }) {
  const [preset, setPreset] = useState(0);
  const [label, setLabel] = useState(PRESETS[0].label);
  const [metric, setMetric] = useState(PRESETS[0].metric);
  const [unit, setUnit] = useState(PRESETS[0].unit);
  const [used, setUsed] = useState('');
  const [limit, setLimit] = useState('100');
  const [resetsAt, setResetsAt] = useState('');
  const [confidence, setConfidence] = useState('actual');
  const [note, setNote] = useState('');
  const save = useAction(
    () =>
      post(`/providers/${provider!.id}/quotas`, {
        metric,
        label,
        unit,
        used: used === '' ? null : Number(used),
        limitValue: limit === '' ? null : Number(limit),
        resetsAt: resetsAt ? new Date(resetsAt).toISOString() : null,
        confidence,
        note: note || null,
      }),
    { success: 'Quota entry saved', invalidate: [['usage-overview']] },
  );
  return (
    <Modal
      open={!!provider}
      onClose={onClose}
      title={`Manual quota entry – ${provider?.name ?? ''}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!label || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            <Check className="h-4 w-4" /> Save
          </button>
        </>
      }
    >
      <p className="mb-4 text-xs text-slate-400">Copy the numbers shown on the vendor's own usage page (e.g. claude.ai Settings → Usage, ChatGPT/Codex usage, Antigravity account). Entries are stored with source “manual” and the capture time.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Preset" className="sm:col-span-2">
          <select
            className="input"
            value={preset}
            onChange={(e) => {
              const p = PRESETS[Number(e.target.value)];
              setPreset(Number(e.target.value));
              setLabel(p.label);
              setMetric(p.metric);
              setUnit(p.unit);
              setLimit(p.unit === 'percent' ? '100' : '');
            }}
          >
            {PRESETS.map((p, i) => (
              <option key={p.metric} value={i}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Label">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label="Unit">
          <select className="input" value={unit} onChange={(e) => setUnit(e.target.value)}>
            {['percent', 'usd', 'tokens', 'requests', 'messages', 'credits', 'hours'].map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </Field>
        <Field label={unit === 'percent' ? 'Used (%)' : 'Used'}>
          <input className="input" type="number" value={used} onChange={(e) => setUsed(e.target.value)} />
        </Field>
        <Field label="Limit" help="Leave empty if unknown">
          <input className="input" type="number" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </Field>
        <Field label="Resets at">
          <input className="input" type="datetime-local" value={resetsAt} onChange={(e) => setResetsAt(e.target.value)} />
        </Field>
        <Field label="Confidence">
          <select className="input" value={confidence} onChange={(e) => setConfidence(e.target.value)}>
            <option value="actual">actual (read from vendor)</option>
            <option value="estimated">estimated</option>
            <option value="unknown">unknown</option>
          </select>
        </Field>
        <Field label="Note" className="sm:col-span-2">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
