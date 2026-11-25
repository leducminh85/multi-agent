import { ChevronDown, ChevronRight, RotateCcw, Trash2, XOctagon } from 'lucide-react';
import { useState } from 'react';
import { del, post } from '../lib/api';
import { useAction, useMission } from '../lib/hooks';
import { timeAgo } from '../lib/format';
import type { Mission } from '../lib/types';
import { Empty, Output, ProgressBar, Spinner, StatusBadge, useConfirm } from './ui';

export default function MissionList({ missions, onOpenTask }: { missions: Mission[]; onOpenTask: (id: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!missions.length) return <Empty title="No missions yet">Submit a request in the Command Center – the orchestrator will plan it and assign agents.</Empty>;
  return (
    <ul className="divide-y divide-white/5">
      {missions.map((m) => {
        const pct = m.progress?.total ? (m.progress.completed / m.progress.total) * 100 : 0;
        return (
          <li key={m.id} className="py-2">
            <button className="flex w-full items-center gap-3 text-left" onClick={() => setOpen(open === m.id ? null : m.id)}>
              {open === m.id ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-100">{m.title}</span>
                  <StatusBadge status={m.status} />
                  {m.options?.mode === 'direct' && <span className="text-[11px] text-slate-500">direct</span>}
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
                  <span className="w-28 shrink-0">
                    {m.progress?.completed ?? 0}/{m.progress?.total ?? 0} tasks done
                  </span>
                  <div className="w-full max-w-[220px]">
                    <ProgressBar value={pct} tone={m.status === 'failed' ? 'bad' : m.status === 'completed' ? 'good' : 'accent'} />
                  </div>
                  <span className="shrink-0">{timeAgo(m.createdAt)}</span>
                </div>
              </div>
            </button>
            {open === m.id && <MissionDetail id={m.id} onOpenTask={onOpenTask} />}
          </li>
        );
      })}
    </ul>
  );
}

function MissionDetail({ id, onOpenTask }: { id: string; onOpenTask: (id: string) => void }) {
  const q = useMission(id);
  const confirm = useConfirm();
  const cancel = useAction(() => post(`/missions/${id}/cancel`), { success: 'Mission cancelled' });
  const replan = useAction(() => post(`/missions/${id}/replan`), { success: 'Re-planning…' });
  const remove = useAction(() => del(`/missions/${id}`), { success: 'Mission deleted', invalidate: [['missions'], ['overview']] });
  const m = q.data;
  if (!m) return <Spinner className="ml-7 mt-2" />;
  const active = m.status === 'planning' || m.status === 'running';
  return (
    <div className="ml-7 mt-3 space-y-3">
      <div className="rounded-lg bg-ink-850 p-3 text-sm text-slate-300">
        <div className="label">Request</div>
        <div translate="no" className="whitespace-pre-wrap">{m.requestText}</div>
        {m.plan?.summary && (
          <>
            <div className="label mt-3">Plan</div>
            <div>{m.plan.summary}</div>
          </>
        )}
        {m.plan?.fallbackReason && <div className="mt-2 text-xs text-amber-300">⚠ {m.plan.fallbackReason}</div>}
        {m.error && <div className="mt-2 text-xs text-rose-300">{m.error}</div>}
      </div>
      <ul className="space-y-1">
        {(m.tasks ?? []).map((t) => (
          <li key={t.id}>
            <button className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5" onClick={() => onOpenTask(t.id)}>
              <span className="min-w-0 truncate" style={{ paddingLeft: t.parentTaskId ? 16 : 0 }}>
                {t.parentTaskId ? '↳ ' : ''}
                {t.title}
                <span className="ml-2 text-xs text-slate-500">
                  {t.agentName ?? t.roleKey} {t.kind !== 'work' ? `· ${t.kind}` : ''}
                </span>
              </span>
              <StatusBadge status={t.status} />
            </button>
          </li>
        ))}
        {m.status === 'planning' && (
          <li className="flex items-center gap-2 px-2 text-sm text-violet-300">
            <Spinner /> The planner is analysing the request…
          </li>
        )}
      </ul>
      {m.result && (
        <div>
          <div className="label">Final result</div>
          <Output text={m.result} />
        </div>
      )}
      <div className="flex gap-2">
        {active && (
          <button className="btn-outline btn-sm" onClick={async () => (await confirm({ title: 'Cancel mission?', message: 'All unfinished tasks will be cancelled.', danger: true })) && cancel.mutate()}>
            <XOctagon className="h-3.5 w-3.5" /> Cancel mission
          </button>
        )}
        {m.status === 'failed' && !(m.tasks ?? []).length && (
          <button className="btn-outline btn-sm" onClick={() => replan.mutate()}>
            <RotateCcw className="h-3.5 w-3.5" /> Re-plan
          </button>
        )}
        {!active && (
          <button
            className="btn-ghost btn-sm text-rose-300"
            onClick={async () => (await confirm({ title: 'Delete mission?', message: 'The mission, its tasks and outputs will be permanently deleted.', danger: true, confirmText: 'Delete' })) && remove.mutate()}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        )}
      </div>
    </div>
  );
}
