import { Bot, Pause, Play, Plus, Trash2, Users } from 'lucide-react';
import { useState } from 'react';
import AgentDrawer from '../components/AgentDrawer';
import { useConnectableAis } from '../components/AgentAiPicker';
import QuickAgentModal from '../components/QuickAgentModal';
import TaskDrawer from '../components/TaskDrawer';
import { ActivityBadge, Badge, Empty, Field, Modal, PageHeader, Spinner, useConfirm, useToast } from '../components/ui';
import { useQueryClient } from '@tanstack/react-query';
import { del, patch, post } from '../lib/api';
import { useAction, useAgents, useProviders } from '../lib/hooks';
import { fmtNum, timeAgo } from '../lib/format';
import type { Agent } from '../lib/types';

export default function AgentsPage() {
  const agents = useAgents();
  const [creating, setCreating] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const list = (agents.data ?? []).filter((a) => !filter || `${a.name} ${a.roleName} ${a.providerName}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Agent Management"
        subtitle="Hire, configure, pause and supervise your AI workforce. No limit on how many agents you declare – concurrency is limited per agent, per provider and globally."
        actions={
          <>
            <input className="input w-48" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <SwitchTeamAi />
            <button className="btn-outline" onClick={() => setTeamOpen(true)}>
              <Users className="h-4 w-4" /> Default team
            </button>
            <button className="btn-primary" onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" /> Hire employee
            </button>
          </>
        }
      />
      {agents.isLoading ? (
        <Spinner />
      ) : !list.length ? (
        <div className="card">
          <Empty icon={<Bot className="h-8 w-8" />} title="No agents yet">
            Create an agent and connect it to a provider, or generate a default team (CEO Assistant, PM, Research, Developer, Content, QA).
          </Empty>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {list.map((a) => (
            <AgentCard key={a.id} agent={a} onOpen={() => setSelected(a.id)} />
          ))}
        </div>
      )}
      <QuickAgentModal open={creating} onClose={() => setCreating(false)} />
      <TeamModal open={teamOpen} onClose={() => setTeamOpen(false)} />
      <AgentDrawer agentId={selected} onClose={() => setSelected(null)} onOpenTask={setTaskId} />
      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} onOpenTask={setTaskId} />
    </>
  );
}

function AgentCard({ agent: a, onOpen }: { agent: Agent; onOpen: () => void }) {
  const confirm = useConfirm();
  const toggle = useAction(() => post(`/agents/${a.id}/${a.paused ? 'resume' : 'pause'}`), { success: a.paused ? `${a.name} resumed` : `${a.name} paused` });
  const remove = useAction(() => del(`/agents/${a.id}`), { success: `${a.name} removed`, invalidate: [['agents']] });
  return (
    <div className="card group cursor-pointer p-4 transition hover:border-accent-500/30" onClick={onOpen}>
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold text-ink-950" style={{ background: a.appearance?.color ?? '#818cf8' }}>
          {a.name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-white">{a.name}</span>
            {!a.enabled && <Badge className="border-zinc-500/30 text-zinc-400">disabled</Badge>}
            {a.paused && <Badge className="border-amber-500/30 text-amber-300">paused</Badge>}
          </div>
          <div className="truncate text-xs text-slate-400">
            {a.roleName} · {a.providerName ?? 'no provider'}
            {a.model ? ` · ${a.model}` : ''}
          </div>
        </div>
        <ActivityBadge activity={a.activity} />
      </div>
      <div className="mt-3 min-h-[2.5rem] text-sm text-slate-400">{a.activityDetail ? <span className="line-clamp-2">{a.activityDetail}</span> : <span className="text-slate-600">No current activity</span>}</div>
      {a.unavailableReason && <div className="mb-2 text-xs text-amber-300">⚠ {a.unavailableReason}</div>}
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          {fmtNum(a.tokensToday ?? 0)} tokens today · {a.lastActiveAt ? `active ${timeAgo(a.lastActiveAt)}` : 'never active'}
        </span>
        <span className="flex gap-1 opacity-0 transition group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          <button className="btn-ghost btn-sm" title={a.paused ? 'Resume' : 'Pause'} onClick={() => toggle.mutate()}>
            {a.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
          <button
            className="btn-ghost btn-sm text-rose-300"
            title="Delete"
            onClick={async () =>
              (await confirm({ title: `Delete ${a.name}?`, message: 'The agent and its private memory are deleted. Its unfinished tasks go back to the queue.', danger: true, confirmText: 'Delete' })) &&
              remove.mutate()
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
    </div>
  );
}

function TeamModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const providers = useProviders();
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const create = useAction(() => post('/agents/team', { providerId, model: model || undefined }), { success: 'Default team created', invalidate: [['agents']] });
  const executable = (providers.data ?? []).filter((p) => p.canExecute);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create a default team"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!providerId || create.isPending} onClick={() => create.mutate(undefined, { onSuccess: onClose })}>
            Create 6 agents
          </button>
        </>
      }
    >
      <p className="mb-4 text-sm text-slate-400">Creates CEO Assistant, Project Manager, Research, Developer, Content and QA agents on one provider. You can change each agent's provider and model later.</p>
      {!executable.length && <div className="mb-3 text-sm text-amber-300">Add an executable provider first (Settings → Providers).</div>}
      <Field label="Provider">
        <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          <option value="">Select…</option>
          {executable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.displayName}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Model (optional)" className="mt-3">
        <input className="input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="provider default" />
      </Field>
    </Modal>
  );
}

/** Move every employee to one AI in a single step (e.g. from Antigravity to Claude). Models reset to that AI's default. */
function SwitchTeamAi() {
  const agents = useAgents();
  const providers = useProviders();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const toast = useToast();
  const { connectable, connect } = useConnectableAis();
  const usable = (providers.data ?? []).filter((p) => p.canExecute && p.enabled);
  if (usable.length + connectable.length < 2 || !agents.data?.length) return null;
  const run = async (value: string) => {
    let p = usable.find((x) => x.id === value);
    if (!p && value.startsWith('connect:')) {
      try {
        p = (await connect(value.slice('connect:'.length))) ?? undefined;
      } catch (e: any) {
        return toast.push({ kind: 'error', text: e.message });
      }
    }
    if (!p) return;
    const providerId = p.id;
    const list = agents.data!.filter((a) => a.providerId !== providerId);
    if (!list.length) return toast.push({ kind: 'info', text: `Everyone already uses ${p.name}` });
    if (!(await confirm({ title: `Switch the whole team to ${p.name}?`, message: `${list.length} employee(s) will use ${p.name} with its default model for new work. Work already running is not interrupted.`, confirmText: 'Switch' }))) return;
    for (const a of list) await patch(`/agents/${a.id}`, { providerId, model: null });
    toast.push({ kind: 'success', text: `${list.length} employee(s) now use ${p.name}` });
    void qc.invalidateQueries({ queryKey: ['agents'] });
  };
  return (
    <select className="input w-auto" value="" onChange={(e) => void run(e.target.value)} aria-label="Switch the whole team to another AI">
      <option value="">Switch whole team to…</option>
      {usable.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
      {connectable.map((c) => (
        <option key={c.type} value={`connect:${c.type}`}>
          {`${c.label} – ${c.loggedIn === false ? 'sign in to connect' : 'not connected yet, choose to connect'}`}
        </option>
      ))}
    </select>
  );
}
