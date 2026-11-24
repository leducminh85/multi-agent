import { Activity, Bot, CheckCircle2, Coins, Loader, Pause, Rocket, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import ActivityFeed from '../components/ActivityFeed';
import CommandCenter from '../components/CommandCenter';
import MissionList from '../components/MissionList';
import TaskDrawer from '../components/TaskDrawer';
import { Card, PageHeader, Stat, StatusBadge } from '../components/ui';
import { useOverview } from '../lib/hooks';
import { fmtNum, fmtUsd } from '../lib/format';

export default function OverviewPage() {
  const o = useOverview().data;
  const [taskId, setTaskId] = useState<string | null>(null);
  const noAgents = o && o.agents.total === 0;
  const noProviders = o && o.providers.length === 0;

  return (
    <>
      <PageHeader title="Overview" subtitle="Your AI office at a glance – everything below is live data." />

      {(noProviders || noAgents) && (
        <div className="card mb-5 border-accent-500/30 p-4 shadow-glow">
          <div className="flex items-start gap-3">
            <Rocket className="mt-0.5 h-5 w-5 text-accent-400" />
            <div className="text-sm text-slate-300">
              <div className="font-semibold text-white">Set up your office</div>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                <li className={noProviders ? '' : 'text-slate-500 line-through'}>
                  Connect at least one AI provider in <Link className="text-accent-400 hover:underline" to="/settings">Settings → Providers</Link> (API key, CLI or local Ollama).
                </li>
                <li className={noAgents ? '' : 'text-slate-500 line-through'}>
                  Hire agents in <Link className="text-accent-400 hover:underline" to="/agents">Agents</Link> – or create a default team in one click.
                </li>
                <li>Describe what you need in the Command Center below.</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      <div className="mb-5">
        <CommandCenter />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Agents" value={o?.agents.total ?? '—'} icon={<Bot className="h-4 w-4" />} />
        <Stat label="Active" value={o?.agents.active ?? '—'} tone="good" icon={<Activity className="h-4 w-4" />} />
        <Stat label="Idle" value={o?.agents.idle ?? '—'} icon={<Pause className="h-4 w-4" />} hint={o?.agents.paused ? `${o.agents.paused} paused` : undefined} />
        <Stat label="Running" value={(o?.tasks.running ?? 0) + (o?.tasks.reviewing ?? 0)} icon={<Loader className="h-4 w-4" />} hint={`${o?.tasks.pending ?? 0} queued · ${o?.tasks.waiting ?? 0} waiting`} />
        <Stat label="Completed" value={o?.tasks.completed ?? 0} tone="good" icon={<CheckCircle2 className="h-4 w-4" />} />
        <Stat label="Failed" value={o?.tasks.failed ?? 0} tone={o?.tasks.failed ? 'bad' : 'default'} icon={<XCircle className="h-4 w-4" />} />
        <Stat label="Tokens today" value={fmtNum(o?.usage.today.tokens)} icon={<Coins className="h-4 w-4" />} hint={`${o?.usage.today.requests ?? 0} requests`} />
        <Stat label="Cost (30d)" value={fmtUsd(o?.usage.last30d.cost)} hint="reported + estimated" icon={<Coins className="h-4 w-4" />} />
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Missions" className="xl:col-span-2" actions={<Link to="/tasks" className="btn-ghost btn-sm">All tasks →</Link>}>
          <MissionList missions={o?.missions ?? []} onOpenTask={setTaskId} />
        </Card>
        <div className="space-y-5">
          <Card title="Provider status" actions={<Link to="/usage" className="btn-ghost btn-sm">Usage →</Link>}>
            {!o?.providers.length && <div className="text-sm text-slate-500">No providers configured.</div>}
            <ul className="space-y-2">
              {(o?.providers ?? []).map((p: any) => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-slate-200">{p.name}</span>
                    <span className="block truncate text-xs text-slate-500">{p.statusMessage ?? p.type}</span>
                  </span>
                  <StatusBadge status={p.enabled ? p.status : 'disabled'} />
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Activity feed" pad={false}>
            <div className="max-h-[480px] overflow-y-auto p-2">
              <ActivityFeed onTask={setTaskId} />
            </div>
          </Card>
        </div>
      </div>
      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} onOpenTask={setTaskId} />
    </>
  );
}
