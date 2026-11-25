import { Pause, Pencil, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { post } from '../lib/api';
import { useAction, useAgent } from '../lib/hooks';
import { fmtNum, timeAgo } from '../lib/format';
import { useTaskStream } from '../lib/realtime';
import AgentAiPicker from './AgentAiPicker';
import AgentForm from './AgentForm';
import CommandCenter from './CommandCenter';
import { ActivityBadge, Badge, Drawer, Output, Spinner, StatusBadge, Tabs, useConfirm } from './ui';

export default function AgentDrawer({ agentId, onClose, onOpenTask }: { agentId: string | null; onClose: () => void; onOpenTask: (id: string) => void }) {
  const q = useAgent(agentId);
  const a = q.data as any;
  const [tab, setTab] = useState<'now' | 'history' | 'assign' | 'memory'>('now');
  const [editing, setEditing] = useState(false);
  const stream = useTaskStream(a?.currentTaskId);
  const confirm = useConfirm();
  const pause = useAction(() => post(`/agents/${agentId}/${a?.paused ? 'resume' : 'pause'}`), { success: a?.paused ? 'Agent resumed' : 'Agent paused' });
  const stop = useAction(() => post(`/agents/${agentId}/stop`), { success: 'Agent stopped' });

  return (
    <Drawer
      open={!!agentId}
      onClose={onClose}
      title={
        a ? (
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full" style={{ background: a.appearance?.color ?? '#818cf8' }} />
            <span className="truncate">{a.name}</span>
            <ActivityBadge activity={a.activity} />
            {a.paused && <Badge className="border-amber-500/30 text-amber-300">paused</Badge>}
          </div>
        ) : (
          'Agent'
        )
      }
    >
      {!a ? (
        <Spinner />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Info k="Role" v={a.roleName} />
            <Info k="Provider" v={a.providerName ?? '—'} />
            <Info k="Model" v={a.model ?? 'provider default'} />
            <Info k="Tokens today" v={fmtNum(a.tokensToday)} />
          </div>
          <AgentAiPicker agent={a} />
          {a.unavailableReason && <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">Not available: {a.unavailableReason}</div>}
          <div className="flex flex-wrap gap-2">
            <button className="btn-outline btn-sm" onClick={() => pause.mutate()}>
              {a.paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />} {a.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              className="btn-outline btn-sm"
              onClick={async () =>
                (await confirm({ title: `Stop ${a.name}?`, message: 'Running work is aborted and returned to the queue; the agent is paused.', danger: true, confirmText: 'Stop agent' })) && stop.mutate()
              }
            >
              <Square className="h-3.5 w-3.5" /> Stop
            </button>
            <button className="btn-outline btn-sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </button>
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'now', label: 'Now' },
              { id: 'history', label: 'History' },
              { id: 'assign', label: 'Assign task' },
              { id: 'memory', label: `Memory (${a.memory?.length ?? 0})` },
            ]}
          />

          {tab === 'now' &&
            (a.currentTask ? (
              <div className="space-y-3">
                <button className="flex w-full items-center justify-between rounded-lg bg-ink-850 px-3 py-2 text-left hover:bg-ink-800" onClick={() => onOpenTask(a.currentTask.id)}>
                  <span className="truncate text-sm font-medium text-white">{a.currentTask.title}</span>
                  <StatusBadge status={a.currentTask.status} />
                </button>
                <div className="text-xs text-slate-500">{a.activityDetail}</div>
                <ol className="space-y-1 text-sm">
                  {(a.currentTask.steps ?? []).map((s: any) => (
                    <li key={s.id} className="flex gap-2">
                      <span className={s.status === 'done' ? 'text-emerald-400' : s.status === 'failed' ? 'text-rose-400' : s.status === 'info' ? 'text-sky-400' : 'animate-pulse text-accent-400'}>●</span>
                      <span className="text-slate-300">{s.label}</span>
                      {s.detail && <span className="truncate text-slate-500">· {s.detail}</span>}
                    </li>
                  ))}
                </ol>
                {stream && <Output text={stream} />}
              </div>
            ) : (
              <div className="rounded-lg bg-ink-850 px-3 py-6 text-center text-sm text-slate-400">
                {a.activityDetail ?? 'No task in progress.'}
              </div>
            ))}

          {tab === 'history' && (
            <div className="space-y-4">
              <div>
                <h4 className="label">Recent tasks</h4>
                {(a.recentTasks ?? []).length === 0 && <div className="text-sm text-slate-500">No tasks yet.</div>}
                {(a.recentTasks ?? []).map((t: any) => (
                  <button key={t.id} className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-white/5" onClick={() => onOpenTask(t.id)}>
                    <span className="truncate">{t.title}</span>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                      {timeAgo(t.updatedAt)} <StatusBadge status={t.status} />
                    </span>
                  </button>
                ))}
              </div>
              <div>
                <h4 className="label">Activity log</h4>
                <ul className="space-y-1 text-sm">
                  {(a.activityLog ?? []).map((x: any) => (
                    <li key={x.id} className="flex justify-between gap-2">
                      <span className="text-slate-300">{x.message}</span>
                      <span className="shrink-0 text-xs text-slate-500">{timeAgo(x.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {tab === 'assign' && (
            <div>
              <p className="mb-2 text-sm text-slate-400">Give {a.name} a task directly – it skips planning and goes straight to this agent.</p>
              <CommandCenter mode="direct" agentId={a.id} placeholder={`Task for ${a.name}…`} compact />
            </div>
          )}

          {tab === 'memory' && (
            <div className="space-y-2">
              {(a.memory ?? []).length === 0 && <div className="text-sm text-slate-500">This agent has not stored any memories yet. Agents save durable facts through the collaboration protocol.</div>}
              {(a.memory ?? []).map((k: any) => (
                <div key={k.id} className="rounded-lg bg-ink-850 px-3 py-2 text-sm text-slate-300">
                  {k.content}
                  <div className="text-xs text-slate-500">{timeAgo(k.createdAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <AgentForm open={editing} onClose={() => setEditing(false)} agent={a} />
    </Drawer>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-ink-850 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{k}</div>
      <div className="truncate text-slate-200">{v}</div>
    </div>
  );
}
