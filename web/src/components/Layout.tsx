import { useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Bot,
  Building2,
  FolderKanban,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessagesSquare,
  OctagonX,
  Play,
  Settings,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { post } from '../lib/api';
import { useAlerts, useApprovals, useOverview } from '../lib/hooks';
import { timeAgo } from '../lib/format';
import { useRealtimeStatus } from '../lib/realtime';
import { cx, useConfirm, useToast } from './ui';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/office', label: 'Virtual Office', icon: Building2 },
  { to: '/agents', label: 'Agents', icon: Bot },
  { to: '/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/communication', label: 'Communication', icon: MessagesSquare },
  { to: '/usage', label: 'Usage & Quota', icon: Gauge },
  { to: '/projects', label: 'Projects & Knowledge', icon: FolderKanban },
  { to: '/files', label: 'Files', icon: FolderOpen },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout({ user, onLogout, children }: { user: { username: string }; onLogout: () => void; children: ReactNode }) {
  const rt = useRealtimeStatus();
  const overview = useOverview();
  const alerts = useAlerts();
  const approvals = useApprovals();
  const confirm = useConfirm();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [showAlerts, setShowAlerts] = useState(false);
  const stopped = !!overview.data?.emergencyStopped;
  const attention = (alerts.data?.length ?? 0) + (approvals.data?.length ?? 0) + (overview.data?.waitingForManager ?? 0);

  const emergency = async () => {
    if (stopped) {
      await post('/system/resume');
      toast.push({ kind: 'success', text: 'Queue resumed' });
    } else {
      const ok = await confirm({
        title: 'Emergency stop',
        danger: true,
        confirmText: 'Stop everything',
        message: 'All running agent calls will be aborted immediately and the task queue paused. Interrupted tasks return to the queue and resume when you press Resume.',
      });
      if (!ok) return;
      const r = await post<{ interrupted: number }>('/system/emergency-stop', {}, true);
      toast.push({ kind: 'info', text: `Emergency stop: ${r.interrupted} running task(s) interrupted` });
    }
    void qc.invalidateQueries();
  };

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-white/5 bg-ink-900/60 md:flex">
        <div className="flex items-center gap-2.5 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-fuchsia-500 text-white shadow-glow">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">AI Office</div>
            <div className="text-[11px] text-slate-500">Virtual AI Workforce</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 px-2">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                cx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition', isActive ? 'bg-accent-600/15 text-white shadow-[inset_2px_0_0_#818cf8]' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')
              }
            >
              <n.icon className="h-4 w-4" />
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/5 p-3 text-xs text-slate-500">
          <div className="flex items-center justify-between">
            <span className="truncate">👤 {user.username}</span>
            <button className="btn-ghost btn-sm" onClick={onLogout} title="Sign out">
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/5 bg-ink-900/40 px-4 backdrop-blur">
          <select className="input w-auto md:hidden" value={location.pathname} onChange={(e) => navigate(e.target.value)}>
            {NAV.map((n) => (
              <option key={n.to} value={n.to}>
                {n.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {rt === 'open' ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-rose-400" />}
            <span className="hidden sm:inline">{rt === 'open' ? 'Live' : rt === 'connecting' ? 'Connecting…' : 'Offline'}</span>
            {overview.data && (
              <span className="hidden text-slate-500 lg:inline">
                · {overview.data.agents.active}/{overview.data.agents.total} agents working · {overview.data.tasks.running ?? 0} running tasks
              </span>
            )}
          </div>
          <div className="flex-1" />
          {stopped && <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-300">QUEUE PAUSED</span>}
          <div className="relative">
            <button className="btn-ghost relative" onClick={() => setShowAlerts((v) => !v)} title="Alerts & approvals">
              <Bell className="h-4 w-4" />
              {attention > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{attention}</span>}
            </button>
            {showAlerts && (
              <div className="card absolute right-0 top-11 z-30 w-96 p-2 shadow-2xl" onMouseLeave={() => setShowAlerts(false)}>
                <div className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Needs attention</div>
                {!attention && <div className="px-2 py-4 text-sm text-slate-500">Nothing needs your attention.</div>}
                {(approvals.data ?? []).map((a) => (
                  <button key={a.id} className="block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-white/5" onClick={() => (setShowAlerts(false), navigate('/communication'))}>
                    <span className="text-amber-300">Approval:</span> {a.actionType}
                    <div className="text-xs text-slate-500">{timeAgo(a.createdAt)}</div>
                  </button>
                ))}
                {overview.data?.waitingForManager > 0 && (
                  <button className="block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-white/5" onClick={() => (setShowAlerts(false), navigate('/communication'))}>
                    <span className="text-orange-300">{overview.data.waitingForManager} question(s)</span> from agents waiting for your answer
                  </button>
                )}
                {(alerts.data ?? []).map((a) => (
                  <button key={a.id} className="block w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-white/5" onClick={() => (setShowAlerts(false), navigate('/usage'))}>
                    <span className={a.level === 'critical' ? 'text-rose-300' : a.level === 'warning' ? 'text-amber-300' : 'text-sky-300'}>{a.level}:</span> {a.message}
                    <div className="text-xs text-slate-500">{timeAgo(a.createdAt)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className={stopped ? 'btn-primary' : 'btn-danger'} onClick={() => void emergency()} title={stopped ? 'Resume the task queue' : 'Abort all running agents and pause the queue'}>
            {stopped ? <Play className="h-4 w-4" /> : <OctagonX className="h-4 w-4" />}
            <span className="hidden sm:inline">{stopped ? 'Resume' : 'Stop all'}</span>
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
