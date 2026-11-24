import { LayoutDashboard } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ActivityFeed from '../components/ActivityFeed';
import AgentDrawer from '../components/AgentDrawer';
import TaskDrawer from '../components/TaskDrawer';
import { ActivityBadge, Card, Empty, PageHeader } from '../components/ui';
import { useAgents, useOverview, useRoles } from '../lib/hooks';
import { onEvent } from '../lib/realtime';
import { OfficeEngine, type OfficeAgent } from '../office/engine';

const LEGEND: [string, string][] = [
  ['idle', 'z / coffee break'],
  ['thinking', '… waiting for the model'],
  ['reading', 'preparing context / reviewing'],
  ['writing', 'streaming text'],
  ['coding', 'streaming code (screen scrolls)'],
  ['discussing', 'messaging – meets in the meeting room'],
  ['waiting', 'needs help / your answer / approval'],
  ['error', 'last attempt failed'],
  ['completed', 'just finished a task'],
];

export default function OfficePage() {
  const agents = useAgents();
  const roles = useRoles();
  const overview = useOverview();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<OfficeEngine | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);

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
    const engine = new OfficeEngine(canvasRef.current, { onSelect: (id) => id && setSelected(id) });
    engineRef.current = engine;
    // Real agent-to-agent messages draw a collaboration link between the two characters.
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
    engineRef.current?.setSelected(selected);
  }, [selected]);
  useEffect(() => {
    engineRef.current?.setRunningTasks((overview.data?.tasks?.running ?? 0) + (overview.data?.tasks?.reviewing ?? 0));
  }, [overview.data]);

  return (
    <>
      <PageHeader
        title="Virtual Office"
        subtitle="Your agents at work. Characters move and animate from their real runtime state – click one to inspect, pause, stop or assign work."
        actions={
          <Link to="/" className="btn-outline">
            <LayoutDashboard className="h-4 w-4" /> Management dashboard
          </Link>
        }
      />
      <div className="grid gap-5 2xl:grid-cols-[1fr_340px]">
        <div className="card relative overflow-hidden p-2">
          <div className="w-full">
            <canvas ref={canvasRef} className="pixelated block" />
          </div>
          {!agents.isLoading && !officeAgents.length && (
            <div className="absolute inset-0 flex items-center justify-center bg-ink-950/70">
              <Empty title="The office is empty">
                Hire agents on the <Link className="text-accent-400 underline" to="/agents">Agents</Link> page – they will take their desks in their department.
              </Empty>
            </div>
          )}
        </div>
        <div className="space-y-5">
          <Card title="Team">
            <ul className="space-y-1.5">
              {(agents.data ?? []).map((a) => (
                <li key={a.id}>
                  <button className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-white/5" onClick={() => setSelected(a.id)}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.appearance?.color }} />
                    <span className="min-w-0 flex-1 truncate text-slate-200">{a.name}</span>
                    <ActivityBadge activity={a.paused ? 'idle' : a.activity} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Legend">
            <ul className="space-y-1 text-xs text-slate-400">
              {LEGEND.map(([k, v]) => (
                <li key={k} className="flex items-center gap-2">
                  <ActivityBadge activity={k} /> {v}
                </li>
              ))}
              <li className="pt-1">Server-room LEDs blink with the real number of running tasks. Dashed gold lines = live agent-to-agent messages.</li>
            </ul>
          </Card>
          <Card title="Live activity" pad={false}>
            <div className="max-h-72 overflow-y-auto p-2">
              <ActivityFeed params="?limit=30" onTask={setTaskId} />
            </div>
          </Card>
        </div>
      </div>
      <AgentDrawer agentId={selected} onClose={() => setSelected(null)} onOpenTask={setTaskId} />
      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} onOpenTask={setTaskId} />
    </>
  );
}
