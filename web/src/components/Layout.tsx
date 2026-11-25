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
  Menu,
  MessagesSquare,
  OctagonX,
  Play,
  Settings,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { post } from '../lib/api';
import { useAlerts, useApprovals, useOverview } from '../lib/hooks';
import { timeAgo } from '../lib/format';
import { useRealtimeStatus } from '../lib/realtime';
import { cx, useConfirm, useToast } from './ui';
import LangToggle from './LangToggle';

/** The dashboard is the whole app for day-to-day use; everything else sits in the "More" menu. */
const MORE = [
  { to: '/agents', label: 'Employees (agents)', icon: Bot },
  { to: '/tasks', label: 'Tasks: Kanban, timeline, Gantt', icon: ListChecks },
  { to: '/usage', label: 'Usage & quotas', icon: Gauge },
  { to: '/communication', label: 'All conversations', icon: MessagesSquare },
  { to: '/office', label: 'Virtual office (full screen)', icon: Building2 },
  { to: '/projects', label: 'Projects & knowledge', icon: FolderKanban },
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
  const location = useLocation();
  const [showAlerts, setShowAlerts] = useState(false);
  const [showMore, setShowMore] = useState(false);
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
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-white/5 bg-ink-900/60 px-3 backdrop-blur sm:gap-3 md:px-4">
          <NavLink to="/" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-accent-500 to-fuchsia-500 text-white shadow-glow">
              <Building2 className="h-4 w-4" />
            </div>
            <span className="hidden text-sm font-semibold text-white sm:inline">AI Office</span>
          </NavLink>
          {location.pathname !== '/' && (
            <NavLink to="/" className="btn-ghost btn-sm">
              <LayoutDashboard className="h-4 w-4" /> Dashboard
            </NavLink>
          )}
          <div className="relative">
            <button className="btn-ghost btn-sm" onClick={() => setShowMore((v) => !v)}>
              <Menu className="h-4 w-4" /> More
            </button>
            {showMore && <div className="fixed inset-0 z-20" onClick={() => setShowMore(false)} />}
            {showMore && (
              <div className="card absolute left-0 top-10 z-30 max-h-[80vh] w-64 overflow-y-auto bg-ink-900 p-1.5 shadow-2xl">
                {MORE.map((n) => (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    onClick={() => setShowMore(false)}
                    className={({ isActive }) => cx('flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm', isActive ? 'bg-accent-600/15 text-white' : 'text-slate-300 hover:bg-white/5')}
                  >
                    <n.icon className="h-4 w-4 text-slate-400" />
                    {n.label}
                  </NavLink>
                ))}
                <div className="my-1 border-t border-white/5" />
                <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/5" onClick={onLogout}>
                  <LogOut className="h-4 w-4" /> Sign out ({user.username})
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            {rt === 'open' ? <Wifi className="h-3.5 w-3.5 text-emerald-400" /> : <WifiOff className="h-3.5 w-3.5 text-rose-400" />}
            <span className="hidden sm:inline">{rt === 'open' ? 'Live' : rt === 'connecting' ? 'Connecting…' : 'Offline'}</span>
            {overview.data && (
              <span className="hidden text-slate-500 lg:inline">
                {`· ${overview.data.agents.active}/${overview.data.agents.total} agents working · ${overview.data.tasks.running ?? 0} running tasks`}
              </span>
            )}
          </div>
          <div className="flex-1" />
          <LangToggle />
          {stopped && <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-300">QUEUE PAUSED</span>}
          <div className="relative">
            <button className="btn-ghost relative" onClick={() => setShowAlerts((v) => !v)} title="Alerts & approvals">
              <Bell className="h-4 w-4" />
              {attention > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{attention}</span>}
            </button>
            {showAlerts && <div className="fixed inset-0 z-20" onClick={() => setShowAlerts(false)} />}
            {showAlerts && (
              <div className="card fixed inset-x-3 top-14 z-30 max-h-[70vh] overflow-y-auto bg-ink-900 p-2 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-96">
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
        <main className="min-h-0 flex-1 overflow-y-auto p-3 md:p-4">{children}</main>
      </div>
    </div>
  );
}
