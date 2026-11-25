import { ArrowRight, Bot, MessageSquareText, ShieldQuestion, User } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import CommandCenter from '../components/CommandCenter';
import TaskDrawer from '../components/TaskDrawer';
import { Badge, Card, Empty, PageHeader, Tabs, cx } from '../components/ui';
import { downloadUrl, post } from '../lib/api';
import { useAction, useAgents, useApprovals, useMessages, useTasks } from '../lib/hooks';
import { timeAgo } from '../lib/format';
import type { Message } from '../lib/types';

export const KIND_STYLE: Record<string, string> = {
  result: 'border-emerald-500/30 text-emerald-300',
  help_request: 'border-violet-500/30 text-violet-300',
  error: 'border-rose-500/30 text-rose-300',
  question: 'border-orange-500/30 text-orange-300',
  report: 'border-sky-500/30 text-sky-300',
  proposal: 'border-amber-500/30 text-amber-300',
  message: 'border-slate-500/30 text-slate-400',
};

export default function CommunicationPage() {
  const [tab, setTab] = useState<'global' | 'agents'>('global');
  const [taskId, setTaskId] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Communication Center"
        subtitle="Talk to your CEO Assistant, answer agent questions, approve sensitive actions and observe every agent-to-agent message."
        actions={
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'global', label: 'Global chat' },
              { id: 'agents', label: 'Agent channel' },
            ]}
          />
        }
      />
      {tab === 'global' ? <GlobalChat onTask={setTaskId} /> : <AgentChannel onTask={setTaskId} />}
      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} onOpenTask={setTaskId} />
    </>
  );
}

export function Bubble({ m, onTask }: { m: Message; onTask: (id: string) => void }) {
  const mine = m.fromType === 'user';
  return (
    <div className={cx('flex gap-2', mine && 'flex-row-reverse')}>
      <div className={cx('mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full', mine ? 'bg-accent-600/30 text-accent-400' : m.fromType === 'system' ? 'bg-zinc-700 text-zinc-300' : 'bg-emerald-600/20 text-emerald-300')}>
        {mine ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className={cx('max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm', mine ? 'rounded-tr-sm bg-accent-600/20 text-slate-100' : 'rounded-tl-sm bg-ink-850 text-slate-200')}>
        <div className="mb-0.5 flex items-center gap-2 text-[11px] text-slate-500">
          <span className="font-medium text-slate-400">{m.fromName ?? m.fromType}</span>
          {m.kind !== 'message' && <Badge className={KIND_STYLE[m.kind] ?? KIND_STYLE.message}>{m.kind}</Badge>}
          <span>{timeAgo(m.createdAt)}</span>
        </div>
        <div translate="no" className="whitespace-pre-wrap break-words">{m.content}</div>
        {m.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {m.attachments.map((a) => (
              <a key={a.fileId} href={downloadUrl(`/files/${a.fileId}/download`)} target="_blank" rel="noreferrer" className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-400 hover:text-white">
                📎 {a.name}
              </a>
            ))}
          </div>
        )}
        {m.taskId && (
          <button className="mt-1 text-[11px] text-accent-400 hover:underline" onClick={() => onTask(m.taskId!)}>
            open task →
          </button>
        )}
      </div>
    </div>
  );
}

function GlobalChat({ onTask }: { onTask: (id: string) => void }) {
  const msgs = useMessages('global', '&limit=300');
  const approvals = useApprovals('pending');
  const waiting = useTasks({ status: 'waiting' });
  const end = useRef<HTMLDivElement>(null);
  const decide = useAction(({ id, decision }: { id: string; decision: string }) => post(`/approvals/${id}/decide`, { decision }), { success: 'Decision recorded' });
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.data?.length]);
  const questions = (waiting.data ?? []).filter((t) => t.waitingReason?.includes('manager answer'));

  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card className="flex flex-col xl:col-span-2" pad={false}>
        <div className="h-[58vh] space-y-3 overflow-y-auto p-4">
          {!msgs.data?.length && (
            <Empty icon={<MessageSquareText className="h-8 w-8" />} title="Say hello to your CEO Assistant">
              Ask about progress, or describe work – the CEO Assistant can launch missions for the team. Requires an agent with the CEO Assistant role.
            </Empty>
          )}
          {(msgs.data ?? []).map((m) => (
            <Bubble key={m.id} m={m} onTask={onTask} />
          ))}
          <div ref={end} />
        </div>
        <div className="border-t border-white/5 p-3">
          <CommandCenter mode="chat" compact placeholder="Message your CEO Assistant…" />
        </div>
      </Card>
      <div className="space-y-5">
        <Card title={<span className="flex items-center gap-2"><ShieldQuestion className="h-4 w-4 text-amber-300" /> Pending approvals</span>}>
          {!approvals.data?.length && <div className="text-sm text-slate-500">No approvals pending.</div>}
          <ul className="space-y-3">
            {(approvals.data ?? []).map((a) => (
              <li key={a.id} className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm">
                <div className="font-medium text-amber-200">{a.actionType}</div>
                <div className="text-slate-400">{a.description}</div>
                <div className="mt-2 flex gap-2">
                  <button className="btn-primary btn-sm" onClick={() => decide.mutate({ id: a.id, decision: 'approved' })}>
                    Approve
                  </button>
                  <button className="btn-danger btn-sm" onClick={() => decide.mutate({ id: a.id, decision: 'rejected' })}>
                    Reject
                  </button>
                  {a.taskId && (
                    <button className="btn-ghost btn-sm" onClick={() => onTask(a.taskId!)}>
                      Task
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Questions waiting for you">
          {!questions.length && <div className="text-sm text-slate-500">No agent is waiting for an answer.</div>}
          <ul className="space-y-2">
            {questions.map((t) => (
              <li key={t.id}>
                <button className="w-full rounded-lg bg-ink-850 px-3 py-2 text-left text-sm hover:bg-ink-800" onClick={() => onTask(t.id)}>
                  <div className="text-slate-200">{t.title}</div>
                  <div className="text-xs text-slate-500">
                    {t.agentName} · {timeAgo(t.updatedAt)} · answer →
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

function AgentChannel({ onTask }: { onTask: (id: string) => void }) {
  const agents = useAgents();
  const [agentId, setAgentId] = useState('');
  const [kind, setKind] = useState('');
  const msgs = useMessages('agents', `&limit=500${agentId ? `&agentId=${agentId}` : ''}`);
  const list = (msgs.data ?? []).filter((m) => !kind || m.kind === kind).reverse();
  return (
    <Card
      title="Agent-to-agent communication"
      actions={
        <>
          <select className="input h-8 w-44 py-0 text-xs" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">All agents</option>
            {(agents.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <select className="input h-8 w-36 py-0 text-xs" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {['message', 'result', 'help_request', 'error', 'proposal', 'document'].map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </>
      }
    >
      {!list.length && <Empty title="No agent messages yet">Agents share results, request help, report errors and message each other while working.</Empty>}
      <ul className="space-y-2">
        {list.map((m) => (
          <li key={m.id} className="rounded-lg border border-white/5 bg-ink-850/60 px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-300">{m.fromName}</span>
              <ArrowRight className="h-3 w-3" />
              <span className="text-slate-300">{m.toName ?? (m.toType === 'broadcast' ? 'everyone' : '—')}</span>
              <Badge className={KIND_STYLE[m.kind] ?? KIND_STYLE.message}>{m.kind}</Badge>
              <span>{timeAgo(m.createdAt)}</span>
              {m.taskId && (
                <button className="text-accent-400 hover:underline" onClick={() => onTask(m.taskId!)}>
                  task →
                </button>
              )}
            </div>
            <div translate="no" className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{m.content}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
