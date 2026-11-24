export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.round(diff / 1000);
  if (s < 0) return `in ${formatDuration(-diff)}`;
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString();
}

export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const ACTIVITY_LABEL: Record<string, string> = {
  idle: 'Idle',
  working: 'Working',
  thinking: 'Thinking',
  reading: 'Reading',
  writing: 'Writing',
  coding: 'Coding',
  discussing: 'Discussing',
  waiting: 'Waiting',
  error: 'Error',
  completed: 'Completed',
};

export const ACTIVITY_COLOR: Record<string, string> = {
  idle: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
  working: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
  thinking: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
  reading: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
  writing: 'text-pink-300 bg-pink-500/10 border-pink-500/20',
  coding: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  discussing: 'text-amber-300 bg-amber-500/10 border-amber-500/20',
  waiting: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
  error: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
  completed: 'text-lime-300 bg-lime-500/10 border-lime-500/20',
};

export const STATUS_COLOR: Record<string, string> = {
  pending: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
  planning: 'text-violet-300 bg-violet-500/10 border-violet-500/20',
  assigned: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/20',
  running: 'text-sky-300 bg-sky-500/10 border-sky-500/20',
  waiting: 'text-orange-300 bg-orange-500/10 border-orange-500/20',
  reviewing: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/20',
  completed: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  failed: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
  cancelled: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
  connected: 'text-emerald-300 bg-emerald-500/10 border-emerald-500/20',
  error: 'text-rose-300 bg-rose-500/10 border-rose-500/20',
  unknown: 'text-slate-300 bg-slate-500/10 border-slate-500/20',
  disabled: 'text-zinc-400 bg-zinc-500/10 border-zinc-500/20',
};

export const TASK_STATUSES = ['pending', 'planning', 'assigned', 'running', 'waiting', 'reviewing', 'completed', 'failed', 'cancelled'] as const;
