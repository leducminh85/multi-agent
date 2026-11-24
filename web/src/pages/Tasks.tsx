import { useMemo, useState } from 'react';
import ActivityFeed from '../components/ActivityFeed';
import TaskDrawer from '../components/TaskDrawer';
import { Card, Empty, PageHeader, Spinner, StatusBadge, Tabs, cx } from '../components/ui';
import { useAgents, useMissions, useTasks } from '../lib/hooks';
import { TASK_STATUSES, fmtDate, formatDuration, timeAgo } from '../lib/format';
import type { Task } from '../lib/types';

type View = 'kanban' | 'list' | 'timeline' | 'gantt' | 'feed';

const BAR: Record<string, string> = {
  pending: '#64748b',
  planning: '#a78bfa',
  assigned: '#818cf8',
  running: '#38bdf8',
  waiting: '#fb923c',
  reviewing: '#22d3ee',
  completed: '#34d399',
  failed: '#f43f5e',
  cancelled: '#52525b',
};

export default function TasksPage() {
  const [view, setView] = useState<View>('kanban');
  const [missionId, setMissionId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [taskId, setTaskId] = useState<string | null>(null);
  const tasks = useTasks({ missionId: missionId || undefined, agentId: agentId || undefined });
  const missions = useMissions();
  const agents = useAgents();
  const list = tasks.data ?? [];

  return (
    <>
      <PageHeader
        title="Task Management"
        subtitle="Every task created by the orchestrator, by agents (help requests) or by you. Progress comes from real execution steps."
        actions={
          <>
            <select className="input w-56" value={missionId} onChange={(e) => setMissionId(e.target.value)}>
              <option value="">All missions</option>
              {(missions.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
            <select className="input w-44" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">All agents</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </>
        }
      />
      <div className="mb-4">
        <Tabs
          value={view}
          onChange={setView}
          tabs={[
            { id: 'kanban', label: 'Kanban' },
            { id: 'list', label: 'List' },
            { id: 'timeline', label: 'Timeline' },
            { id: 'gantt', label: 'Gantt' },
            { id: 'feed', label: 'Activity feed' },
          ]}
        />
      </div>
      {tasks.isLoading ? (
        <Spinner />
      ) : view === 'feed' ? (
        <Card pad={false}>
          <div className="p-2">
            <ActivityFeed params={`?limit=200${missionId ? `&missionId=${missionId}` : ''}${agentId ? `&agentId=${agentId}` : ''}`} onTask={setTaskId} />
          </div>
        </Card>
      ) : !list.length ? (
        <div className="card">
          <Empty title="No tasks">Tasks appear here as soon as a mission is planned.</Empty>
        </div>
      ) : view === 'kanban' ? (
        <Kanban tasks={list} onOpen={setTaskId} />
      ) : view === 'list' ? (
        <TaskTable tasks={list} onOpen={setTaskId} />
      ) : view === 'timeline' ? (
        <Timeline tasks={list} onOpen={setTaskId} />
      ) : (
        <Gantt tasks={list} onOpen={setTaskId} />
      )}
      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} onOpenTask={setTaskId} />
    </>
  );
}

function Kanban({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-4">
      {TASK_STATUSES.map((s) => {
        const col = tasks.filter((t) => t.status === s);
        return (
          <div key={s} className="w-64 shrink-0">
            <div className="mb-2 flex items-center justify-between px-1">
              <StatusBadge status={s} />
              <span className="text-xs text-slate-500">{col.length}</span>
            </div>
            <div className="min-h-[120px] space-y-2 rounded-xl border border-white/5 bg-ink-900/40 p-2">
              {col.map((t) => (
                <button key={t.id} onClick={() => onOpen(t.id)} className="card block w-full p-3 text-left transition hover:border-accent-500/30">
                  <div className="line-clamp-2 text-sm font-medium text-slate-100">{t.title}</div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="truncate">{t.agentName ?? `role: ${t.roleKey ?? '—'}`}</span>
                    <span>{t.kind !== 'work' ? t.kind : ''}</span>
                  </div>
                  {t.waitingReason && <div className="mt-1 line-clamp-2 text-[11px] text-orange-300">{t.waitingReason}</div>}
                  {t.attempts > 1 && <div className="mt-1 text-[11px] text-amber-400">attempt {t.attempts}/{t.maxAttempts}</div>}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TaskTable({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr className="border-b border-white/5">
            <th className="px-3 py-2">Task</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Agent</th>
            <th className="px-3 py-2">Provider</th>
            <th className="px-3 py-2">Started</th>
            <th className="px-3 py-2">Duration</th>
            <th className="px-3 py-2">Deps</th>
            <th className="px-3 py-2">Attempts</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className="cursor-pointer border-b border-white/5 hover:bg-white/[.03]" onClick={() => onOpen(t.id)}>
              <td className="max-w-[320px] px-3 py-2">
                <div className="truncate text-slate-100">{t.title}</div>
                <div className="font-mono text-[10px] text-slate-600">{t.id}</div>
              </td>
              <td className="px-3 py-2">
                <StatusBadge status={t.status} />
              </td>
              <td className="px-3 py-2 text-slate-300">{t.agentName ?? '—'}</td>
              <td className="px-3 py-2 text-slate-400">{t.providerName ?? '—'}</td>
              <td className="px-3 py-2 text-slate-400">{t.startedAt ? timeAgo(t.startedAt) : '—'}</td>
              <td className="px-3 py-2 text-slate-400">{t.startedAt ? formatDuration(new Date(t.finishedAt ?? Date.now()).getTime() - new Date(t.startedAt).getTime()) : '—'}</td>
              <td className="px-3 py-2 text-slate-400">{t.dependsOn.length || '—'}</td>
              <td className="px-3 py-2 text-slate-400">
                {t.attempts}/{t.maxAttempts}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timeline({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const events = useMemo(() => {
    const ev: { at: string; task: Task; label: string; tone: string }[] = [];
    for (const t of tasks) {
      ev.push({ at: t.createdAt, task: t, label: 'created', tone: 'bg-slate-500' });
      if (t.startedAt) ev.push({ at: t.startedAt, task: t, label: `started by ${t.agentName ?? '—'}`, tone: 'bg-sky-500' });
      if (t.finishedAt) ev.push({ at: t.finishedAt, task: t, label: t.status, tone: t.status === 'completed' ? 'bg-emerald-500' : t.status === 'failed' ? 'bg-rose-500' : 'bg-zinc-500' });
    }
    return ev.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 400);
  }, [tasks]);
  let lastDay = '';
  return (
    <div className="card p-4">
      <ol className="relative ml-2 border-l border-white/10">
        {events.map((e, i) => {
          const day = new Date(e.at).toLocaleDateString();
          const header = day !== lastDay;
          lastDay = day;
          return (
            <li key={i} className="mb-2 ml-4">
              {header && <div className="-ml-4 mb-2 mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{day}</div>}
              <span className={cx('absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full', e.tone)} />
              <button className="text-left text-sm hover:underline" onClick={() => onOpen(e.task.id)}>
                <span className="text-slate-500">{new Date(e.at).toLocaleTimeString()} · </span>
                <span className="text-slate-200">{e.task.title}</span> <span className="text-slate-400">{e.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Gantt({ tasks, onOpen }: { tasks: Task[]; onOpen: (id: string) => void }) {
  const rows = useMemo(() => [...tasks].sort((a, b) => (a.startedAt ?? a.createdAt).localeCompare(b.startedAt ?? b.createdAt)).slice(0, 150), [tasks]);
  const now = Date.now();
  const t0 = Math.min(...rows.map((t) => new Date(t.startedAt ?? t.createdAt).getTime()));
  // Only extend the axis to "now" while something is still in progress.
  const t1 = Math.max(...rows.map((t) => (t.finishedAt ? new Date(t.finishedAt).getTime() : t.startedAt || !['completed', 'failed', 'cancelled'].includes(t.status) ? now : 0)));
  const span = Math.max(1000, t1 - t0);
  const W = 900;
  const LABEL = 240;
  const ROW = 26;
  const x = (ms: number) => LABEL + ((ms - t0) / span) * (W - LABEL - 10);
  const idx = new Map(rows.map((t, i) => [t.id, i]));
  const ticks = 6;
  return (
    <div className="card overflow-x-auto p-3">
      <svg width={W} height={rows.length * ROW + 30} className="min-w-full font-sans">
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const ms = t0 + (span * i) / ticks;
          return (
            <g key={i}>
              <line x1={x(ms)} x2={x(ms)} y1={20} y2={rows.length * ROW + 24} stroke="rgba(255,255,255,.06)" />
              <text x={x(ms)} y={12} fill="#64748b" fontSize={10} textAnchor="middle">
                {new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: span < 3600_000 ? '2-digit' : undefined })}
              </text>
            </g>
          );
        })}
        {rows.map((t, i) => {
          const y = 24 + i * ROW;
          const started = t.startedAt ? new Date(t.startedAt).getTime() : null;
          const end = t.finishedAt ? new Date(t.finishedAt).getTime() : now;
          return (
            <g key={t.id} className="cursor-pointer" onClick={() => onOpen(t.id)}>
              <text x={4} y={y + 14} fill="#cbd5e1" fontSize={11}>
                {(t.parentTaskId ? '↳ ' : '') + (t.title.length > 34 ? `${t.title.slice(0, 33)}…` : t.title)}
              </text>
              {t.dependsOn.map((d) => {
                const j = idx.get(d);
                const dep = j !== undefined ? rows[j] : null;
                if (!dep?.finishedAt || !started) return null;
                return <path key={d} d={`M${x(new Date(dep.finishedAt).getTime())},${24 + j! * ROW + 9} L${x(started)},${y + 9}`} stroke="rgba(148,163,184,.35)" fill="none" strokeDasharray="3 3" />;
              })}
              {started ? (
                <rect x={x(started)} y={y + 3} width={Math.max(3, x(end) - x(started))} height={ROW - 9} rx={4} fill={BAR[t.status]} opacity={t.finishedAt ? 0.85 : 1}>
                  <title>{`${t.title}\n${t.status} · ${fmtDate(t.startedAt)} → ${t.finishedAt ? fmtDate(t.finishedAt) : 'now'}`}</title>
                </rect>
              ) : (
                <circle cx={x(new Date(t.createdAt).getTime())} cy={y + 9} r={4} fill="none" stroke={BAR[t.status]}>
                  <title>{`${t.title}\nnot started (${t.status})`}</title>
                </circle>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
