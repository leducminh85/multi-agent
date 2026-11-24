import { BookmarkPlus, CheckCircle2, Circle, CircleDot, Info, RotateCcw, Send, UserCog, XCircle, XOctagon } from 'lucide-react';
import { useState } from 'react';
import { post } from '../lib/api';
import { useAction, useAgents, useTask } from '../lib/hooks';
import { fmtDate, fmtNum, formatDuration, timeAgo } from '../lib/format';
import { useTaskStream } from '../lib/realtime';
import type { TaskStep } from '../lib/types';
import { Badge, Drawer, Output, Spinner, StatusBadge, cx, useConfirm } from './ui';

function StepIcon({ s }: { s: TaskStep }) {
  if (s.status === 'done') return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (s.status === 'failed') return <XCircle className="h-4 w-4 text-rose-400" />;
  if (s.status === 'info') return <Info className="h-4 w-4 text-sky-400" />;
  return <CircleDot className="h-4 w-4 animate-pulse text-accent-400" />;
}

export default function TaskDrawer({ taskId, onClose, onOpenTask }: { taskId: string | null; onClose: () => void; onOpenTask?: (id: string) => void }) {
  const q = useTask(taskId);
  const agents = useAgents();
  const stream = useTaskStream(taskId);
  const confirm = useConfirm();
  const [answer, setAnswer] = useState('');
  const [reassignTo, setReassignTo] = useState('');
  const t = q.data;

  const cancel = useAction(() => post(`/tasks/${taskId}/cancel`), { success: 'Task cancelled' });
  const retry = useAction(() => post(`/tasks/${taskId}/retry`), { success: 'Task re-queued' });
  const reassign = useAction((agentId: string | null) => post(`/tasks/${taskId}/reassign`, { agentId }), { success: 'Task reassigned' });
  const respond = useAction(() => post(`/tasks/${taskId}/respond`, { answer }), { success: 'Answer sent – task resumed' });
  const saveKnowledge = useAction((scope: string) => post(`/tasks/${taskId}/save-knowledge`, { scope }), { success: 'Saved to knowledge base' });
  const decide = useAction(({ id, decision }: { id: string; decision: string }) => post(`/approvals/${id}/decide`, { decision }), { success: 'Decision recorded' });

  const active = t && ['running', 'reviewing'].includes(t.status);
  const terminal = t && ['completed', 'failed', 'cancelled'].includes(t.status);
  const tokens = (t?.usage ?? []).reduce((a: number, u: any) => a + u.input_tokens + u.output_tokens, 0);
  const cost = (t?.usage ?? []).reduce((a: number, u: any) => a + (u.cost_usd ?? 0), 0);

  return (
    <Drawer
      open={!!taskId}
      onClose={onClose}
      title={
        t ? (
          <div className="flex items-center gap-2">
            <span className="truncate">{t.title}</span>
            <StatusBadge status={t.status} />
          </div>
        ) : (
          'Task'
        )
      }
    >
      {!t ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
            <Meta k="Task ID" v={<code className="text-xs">{t.id}</code>} />
            <Meta k="Agent" v={t.agentName ?? (t.roleKey ? `(role: ${t.roleKey})` : '—')} />
            <Meta k="Provider" v={t.providerName ?? '—'} />
            <Meta k="Kind" v={t.kind} />
            <Meta k="Attempts" v={`${t.attempts}/${t.maxAttempts}`} />
            <Meta k="Started" v={fmtDate(t.startedAt)} />
            <Meta k="Finished" v={fmtDate(t.finishedAt)} />
            <Meta k="Duration" v={t.startedAt ? formatDuration(new Date(t.finishedAt ?? Date.now()).getTime() - new Date(t.startedAt).getTime()) : '—'} />
            <Meta k="Usage" v={tokens ? `${fmtNum(tokens)} tokens${cost ? ` · $${cost.toFixed(4)}` : ''}` : '—'} />
          </div>

          {t.waitingReason && <div className="rounded-lg border border-orange-500/20 bg-orange-500/10 px-3 py-2 text-sm text-orange-200">⏳ {t.waitingReason}</div>}

          <div className="flex flex-wrap gap-2">
            {!terminal && (
              <button
                className="btn-outline btn-sm"
                onClick={async () => (await confirm({ title: 'Cancel task?', message: `"${t.title}" will be stopped. Dependent tasks will be cancelled.`, danger: true })) && cancel.mutate()}
              >
                <XOctagon className="h-3.5 w-3.5" /> Cancel
              </button>
            )}
            {(t.status === 'failed' || t.status === 'cancelled') && (
              <button className="btn-outline btn-sm" onClick={() => retry.mutate()}>
                <RotateCcw className="h-3.5 w-3.5" /> Retry
              </button>
            )}
            {!terminal && (
              <span className="inline-flex items-center gap-1">
                <select className="input h-7 w-44 py-0 text-xs" value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                  <option value="">Reassign to…</option>
                  <option value="auto">Automatic selection</option>
                  {(agents.data ?? []).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.roleKey})
                    </option>
                  ))}
                </select>
                <button className="btn-outline btn-sm" disabled={!reassignTo} onClick={() => reassign.mutate(reassignTo === 'auto' ? null : reassignTo)}>
                  <UserCog className="h-3.5 w-3.5" />
                </button>
              </span>
            )}
            {t.output && (
              <button className="btn-outline btn-sm" onClick={() => saveKnowledge.mutate('project')}>
                <BookmarkPlus className="h-3.5 w-3.5" /> Save to project knowledge
              </button>
            )}
          </div>

          {t.status === 'waiting' && t.waitingReason?.includes('manager answer') && (
            <div className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-3">
              <div className="mb-2 text-sm font-medium text-white">The agent asked you a question</div>
              {t.messages
                .filter((m) => m.kind === 'question')
                .slice(-1)
                .map((m) => (
                  <div key={m.id} className="mb-2 text-sm text-slate-300">
                    {m.content}
                  </div>
                ))}
              <div className="flex gap-2">
                <input className="input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer…" onKeyDown={(e) => e.key === 'Enter' && answer && respond.mutate()} />
                <button className="btn-primary" disabled={!answer} onClick={() => respond.mutate()}>
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {t.approvals
            .filter((a) => a.status === 'pending')
            .map((a) => (
              <div key={a.id} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
                <div className="font-medium text-amber-200">Approval requested: {a.actionType}</div>
                <div className="mb-2 text-slate-400">{a.description}</div>
                <div className="flex gap-2">
                  <button className="btn-primary btn-sm" onClick={() => decide.mutate({ id: a.id, decision: 'approved' })}>
                    Approve
                  </button>
                  <button className="btn-danger btn-sm" onClick={() => decide.mutate({ id: a.id, decision: 'rejected' })}>
                    Reject
                  </button>
                </div>
              </div>
            ))}

          <section>
            <h4 className="label">Description</h4>
            <p className="whitespace-pre-wrap text-sm text-slate-300">{t.description || '—'}</p>
          </section>

          {(t.dependencies.length > 0 || t.subtasks.length > 0) && (
            <section className="grid gap-3 sm:grid-cols-2">
              {t.dependencies.length > 0 && (
                <div>
                  <h4 className="label">Depends on</h4>
                  {t.dependencies.map((d) => (
                    <button key={d.id} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-sm hover:bg-white/5" onClick={() => onOpenTask?.(d.id)}>
                      <span className="truncate">{d.title}</span>
                      <StatusBadge status={d.status} />
                    </button>
                  ))}
                </div>
              )}
              {t.subtasks.length > 0 && (
                <div>
                  <h4 className="label">Help requested from other agents</h4>
                  {t.subtasks.map((d) => (
                    <button key={d.id} className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-sm hover:bg-white/5" onClick={() => onOpenTask?.(d.id)}>
                      <span className="truncate">
                        {d.title} <span className="text-slate-500">· {d.agentName ?? d.roleKey}</span>
                      </span>
                      <StatusBadge status={d.status} />
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          <section>
            <h4 className="label">Execution steps (reported by the runtime)</h4>
            {!t.steps?.length ? (
              <div className="text-sm text-slate-500">No steps yet – the task is {t.status}.</div>
            ) : (
              <ol className="relative space-y-2 border-l border-white/10 pl-4">
                {t.steps.map((s) => (
                  <li key={s.id} className="relative">
                    <span className="absolute -left-[25px] top-0.5 rounded-full bg-ink-900">
                      <StepIcon s={s} />
                    </span>
                    <div className="text-sm text-slate-200">{s.label}</div>
                    <div className="text-xs text-slate-500">
                      {timeAgo(s.createdAt)}
                      {s.detail ? ` · ${s.detail}` : ''}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          {active && (
            <section>
              <h4 className="label flex items-center gap-2">
                Live output <Badge className="border-sky-500/20 text-sky-300">streaming</Badge>
              </h4>
              {stream ? <Output text={stream} /> : <div className="text-sm text-slate-500">{t.providerName ? 'Waiting for the provider to stream output (CLI agents report when they finish)…' : '…'}</div>}
            </section>
          )}

          <section>
            <h4 className="label">Output</h4>
            <Output text={t.output} />
          </section>

          {t.errorLog && (
            <section>
              <h4 className="label">Error log</h4>
              <pre className="max-h-48 overflow-auto rounded-lg border border-rose-500/10 bg-rose-500/5 p-3 font-mono text-xs text-rose-200">{t.errorLog}</pre>
            </section>
          )}

          {t.messages.length > 0 && (
            <section>
              <h4 className="label">Messages about this task</h4>
              <ul className="space-y-1.5">
                {t.messages.map((m) => (
                  <li key={m.id} className="rounded-lg bg-ink-850 px-3 py-2 text-sm">
                    <div className="text-xs text-slate-500">
                      {m.fromName ?? m.fromType} → {m.toName ?? m.toType ?? 'all'} · {m.kind} · {timeAgo(m.createdAt)}
                    </div>
                    <div className="whitespace-pre-wrap text-slate-300">{m.content}</div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}

function Meta({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{k}</div>
      <div className={cx('truncate text-slate-200')}>{v}</div>
    </div>
  );
}

export { Circle };
