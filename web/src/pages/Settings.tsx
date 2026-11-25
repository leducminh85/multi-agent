import SetupWizard from '../components/SetupWizard';
import { useQuery } from '@tanstack/react-query';
import { Archive, Check, Download, KeyRound, Pencil, Plug, Plus, RefreshCw, Shield, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Card, Empty, Field, Modal, PageHeader, Spinner, StatusBadge, Tabs, Toggle, useConfirm } from '../components/ui';
import { del, downloadUrl, get, patch, post, put } from '../lib/api';
import { useAction, useAgents, useProviders, useProviderTypes, useRoles, useSettings, useSystemInfo } from '../lib/hooks';
import { fmtBytes, fmtDate, timeAgo } from '../lib/format';
import type { Provider, ProviderDescriptor, Role, Settings } from '../lib/types';

type Tab = 'providers' | 'roles' | 'orchestration' | 'media' | 'pricing' | 'security';

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('providers');
  return (
    <>
      <PageHeader title="Settings & Integrations" subtitle="Providers, roles, orchestration, media processing, pricing and security." />
      <div className="mb-5 overflow-x-auto">
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'providers', label: 'Providers' },
            { id: 'roles', label: 'Roles' },
            { id: 'orchestration', label: 'Orchestration' },
            { id: 'media', label: 'Media' },
            { id: 'pricing', label: 'Pricing' },
            { id: 'security', label: 'Security & backup' },
          ]}
        />
      </div>
      {tab === 'providers' && <ProvidersTab />}
      {tab === 'roles' && <RolesTab />}
      {tab === 'orchestration' && <OrchestrationTab />}
      {tab === 'media' && <MediaTab />}
      {tab === 'pricing' && <PricingTab />}
      {tab === 'security' && <SecurityTab />}
    </>
  );
}

// ======================================================================= providers
const INTEGRATION_STYLE: Record<string, string> = {
  api: 'border-sky-500/30 text-sky-300',
  cli: 'border-emerald-500/30 text-emerald-300',
  'local-server': 'border-violet-500/30 text-violet-300',
  'tracking-only': 'border-zinc-500/30 text-zinc-300',
};

function ProvidersTab() {
  const providers = useProviders();
  const types = useProviderTypes();
  const [editing, setEditing] = useState<{ provider?: Provider; type?: ProviderDescriptor } | null>(null);
  const [picking, setPicking] = useState(false);
  const [wizard, setWizard] = useState(false);
  const confirm = useConfirm();
  const remove = useAction((id: string) => del(`/providers/${id}`), { success: 'Provider removed', invalidate: [['providers']] });
  const check = useAction((id: string) => post(`/providers/${id}/check`), { success: (r: any) => (r.ok ? `OK – ${r.message}` : `Failed – ${r.message}`), invalidate: [['providers']] });

  return (
    <div className="space-y-5">
      <SetupWizard open={wizard} onClose={() => setWizard(false)} />
      <Card
        title="Connected providers"
        actions={
          <>
            <button className="btn-primary btn-sm" onClick={() => setWizard(true)}>
              <Sparkles className="h-3.5 w-3.5" /> Quick connect
            </button>
            <button className="btn-outline btn-sm" onClick={() => setPicking(true)}>
              <Plus className="h-3.5 w-3.5" /> Add provider (advanced)
            </button>
          </>
        }
      >
        {!providers.data?.length && <Empty icon={<Plug className="h-8 w-8" />} title="No providers yet">Add an API key, a local CLI (Claude Code, Codex, Antigravity) or a local Ollama server.</Empty>}
        <ul className="divide-y divide-white/5">
          {(providers.data ?? []).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white">{p.name}</span>
                  <Badge className={INTEGRATION_STYLE[p.integration]}>{p.integration}</Badge>
                  <StatusBadge status={p.enabled ? p.status : 'disabled'} />
                </div>
                <div className="truncate text-xs text-slate-500">
                  {p.displayName} · max {p.maxConcurrency} concurrent
                  {p.config.defaultModel ? ` · ${p.config.defaultModel}` : ''}
                  {Object.entries(p.credentialHints).map(([k, v]) => ` · ${k}: ${v}`)}
                </div>
                {p.statusMessage && <div className="truncate text-xs text-slate-500">{p.statusMessage} {p.lastCheckedAt && `(${timeAgo(p.lastCheckedAt)})`}</div>}
              </div>
              <button className="btn-outline btn-sm" onClick={() => check.mutate(p.id)}>
                <RefreshCw className="h-3.5 w-3.5" /> Test
              </button>
              <button className="btn-ghost btn-sm" onClick={() => setEditing({ provider: p, type: types.data?.find((t) => t.type === p.type) })}>
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                className="btn-ghost btn-sm text-rose-300"
                onClick={async () =>
                  (await confirm({ title: `Remove ${p.name}?`, message: 'Encrypted credentials are deleted. Agents using it will have no provider until you reassign them.', danger: true, confirmText: 'Remove' })) &&
                  remove.mutate(p.id)
                }
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Integration capabilities">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left uppercase tracking-wide text-slate-500">
              <tr className="border-b border-white/5">
                <th className="py-2 pr-3">Integration</th>
                <th className="pr-3">Type</th>
                <th className="pr-3">Streaming</th>
                <th className="pr-3">Vision</th>
                <th className="pr-3">Audio</th>
                <th className="pr-3">Agentic tools</th>
                <th className="pr-3">Usage reported</th>
                <th className="pr-3">Billing API</th>
                <th>Subscription quota API</th>
              </tr>
            </thead>
            <tbody>
              {(types.data ?? []).map((t) => (
                <tr key={t.type} className="border-b border-white/5 text-slate-300">
                  <td className="py-2 pr-3">{t.displayName}</td>
                  <td className="pr-3">
                    <Badge className={INTEGRATION_STYLE[t.integration]}>{t.integration}</Badge>
                  </td>
                  {[t.capabilities.streaming, t.capabilities.vision, t.capabilities.transcription, t.capabilities.agenticTools].map((v, i) => (
                    <td key={i} className="pr-3">
                      {v ? '✓' : '—'}
                    </td>
                  ))}
                  <td className="pr-3">{t.capabilities.usageReporting}</td>
                  <td className="pr-3">{t.capabilities.billingApi ? '✓ (admin key)' : '—'}</td>
                  <td>{t.capabilities.subscriptionQuotaApi ? '✓' : 'none – manual'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal open={picking} onClose={() => setPicking(false)} title="Choose an integration" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          {(types.data ?? []).map((t) => (
            <button
              key={t.type}
              className="card p-3 text-left transition hover:border-accent-500/40"
              onClick={() => {
                setPicking(false);
                setEditing({ type: t });
              }}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-white">{t.displayName}</span>
                <Badge className={INTEGRATION_STYLE[t.integration]}>{t.integration}</Badge>
              </div>
              <div className="mt-1 text-xs text-slate-400">{t.description}</div>
            </button>
          ))}
        </div>
      </Modal>
      <ProviderForm state={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function ProviderForm({ state, onClose }: { state: { provider?: Provider; type?: ProviderDescriptor } | null; onClose: () => void }) {
  const p = state?.provider;
  const d = state?.type;
  const [name, setName] = useState('');
  const [config, setConfig] = useState<Record<string, any>>({});
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [maxConcurrency, setMax] = useState(2);
  const [accountLabel, setAccount] = useState('');
  const [planName, setPlan] = useState('');
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    if (!state) return;
    const defaults: Record<string, any> = {};
    for (const f of d?.configFields ?? []) if (f.default !== undefined) defaults[f.key] = f.default;
    setName(p?.name ?? d?.displayName ?? '');
    setConfig(p?.config ?? defaults);
    setCreds({});
    setMax(p?.maxConcurrency ?? (d?.integration === 'local-server' ? 1 : 2));
    setAccount(p?.accountLabel ?? '');
    setPlan(p?.planName ?? '');
    setEnabled(p?.enabled ?? true);
  }, [state, p, d]);

  const save = useAction(
    () => {
      const body = { name, config, credentials: creds, maxConcurrency, accountLabel: accountLabel || null, planName: planName || null, enabled };
      return p ? patch(`/providers/${p.id}`, body) : post('/providers', { ...body, type: d!.type });
    },
    { success: p ? 'Provider updated' : 'Provider added – testing connection…', invalidate: [['providers'], ['usage-overview']] },
  );

  return (
    <Modal
      open={!!state}
      onClose={onClose}
      wide
      title={p ? `Edit ${p.name}` : `Add ${d?.displayName ?? 'provider'}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!name || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            <Check className="h-4 w-4" /> Save
          </button>
        </>
      }
    >
      {d && (
        <div className="mb-4 rounded-lg bg-ink-850 p-3 text-xs text-slate-400">
          <div className="mb-1">{d.description}</div>
          {d.limitations.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-slate-500">
              {d.limitations.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Display name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Max concurrent requests" help="Provider-level cap (rate limits / local hardware)">
          <input className="input" type="number" min={1} max={64} value={maxConcurrency} onChange={(e) => setMax(Number(e.target.value))} />
        </Field>
        <Field label="Account label" help="Which account this is (shown on the usage page)">
          <input className="input" value={accountLabel} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. work account" />
        </Field>
        <Field label="Plan">
          <input className="input" value={planName} onChange={(e) => setPlan(e.target.value)} placeholder="e.g. Max 5x, Pro, pay-as-you-go" />
        </Field>
        {(d?.configFields ?? []).map((f) => (
          <Field key={f.key} label={f.label} help={f.help}>
            {f.type === 'boolean' ? (
              <Toggle checked={config[f.key] ?? !!f.default} onChange={(v) => setConfig({ ...config, [f.key]: v })} />
            ) : f.type === 'select' ? (
              <select className="input" value={config[f.key] ?? ''} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })}>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o || '(default)'}
                  </option>
                ))}
              </select>
            ) : (
              <input className="input" type={f.type === 'number' ? 'number' : 'text'} placeholder={f.placeholder} value={config[f.key] ?? ''} onChange={(e) => setConfig({ ...config, [f.key]: e.target.value })} />
            )}
          </Field>
        ))}
        {d?.capabilities.billingApi && (
          <Field label="Monthly API budget (USD, optional)" help="Used as the limit for synced API cost alerts">
            <input className="input" type="number" min={0} value={config.monthlyBudgetUsd ?? ''} onChange={(e) => setConfig({ ...config, monthlyBudgetUsd: e.target.value ? Number(e.target.value) : undefined })} />
          </Field>
        )}
        {(d?.credentialFields ?? []).map((f) => (
          <Field
            key={f.key}
            label={f.label}
            help={p?.credentialHints[f.key] ? `Stored (${p.credentialHints[f.key]}) – leave empty to keep. Encrypted with AES-256-GCM; never sent back to the browser.` : 'Encrypted with AES-256-GCM on the server; never sent back to the browser.'}
          >
            <div className="flex gap-2">
              <input
                className="input"
                type="password"
                autoComplete="off"
                placeholder={p?.credentialHints[f.key] ?? f.placeholder}
                value={creds[f.key] ?? ''}
                onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
              />
              {p?.credentialHints[f.key] && (
                <button className="btn-ghost btn-sm text-rose-300" title="Remove stored credential" onClick={() => setCreds({ ...creds, [f.key]: null as any })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </Field>
        ))}
        <Field label="Status">
          <Toggle checked={enabled} onChange={setEnabled} label={enabled ? 'Enabled' : 'Disabled'} />
        </Field>
      </div>
    </Modal>
  );
}

// ======================================================================= roles
function RolesTab() {
  const roles = useRoles();
  const [editing, setEditing] = useState<Partial<Role> | null>(null);
  const confirm = useConfirm();
  const remove = useAction((id: string) => del(`/roles/${id}`), { success: 'Role deleted', invalidate: [['roles']] });
  return (
    <Card
      title="Roles"
      actions={
        <button className="btn-primary btn-sm" onClick={() => setEditing({ department: 'main', workActivity: 'working' })}>
          <Plus className="h-3.5 w-3.5" /> New role
        </button>
      }
    >
      <ul className="divide-y divide-white/5">
        {(roles.data ?? []).map((r) => (
          <li key={r.id} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{r.name}</span>
                <code className="text-xs text-slate-500">{r.key}</code>
                {r.builtin && <Badge className="border-white/10 text-slate-400">built-in</Badge>}
                <Badge className="border-white/10 text-slate-400">{r.department}</Badge>
              </div>
              <div className="text-sm text-slate-400">{r.description}</div>
            </div>
            <button className="btn-ghost btn-sm" onClick={() => setEditing(r)}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            {!r.builtin && (
              <button className="btn-ghost btn-sm text-rose-300" onClick={async () => (await confirm({ title: `Delete role ${r.name}?`, message: 'Only possible when no agent uses it.', danger: true })) && remove.mutate(r.id)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      <RoleModal role={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function RoleModal({ role, onClose }: { role: Partial<Role> | null; onClose: () => void }) {
  const [f, setF] = useState<Partial<Role>>({});
  useEffect(() => {
    setF(role ?? {});
  }, [role]);
  const save = useAction(
    () =>
      f.id
        ? patch(`/roles/${f.id}`, { name: f.name, description: f.description, department: f.department, systemPrompt: f.systemPrompt, workActivity: f.workActivity })
        : post('/roles', { key: f.key || undefined, name: f.name, description: f.description ?? '', department: f.department, systemPrompt: f.systemPrompt, workActivity: f.workActivity }),
    { success: 'Role saved', invalidate: [['roles']] },
  );
  return (
    <Modal
      open={!!role}
      onClose={onClose}
      wide
      title={f.id ? `Edit role ${f.name}` : 'New role'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!f.name || !f.systemPrompt} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input className="input" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Field>
        <Field label="Key (snake_case, used by the planner)">
          <input className="input" disabled={!!f.id} value={f.key ?? ''} onChange={(e) => setF({ ...f, key: e.target.value })} placeholder="auto from name" />
        </Field>
        <Field label="Department (office room)">
          <select className="input" value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
            {['manager', 'main', 'research', 'development', 'design', 'content', 'meeting', 'server'].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Visible activity while working">
          <select className="input" value={f.workActivity} onChange={(e) => setF({ ...f, workActivity: e.target.value })}>
            {['working', 'writing', 'coding', 'reading', 'thinking'].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <Field label="Description (shown to the planner)" className="sm:col-span-2">
          <input className="input" value={f.description ?? ''} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="System prompt" className="sm:col-span-2">
          <textarea className="input h-40 font-mono text-xs" value={f.systemPrompt ?? ''} onChange={(e) => setF({ ...f, systemPrompt: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

// ======================================================================= orchestration
function useSettingsSection<K extends keyof Settings>(key: K) {
  const s = useSettings();
  const [value, setValue] = useState<Settings[K] | null>(null);
  useEffect(() => {
    if (s.data) setValue(s.data[key]);
  }, [s.data, key]);
  const save = useAction(() => put(`/settings/${key}`, value), { success: 'Settings saved', invalidate: [['settings']] });
  return { value, setValue, save, loading: s.isLoading };
}

function OrchestrationTab() {
  const rt = useSettingsSection('runtime');
  const orch = useSettingsSection('orchestrator');
  const usage = useSettingsSection('usage');
  const agents = useAgents();
  if (!rt.value || !orch.value || !usage.value) return <Spinner />;
  const v = rt.value;
  const set = (patch: Partial<Settings['runtime']>) => rt.setValue({ ...v, ...patch });
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card title="Runtime & queue" actions={<button className="btn-primary btn-sm" onClick={() => rt.save.mutate()}>Save</button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Max concurrent tasks (global)" help="Also limited per agent and per provider">
            <input className="input" type="number" min={1} value={v.maxConcurrentTasks} onChange={(e) => set({ maxConcurrentTasks: Number(e.target.value) })} />
          </Field>
          <Field label="Attempts per task">
            <input className="input" type="number" min={1} max={10} value={v.defaultMaxAttempts} onChange={(e) => set({ defaultMaxAttempts: Number(e.target.value) })} />
          </Field>
          <Field label="Retry base delay (ms)" help="Exponential backoff">
            <input className="input" type="number" min={0} value={v.retryBaseDelayMs} onChange={(e) => set({ retryBaseDelayMs: Number(e.target.value) })} />
          </Field>
          <Field label="Max delegation depth" help="How deep agents may ask other agents for help">
            <input className="input" type="number" min={0} max={5} value={v.maxDelegationDepth} onChange={(e) => set({ maxDelegationDepth: Number(e.target.value) })} />
          </Field>
          <Field label="Max chars of dependency output per prompt">
            <input className="input" type="number" min={1000} value={v.maxContextChars} onChange={(e) => set({ maxContextChars: Number(e.target.value) })} />
          </Field>
          <div className="space-y-3 pt-5">
            <Toggle checked={v.autoSynthesis} onChange={(x) => set({ autoSynthesis: x })} label="Coordinator writes a final report" />
            <Toggle checked={v.autoReview} onChange={(x) => set({ autoReview: x })} label="Add QA review when a QA agent exists" />
          </div>
        </div>
      </Card>
      <div className="space-y-5">
        <Card title="Orchestrator agents" actions={<button className="btn-primary btn-sm" onClick={() => orch.save.mutate()}>Save</button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Planner" help="Default: first available Project Manager, then CEO Assistant">
              <select className="input" value={orch.value.plannerAgentId ?? ''} onChange={(e) => orch.setValue({ ...orch.value!, plannerAgentId: e.target.value || null })}>
                <option value="">Automatic</option>
                {(agents.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Coordinator (CEO Assistant)" help="Chats with you and writes final reports">
              <select className="input" value={orch.value.coordinatorAgentId ?? ''} onChange={(e) => orch.setValue({ ...orch.value!, coordinatorAgentId: e.target.value || null })}>
                <option value="">Automatic</option>
                {(agents.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        </Card>
        <Card title="Usage monitoring" actions={<button className="btn-primary btn-sm" onClick={() => usage.save.mutate()}>Save</button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Warning threshold (%)">
              <input className="input" type="number" value={usage.value.warnPercent} onChange={(e) => usage.setValue({ ...usage.value!, warnPercent: Number(e.target.value) })} />
            </Field>
            <Field label="Critical threshold (%)">
              <input className="input" type="number" value={usage.value.criticalPercent} onChange={(e) => usage.setValue({ ...usage.value!, criticalPercent: Number(e.target.value) })} />
            </Field>
            <Field label="Health check every (min, 0 = off)">
              <input className="input" type="number" value={usage.value.healthCheckMinutes} onChange={(e) => usage.setValue({ ...usage.value!, healthCheckMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Billing sync every (min, 0 = off)">
              <input className="input" type="number" value={usage.value.billingSyncMinutes} onChange={(e) => usage.setValue({ ...usage.value!, billingSyncMinutes: Number(e.target.value) })} />
            </Field>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ======================================================================= media
function MediaTab() {
  const media = useSettingsSection('media');
  const providers = useProviders();
  const types = useProviderTypes();
  const info = useSystemInfo();
  if (!media.value) return <Spinner />;
  const can = (p: Provider, cap: 'transcription' | 'vision') => types.data?.find((t) => t.type === p.type)?.capabilities[cap] && p.canExecute;
  return (
    <Card title="Multimodal processing" actions={<button className="btn-primary btn-sm" onClick={() => media.save.mutate()}>Save</button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Transcription provider (audio, voice notes, video audio)" help="OpenAI API (Whisper / transcribe models) or Gemini API">
          <select className="input" value={media.value.transcriptionProviderId ?? ''} onChange={(e) => media.setValue({ ...media.value!, transcriptionProviderId: e.target.value || null })}>
            <option value="">Automatic (first capable provider)</option>
            {(providers.data ?? [])
              .filter((p) => can(p, 'transcription'))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Vision provider (image descriptions, video key frames)">
          <select className="input" value={media.value.visionProviderId ?? ''} onChange={(e) => media.setValue({ ...media.value!, visionProviderId: e.target.value || null })}>
            <option value="">Automatic (first capable provider)</option>
            {(providers.data ?? [])
              .filter((p) => can(p, 'vision'))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <div className="mt-4 rounded-lg bg-ink-850 p-3 text-sm text-slate-400">
        <div>
          ffmpeg: {info.data ? (info.data.ffmpegAvailable ? <span className="text-emerald-300">available</span> : <span className="text-amber-300">not found – video analysis limited to Gemini (&lt;18 MB)</span>) : '…'}
        </div>
        <div className="mt-1 text-xs">Documents (PDF, DOCX, XLSX, CSV, ZIP, text/code) are always parsed locally. Scanned PDFs without a text layer need OCR, which is not included.</div>
      </div>
    </Card>
  );
}

// ======================================================================= pricing
function PricingTab() {
  const pricing = useSettingsSection('pricing');
  const confirm = useConfirm();
  const [model, setModel] = useState('');
  if (!pricing.value) return <Spinner />;
  const rows = Object.entries(pricing.value);
  const set = (k: string, field: string, v: string) => pricing.setValue({ ...pricing.value!, [k]: { ...pricing.value![k], [field]: v === '' ? undefined : Number(v) } as any });
  return (
    <Card
      title="Pricing table (USD per 1M tokens) – used only for cost estimates"
      actions={
        <>
          <button
            className="btn-ghost btn-sm"
            onClick={async () => (await confirm({ title: 'Reset pricing?', message: 'Restore the built-in Anthropic list prices and remove custom entries.' })) && post('/settings/pricing/reset', {}, true).then(() => location.reload())}
          >
            Reset
          </button>
          <button className="btn-primary btn-sm" onClick={() => pricing.save.mutate()}>
            Save
          </button>
        </>
      }
    >
      <p className="mb-3 text-xs text-slate-500">Estimated cost = tokens × price. Use a trailing * for prefix matches (e.g. gpt-5*). Models without a price show “cost unknown” instead of a guess. Verify prices on each vendor's pricing page.</p>
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase text-slate-500">
          <tr>
            <th className="py-1">Model</th>
            <th>Input</th>
            <th>Output</th>
            <th>Cache read</th>
            <th>Cache write</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, p]) => (
            <tr key={k}>
              <td className="py-1 pr-2 font-mono text-xs text-slate-300">{k}</td>
              {(['input', 'output', 'cacheRead', 'cacheWrite'] as const).map((f) => (
                <td key={f} className="pr-2">
                  <input className="input h-8 py-0" type="number" step="0.01" value={(p as any)[f] ?? ''} placeholder="auto" onChange={(e) => set(k, f, e.target.value)} />
                </td>
              ))}
              <td>
                <button
                  className="btn-ghost btn-sm text-rose-300"
                  onClick={() => {
                    const next = { ...pricing.value! };
                    delete next[k];
                    pricing.setValue(next);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex gap-2">
        <input className="input w-64" placeholder="model id (e.g. gpt-5* or gemini-2.5-pro)" value={model} onChange={(e) => setModel(e.target.value)} />
        <button
          className="btn-outline"
          disabled={!model}
          onClick={() => {
            pricing.setValue({ ...pricing.value!, [model]: { input: 0, output: 0 } });
            setModel('');
          }}
        >
          <Plus className="h-4 w-4" /> Add model
        </button>
      </div>
    </Card>
  );
}

// ======================================================================= security
function SecurityTab() {
  const info = useSystemInfo();
  const audit = useQuery({ queryKey: ['audit'], queryFn: () => get<any[]>('/audit?limit=200') });
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => get<any[]>('/system/backups') });
  const backup = useAction(() => post('/system/backup'), { success: 'Backup created', invalidate: [['backups']] });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const changePw = useAction(() => post('/account/password', { current, next }), { success: 'Password changed – please sign in again' });
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="space-y-5">
        <Card title={<span className="flex items-center gap-2"><Shield className="h-4 w-4" /> Security status</span>}>
          <ul className="space-y-1.5 text-sm text-slate-300">
            <li>🔐 Provider credentials: AES-256-GCM, master key from {info.data?.masterKeySource === 'env' ? 'MAO_MASTER_KEY env' : 'data/master.key file'}</li>
            <li>🔑 Manager password: salted scrypt hash</li>
            <li>🧾 Every mutating action is written to the audit log (secrets redacted)</li>
            <li>⛔ Destructive actions require explicit confirmation (enforced server-side)</li>
            <li>🧑‍⚖️ Sensitive agent actions require your approval</li>
            <li>📁 CLI agents are confined to the project workspace with tool permissions per agent</li>
            <li className="text-xs text-slate-500">
              Data dir: {info.data?.dataDir} · schema v{info.data?.schemaVersion} · Node {info.data?.node}
            </li>
          </ul>
        </Card>
        <Card
          title={<span className="flex items-center gap-2"><Archive className="h-4 w-4" /> Backups</span>}
          actions={
            <button className="btn-primary btn-sm" onClick={() => backup.mutate()}>
              Create backup
            </button>
          }
        >
          <p className="mb-2 text-xs text-slate-500">Consistent SQLite snapshot (VACUUM INTO). Back up data/master.key separately – it is required to decrypt credentials. Uploaded files live in data/storage.</p>
          {!backups.data?.length && <div className="text-sm text-slate-500">No backups yet.</div>}
          <ul className="divide-y divide-white/5">
            {(backups.data ?? []).map((b) => (
              <li key={b.name} className="flex items-center justify-between py-1.5 text-sm">
                <span className="truncate font-mono text-xs text-slate-300">{b.name}</span>
                <span className="flex items-center gap-2 text-xs text-slate-500">
                  {fmtBytes(b.size)} · {timeAgo(b.createdAt)}
                  <a className="btn-ghost btn-sm" href={downloadUrl(`/system/backups/${encodeURIComponent(b.name)}`)}>
                    <Download className="h-3.5 w-3.5" />
                  </a>
                </span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Change password</span>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <input className="input" type="password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <input className="input" type="password" placeholder="New password (min 8)" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <button className="btn-primary mt-3" disabled={!current || next.length < 8} onClick={() => changePw.mutate(undefined, { onSuccess: () => setTimeout(() => location.reload(), 1200) })}>
            Change password
          </button>
        </Card>
      </div>
      <Card title="Audit log" pad={false}>
        <div className="max-h-[75vh] overflow-y-auto">
          <table className="w-full text-xs">
            <tbody>
              {(audit.data ?? []).map((a) => (
                <tr key={a.id} className="border-b border-white/5 align-top">
                  <td className="whitespace-nowrap px-3 py-1.5 text-slate-500" title={fmtDate(a.createdAt)}>
                    {timeAgo(a.createdAt)}
                  </td>
                  <td className="px-2 py-1.5 text-slate-400">{a.actor}</td>
                  <td className="px-2 py-1.5 font-mono text-accent-400">{a.action}</td>
                  <td className="px-2 py-1.5 text-slate-500">
                    {a.targetType}
                    {a.targetId ? `:${a.targetId}` : ''} {Object.keys(a.details ?? {}).length ? JSON.stringify(a.details) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
