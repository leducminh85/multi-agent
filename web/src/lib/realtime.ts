import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getToken } from './api';

export interface BusEvent {
  type: string;
  payload: any;
  ts: string;
}

type Listener = (e: BusEvent) => void;
const listeners = new Set<Listener>();
let socket: WebSocket | null = null;
let status: 'connecting' | 'open' | 'closed' = 'closed';
const statusListeners = new Set<() => void>();

function setStatus(s: typeof status) {
  status = s;
  statusListeners.forEach((l) => l());
}

export function onEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Map server events → React Query keys to refresh (batched). */
const INVALIDATE: Record<string, string[][]> = {
  'agent.updated': [['agents'], ['agent'], ['overview']],
  'agent.deleted': [['agents'], ['overview']],
  'task.updated': [['tasks'], ['task'], ['mission'], ['missions'], ['overview'], ['agent']],
  'task.step': [['task']],
  'mission.updated': [['missions'], ['mission'], ['overview']],
  'message.created': [['messages']],
  'activity.created': [['activity']],
  'usage.recorded': [['usage'], ['usage-overview'], ['overview'], ['agents']],
  'alert.updated': [['alerts'], ['overview'], ['usage-overview']],
  'provider.updated': [['providers'], ['usage-overview'], ['overview'], ['quotas']],
  'file.updated': [['files'], ['project']],
  'knowledge.updated': [['knowledge'], ['project'], ['agent']],
  'approval.updated': [['approvals'], ['overview'], ['task']],
  'project.updated': [['projects'], ['project']],
  'system.updated': [['settings'], ['system'], ['overview'], ['roles']],
};

export function connectRealtime(qc: QueryClient): () => void {
  let closed = false;
  let retry = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = new Map<string, string[]>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    flushTimer = undefined;
    for (const key of pending.values()) void qc.invalidateQueries({ queryKey: key });
    pending.clear();
  };

  const open = () => {
    const token = getToken();
    if (!token || closed) return;
    setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws?token=${encodeURIComponent(token)}`);
    socket = ws;
    ws.onopen = () => {
      retry = 0;
      setStatus('open');
      // Resync everything after a (re)connect – we may have missed events.
      void qc.invalidateQueries();
    };
    ws.onmessage = (msg) => {
      let e: BusEvent;
      try {
        e = JSON.parse(msg.data);
      } catch {
        return;
      }
      listeners.forEach((l) => l(e));
      for (const key of INVALIDATE[e.type] ?? []) pending.set(key.join('|'), key);
      if (pending.size && !flushTimer) flushTimer = setTimeout(flush, 250);
    };
    ws.onclose = (ev) => {
      setStatus('closed');
      socket = null;
      if (closed || ev.code === 4401) return;
      retry = Math.min(retry + 1, 6);
      timer = setTimeout(open, 500 * 2 ** retry);
    };
  };
  open();
  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    socket?.close();
  };
}

export function useRealtimeStatus() {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    () => status,
  );
}

/** Live streamed output for a running task (from task.stream events). */
export function useTaskStream(taskId: string | null | undefined): string {
  const [text, setText] = useState('');
  useEffect(() => {
    setText('');
    if (!taskId) return;
    return onEvent((e) => {
      if (e.type === 'task.stream' && e.payload.taskId === taskId) setText((t) => (t + e.payload.delta).slice(-20000));
    });
  }, [taskId]);
  return text;
}
