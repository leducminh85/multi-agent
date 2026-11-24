import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { useActivity } from '../lib/hooks';
import { timeAgo } from '../lib/format';
import { Empty, Spinner, cx } from './ui';

const ICON = {
  info: <Info className="h-3.5 w-3.5 text-sky-400" />,
  success: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  warning: <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />,
  error: <XCircle className="h-3.5 w-3.5 text-rose-400" />,
};

export default function ActivityFeed({ params = '?limit=60', className, onTask }: { params?: string; className?: string; onTask?: (taskId: string) => void }) {
  const q = useActivity(params);
  if (q.isLoading) return <Spinner />;
  if (!q.data?.length) return <Empty title="No activity yet">Activity from agents, tasks and providers appears here in real time.</Empty>;
  return (
    <ol className={cx('space-y-0.5', className)}>
      {q.data.map((a) => (
        <li
          key={a.id}
          className={cx('flex items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/[.03]', a.taskId && onTask && 'cursor-pointer')}
          onClick={() => a.taskId && onTask?.(a.taskId)}
        >
          <span className="mt-0.5">{ICON[a.level]}</span>
          <span className="min-w-0 flex-1 text-slate-300">{a.message}</span>
          <span className="shrink-0 text-[11px] text-slate-500" title={new Date(a.createdAt).toLocaleString()}>
            {timeAgo(a.createdAt)}
          </span>
        </li>
      ))}
    </ol>
  );
}
