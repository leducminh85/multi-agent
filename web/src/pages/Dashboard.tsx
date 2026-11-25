import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Building2, Gauge, ListChecks, Maximize2, MessagesSquare, Sparkles, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import AgentDrawer from '../components/AgentDrawer';
import CommandCenter from '../components/CommandCenter';
import AnswerBox from '../components/AnswerBox';
import Markdown from '../components/Markdown';
import MissionList from '../components/MissionList';
import QuickAgentModal from '../components/QuickAgentModal';
import QuotaRecovery from '../components/QuotaRecovery';
import SetupWizard from '../components/SetupWizard';
import TaskDrawer from '../components/TaskDrawer';
import { Badge, cx, Empty, ProgressBar } from '../components/ui';
import { get, post } from '../lib/api';
import { useAction, useAgents, useAlerts, useApprovals, useMessages, useMissions, useOverview, useProviders, useRoles, useTasks } from '../lib/hooks';
import { fmtNum, fmtUsd, formatDuration, timeAgo } from '../lib/format';
import { onEvent } from '../lib/realtime';
import type { QuotaEntry, Task } from '../lib/types';
import { OfficeEngine, type OfficeAgent } from '../office/engine';
import { Bubble, KIND_STYLE } from './Communication';

/**
 * The single management screen: assign work on top, then four live panels —
 * Virtual Office, Communication, Tasks and Usage. Everything else lives in the "More" menu.
 */
export default function DashboardPage() {
  const providers = useProviders();
  const agents = useAgents();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [hire, setHire] = useState(false);

  const ready = providers.isSuccess && agents.isSuccess;
  const hasAi = (providers.data ?? []).some((p) => p.canExecute);
  const needsSetup = ready && (!hasAi || !agents.data!.length);

  useEffect(() => {
    if (!needsSetup) return;
    try {
      if (sessionStorage.getItem('mao-wizard-shown')) return;
      sessionStorage.setItem('mao-wizard-shown', '1');
    } catch {
      /* storage unavailable – still show it */
    }
    setWizard(true);
  }, [needsSetup]);

  return (
    <div className="flex flex-col gap-3 lg:h-full">
      {needsSetup && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent-500/40 bg-accent-600/10 px-4 py-3 shadow-glow">
          <Sparkles className="h-5 w-5 text-accent-400" />
          <div className="min-w-0 flex-1 text-sm text-slate-200">
            <b>Your office is empty.</b> Connect an AI and hire a team. It takes about a minute and needs no technical knowledge.
          </div>
          <button className="btn-primary" onClick={() => setWizard(true)}>
            Set up now
          </button>
        </div>
      )}

      <CommandCenter compact placeholder="Assign work: describe what you need and the team plans, splits and does it… (you can attach files or record your voice)" />

      <div className="grid gap-3 lg:min-h-[620px] lg:flex-1 lg:grid-cols-12 lg:grid-rows-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <OfficePanel className="h-[380px] lg:col-span-8 lg:h-auto" onSelect={setAgentId} onHire={() => setHire(true)} onSetup={() => setWizard(true)} />
        <CommsPanel className="h-[520px] lg:col-span-4 lg:row-span-2 lg:h-auto" onTask={setTaskId} />
        <TasksPanel className="h-[420px] lg:col-span-5 lg:h-auto" onTask={setTaskId} />
        <UsagePanel className="h-[420px] lg:col-span-3 lg:h-auto" />
      </div>

      <SetupWizard open={wizard} onClose={() => setWizard(false)} />
      <QuickAgentModal open={hire} onClose={() => setHire(false)} />
      <AgentDrawer agentId={agentId} onClose={() => setAgentId(null)} onOpenTask={setTaskId} />
      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} onOpenTask={setTaskId} />
    </div>
  );
}

// ------------------------------------------------------------------ shared panel chrome
function Panel({ icon, title, extra, actions, className, children }: { icon: ReactNode; title: string; extra?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cx('card flex min-h-0 flex-col overflow-hidden', className)}>
      <header className="flex shrink-0 items-center gap-2 border-b border-white/5 px-3 py-2">
        <span className="text-accent-400">{icon}</span>
        <h2 className="whitespace-nowrap text-sm font-semibold text-white">{title}</h2>
        {extra && <span className="hidden truncate text-xs text-slate-500 sm:inline">{extra}</span>}
        <div className="flex-1" />
        <div className="flex items-center gap-1">{actions}</div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function Segments<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 px-2 py-1.5">
      {items.map((i) => (
        <button
          key={i.id}
          onClick={() => onChange(i.id)}
          className={cx('whitespace-nowrap rounded-md px-2 py-1 text-xs transition', value === i.id ? 'bg-accent-600/20 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ virtual office
function OfficePanel({ className, onSelect, onHire, onSetup }: { className: string; onSelect: (id: string) => void; onHire: () => void; onSetup: () => void }) {
  const agents = useAgents();
  const roles = useRoles();
  const overview = useOverview();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<OfficeEngine | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  const officeAgents: OfficeAgent[] = useMemo(() => {
    const roleDept = new Map((roles.data ?? []).map((r) => [r.id, r.department]));
    return (agents.data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      color: a.appearance?.color ?? '#818cf8',
      hair: a.appearance?.hair ?? 0,
      activity: a.activity,
      detail: a.activityDetail,
      paused: a.paused,
      enabled: a.enabled,
      department: a.department || roleDept.get(a.roleId) || 'main',
    }));
  }, [agents.data, roles.data]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new OfficeEngine(canvasRef.current, { onSelect: (id) => id && selectRef.current(id), fill: true });
    engineRef.current = engine;
    const off = onEvent((e) => {
      if (e.type === 'message.created' && e.payload.channel === 'agents' && e.payload.fromId && e.payload.toId) engine.pulseLink(e.payload.fromId, e.payload.toId);
      if (e.type === 'task.updated' && e.payload.status === 'completed' && e.payload.agentId) engine.celebrate(e.payload.agentId);
    });
    return () => {
      off();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);
  useEffect(() => {
    engineRef.current?.setAgents(officeAgents);
  }, [officeAgents]);
  useEffect(() => {
    engineRef.current?.setRunningTasks((overview.data?.tasks?.running ?? 0) + (overview.data?.tasks?.reviewing ?? 0));
  }, [overview.data]);

  const working = (agents.data ?? []).filter((a) => !a.paused && a.activity !== 'idle').length;

  return (
    <Panel
      className={className}
      icon={<Building2 className="h-4 w-4" />}
      title="Virtual office"
      extra={agents.data?.length ? `${working} working · ${agents.data.length - working} idle · click a person for details` : undefined}
      actions={
        <>
          <button className="btn-ghost btn-sm" onClick={onHire} title="Hire an AI employee">
            <UserPlus className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Hire</span>
          </button>
          <Link to="/office" className="btn-ghost btn-sm" title="Full screen">
            <Maximize2 className="h-3.5 w-3.5" />
          </Link>
        </>
      }
    >
      <div className="relative min-h-0 flex-1 bg-[#080a12]">
        <canvas ref={canvasRef} className="pixelated absolute inset-0 block" />
        {!agents.isLoading && !officeAgents.length && (
          <div className="absolute inset-0 flex items-center justify-center bg-ink-950/70">
            <Empty title="No one works here yet">
              <button className="btn-primary mt-2" onClick={onSetup}>
                Set up the office
              </button>
            </Empty>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ communication
function CommsPanel({ className, onTask }: { className: string; onTask: (id: string) => void }) {
  const approvals = useApprovals('pending');
  const waiting = useTasks({ status: 'waiting' });
  const questions = (waiting.data ?? []).filter((t) => t.waitingReason?.includes('manager answer'));
  const needs = (approvals.data?.length ?? 0) + questions.length;
  const [tab, setTab] = useState<'assistant' | 'team' | 'needs'>('assistant');
  useEffect(() => {
    if (needs > 0) setTab('needs');
  }, [needs]);

  return (
    <Panel
      className={className}
      icon={<MessagesSquare className="h-4 w-4" />}
      title="Communication"
      actions={
        <Link to="/communication" className="btn-ghost btn-sm" title="Open full view">
          <Maximize2 className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <Segments
        value={tab}
        onChange={setTab}
        items={[
          { id: 'assistant', label: 'Assistant' },
          { id: 'team', label: 'Team chat' },
          {
            id: 'needs',
            label: (
              <span className="inline-flex items-center gap-1">
                Needs you {needs > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">{needs}</span>}
              </span>
            ),
          },
        ]}
      />
      {tab === 'assistant' && <AssistantChat onTask={onTask} />}
      {tab === 'team' && <TeamChat onTask={onTask} />}
      {tab === 'needs' && <NeedsYou approvals={approvals.data ?? []} questions={questions} onTask={onTask} />}
    </Panel>
  );
}

function AssistantChat({ onTask }: { onTask: (id: string) => void }) {
  const msgs = useMessages('global', '&limit=100');
  const box = useRef<HTMLDivElement>(null);
  // Scroll only the chat box (scrollIntoView would also scroll the page on small screens).
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [msgs.data?.length]);
  return (
    <>
      <div ref={box} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {!msgs.data?.length && (
          <div className="p-4 text-center text-sm text-slate-500">Ask your assistant anything: “How is the report going?”, “What did the team finish today?” It can also start new work for you.</div>
        )}
        {(msgs.data ?? []).map((m) => (
          <Bubble key={m.id} m={m} onTask={onTask} />
        ))}
      </div>
      <div className="shrink-0 border-t border-white/5 p-2">
        <CommandCenter mode="chat" compact placeholder="Message your assistant…" />
      </div>
    </>
  );
}

function TeamChat({ onTask }: { onTask: (id: string) => void }) {
  const msgs = useMessages('agents', '&limit=100');
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
      {!msgs.data?.length && <div className="p-4 text-center text-sm text-slate-500">When employees ask each other for help or share results, it shows up here.</div>}
      {(msgs.data ?? []).map((m) => (
        <div key={m.id} className="rounded-lg border border-white/5 bg-ink-850/60 px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
            <span className="font-medium text-slate-300">{m.fromName}</span>
            <ArrowRight className="h-3 w-3" />
            <span className="text-slate-300">{m.toName ?? (m.toType === 'broadcast' ? 'everyone' : '—')}</span>
            {m.kind !== 'message' && <Badge className={KIND_STYLE[m.kind] ?? KIND_STYLE.message}>{m.kind}</Badge>}
            <span>{timeAgo(m.createdAt)}</span>
            {m.taskId && (
              <button className="text-accent-400 hover:underline" onClick={() => onTask(m.taskId!)}>
                task →
              </button>
            )}
          </div>
          <Markdown text={m.content} ctx={{ taskId: m.taskId, missionId: m.missionId }} className="mt-0.5 max-h-60 overflow-y-auto text-xs text-slate-300" />
        </div>
      ))}
    </div>
  );
}

function NeedsYou({ approvals, questions, onTask }: { approvals: any[]; questions: Task[]; onTask: (id: string) => void }) {
  const decide = useAction(({ id, decision }: { id: string; decision: string }) => post(`/approvals/${id}/decide`, { decision }), { success: 'Decision recorded' });
  if (!approvals.length && !questions.length) return <div className="p-6 text-center text-sm text-slate-500">Nothing needs you right now. 👍</div>;
  return (
    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
      {approvals.map((a) => (
        <div key={a.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-sm">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-300">Asks for permission</div>
          <div className="text-slate-200">{a.description || a.actionType}</div>
          <div className="mt-2 flex gap-2">
            <button className="btn-primary btn-sm" onClick={() => decide.mutate({ id: a.id, decision: 'approved' })}>
              Allow
            </button>
            <button className="btn-danger btn-sm" onClick={() => decide.mutate({ id: a.id, decision: 'rejected' })}>
              Deny
            </button>
            {a.taskId && (
              <button className="btn-ghost btn-sm" onClick={() => onTask(a.taskId)}>
                Details
              </button>
            )}
          </div>
        </div>
      ))}
      {questions.map((t) => (
        <QuestionCard key={t.id} task={t} onTask={onTask} />
      ))}
    </div>
  );
}

/** Shows the agent's actual question and lets the manager answer in place. */
function QuestionCard({ task: t, onTask }: { task: Task; onTask: (id: string) => void }) {
  const msgs = useMessages('global', '&limit=100');
  const q = [...(msgs.data ?? [])].reverse().find((m) => m.kind === 'question' && m.taskId === t.id);
  // Server format: `Question about "<task>": <question>` – show just the question.
  const question = q ? q.content.replace(/^Question about ".*?":\s*/s, '') : t.title;
  return (
    <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-2.5 text-sm">
      <div className="text-xs font-medium text-orange-300">{`${t.agentName ?? 'An employee'} has a question`}</div>
      <Markdown text={question} ctx={{ taskId: t.id, projectId: t.projectId }} className="mt-1 text-slate-100" />
      <button className="mt-1 text-[11px] text-slate-500 hover:text-slate-300" onClick={() => onTask(t.id)}>
        {t.title} →
      </button>
      <div className="mt-2">
        <AnswerBox taskId={t.id} projectId={t.projectId} compact />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tasks
const ACTIVE = ['pending', 'planning', 'assigned', 'running', 'reviewing', 'waiting'];
const STATUS_LABEL: Record<string, [string, string]> = {
  pending: ['Queued', 'bg-slate-500'],
  planning: ['Planning', 'bg-sky-400'],
  assigned: ['Assigned', 'bg-sky-500'],
  running: ['Working', 'bg-accent-500'],
  reviewing: ['Reviewing', 'bg-violet-400'],
  waiting: ['Waiting', 'bg-orange-400'],
  completed: ['Done', 'bg-emerald-500'],
  failed: ['Failed', 'bg-rose-500'],
  cancelled: ['Cancelled', 'bg-zinc-500'],
};

function TasksPanel({ className, onTask }: { className: string; onTask: (id: string) => void }) {
  const tasks = useTasks({ limit: '300' });
  const missions = useMissions();
  const [tab, setTab] = useState<'requests' | 'active' | 'done' | 'failed'>('requests');
  const all = tasks.data ?? [];
  const [now, setNow] = useState(Date.now());
  const anyRunning = all.some((t) => t.status === 'running' || t.status === 'reviewing');
  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [anyRunning]);
  const groups = {
    active: all.filter((t) => ACTIVE.includes(t.status)),
    done: all.filter((t) => t.status === 'completed'),
    failed: all.filter((t) => t.status === 'failed' || t.status === 'cancelled'),
  };
  return (
    <Panel
      className={className}
      icon={<ListChecks className="h-4 w-4" />}
      title="Tasks"
      actions={
        <Link to="/tasks" className="btn-ghost btn-sm" title="Kanban, timeline, Gantt">
          <Maximize2 className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <Segments
        value={tab}
        onChange={setTab}
        items={[
          { id: 'requests', label: `Requests (${missions.data?.length ?? 0})` },
          { id: 'active', label: `In progress (${groups.active.length})` },
          { id: 'done', label: `Done (${groups.done.length})` },
          { id: 'failed', label: `Failed (${groups.failed.length})` },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {tab === 'requests' ? (
          <MissionList missions={missions.data ?? []} onOpenTask={onTask} />
        ) : !groups[tab].length ? (
          <div className="p-6 text-center text-sm text-slate-500">Nothing here yet.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {groups[tab].map((t) => {
              const [label, dot] = STATUS_LABEL[t.status] ?? [t.status, 'bg-slate-500'];
              return (
                <li key={t.id}>
                  <button className="flex w-full items-center gap-2 py-2 text-left hover:bg-white/[.02]" onClick={() => onTask(t.id)}>
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', dot, (t.status === 'running' || t.status === 'reviewing') && 'animate-pulseDot')} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-200">{t.title}</span>
                      <span className="block truncate text-[11px] text-slate-500">
                        <span>{label}</span>
                        {t.status === 'running' || t.status === 'reviewing' ? (
                          // Live elapsed time: CLI agents stream nothing, so this is the visible sign they are still working.
                          <span className="text-accent-400"> · {formatDuration(Math.max(0, now - new Date(t.updatedAt).getTime()))}</span>
                        ) : null}
                        {t.agentName ? ` · ${t.agentName}` : ''}
                        {t.waitingReason ? ` · ${t.waitingReason}` : ''}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-slate-600">{timeAgo(t.updatedAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ usage
function UsagePanel({ className }: { className: string }) {
  const o = useOverview().data;
  const alerts = useAlerts();
  const cards = useQuery({ queryKey: ['usage-overview'], queryFn: () => get<any[]>('/usage/overview') });
  const providers = useProviders();
  const cooldownOf = (id: string) => providers.data?.find((p) => p.id === id)?.cooldownUntil ?? null;
  return (
    <Panel
      className={className}
      icon={<Gauge className="h-4 w-4" />}
      title="Usage"
      actions={
        <Link to="/usage" className="btn-ghost btn-sm" title="Details & quotas">
          <Maximize2 className="h-3.5 w-3.5" />
        </Link>
      }
    >
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Mini label="Tokens today" value={fmtNum(o?.usage.today.tokens)} />
          <Mini label="Requests today" value={fmtNum(o?.usage.today.requests)} />
          <Mini label="Cost 30 days" value={fmtUsd(o?.usage.last30d.cost)} />
        </div>
        {(alerts.data ?? []).slice(0, 3).map((a) => (
          <div key={a.id} className={cx('rounded-md border px-2 py-1.5 text-xs', a.level === 'critical' ? 'border-rose-500/30 text-rose-200' : 'border-amber-500/30 text-amber-200')}>
            {a.message}
          </div>
        ))}
        {!cards.data?.length && <div className="text-center text-xs text-slate-500">No AI connected yet.</div>}
        {(cards.data ?? []).map((c) => {
          const today = c.measured?.today ?? {};
          const tokens = (today.inputTokens ?? 0) + (today.outputTokens ?? 0);
          return (
            <div key={c.provider.id} className="rounded-lg border border-white/5 bg-ink-850/60 p-2.5">
              <div className="flex items-center gap-2">
                <span className={cx('h-2 w-2 rounded-full', c.provider.status === 'connected' ? 'bg-emerald-400' : c.provider.status === 'error' ? 'bg-rose-400' : 'bg-slate-500')} />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-200">{c.provider.name}</span>
                <span className="text-[11px] text-slate-500">{fmtNum(tokens)} tok today</span>
              </div>
              {(c.quotas as QuotaEntry[]).slice(0, 2).map((q) => (
                <div key={q.id} className="mt-2">
                  <div className="mb-0.5 flex justify-between text-[11px] text-slate-500">
                    <span className="truncate">{q.label}</span>
                    <span>{q.percentUsed != null ? `${Math.round(q.percentUsed)}%` : '?'}</span>
                  </div>
                  <ProgressBar value={q.percentUsed ?? 0} tone={(q.percentUsed ?? 0) >= 90 ? 'bad' : (q.percentUsed ?? 0) >= 70 ? 'warn' : 'good'} />
                </div>
              ))}
              {c.provider.status === 'error' && c.provider.statusMessage && !cooldownOf(c.provider.id) && (
                <div className="mt-1 line-clamp-2 text-[11px] text-rose-300">{c.provider.statusMessage}</div>
              )}
              <QuotaRecovery provider={{ ...c.provider, cooldownUntil: cooldownOf(c.provider.id) }} />
            </div>
          );
        })}
        <div className="text-[11px] text-slate-600">Only real, measured numbers. Subscription limits can be entered on the Usage page.</div>
      </div>
    </Panel>
  );
}

function Mini({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-ink-850/60 px-1 py-2">
      <div className="text-base font-semibold text-white">{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}
