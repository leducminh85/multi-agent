import { useQuery } from '@tanstack/react-query';
import { BookOpen, Download, Folder, FolderPlus, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import MissionList from '../components/MissionList';
import TaskDrawer from '../components/TaskDrawer';
import { Badge, Card, Empty, Field, Modal, PageHeader, Spinner, Tabs, cx, useConfirm } from '../components/ui';
import { del, downloadUrl, get, patch, post } from '../lib/api';
import { useAction, useAgents, useKnowledge, useProject, useProjects } from '../lib/hooks';
import { fmtBytes, timeAgo } from '../lib/format';
import type { Knowledge } from '../lib/types';

export default function ProjectsPage() {
  const projects = useProjects();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [view, setView] = useState<'projects' | 'knowledge'>('projects');
  useEffect(() => {
    if (!selected && projects.data?.length) setSelected(projects.data[0].id);
  }, [projects.data, selected]);

  return (
    <>
      <PageHeader
        title="Projects & Knowledge"
        subtitle="Each project has its own missions, files, shared workspace and knowledge. Knowledge is scoped: global, project or agent-private."
        actions={
          <>
            <Tabs value={view} onChange={setView} tabs={[{ id: 'projects', label: 'Projects' }, { id: 'knowledge', label: 'Knowledge base' }]} />
            <button className="btn-primary" onClick={() => setEditing({})}>
              <FolderPlus className="h-4 w-4" /> New project
            </button>
          </>
        }
      />
      {view === 'knowledge' ? (
        <KnowledgeBase />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {(projects.data ?? []).map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected(p.id)}
                className={cx('card block w-full p-3 text-left transition', selected === p.id ? 'border-accent-500/40 shadow-glow' : 'hover:border-white/10')}
              >
                <div className="flex items-center justify-between">
                  <span className="truncate font-medium text-white">{p.name}</span>
                  {p.status === 'archived' && <Badge className="border-zinc-500/30 text-zinc-400">archived</Badge>}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {p.stats?.missions ?? 0} missions · {p.stats?.tasks ?? 0} tasks · {p.stats?.runningTasks ?? 0} running · {p.stats?.files ?? 0} files
                </div>
              </button>
            ))}
          </div>
          {selected ? <ProjectDetail id={selected} onEdit={(p) => setEditing(p)} onDeleted={() => setSelected(null)} /> : <Spinner />}
        </div>
      )}
      <ProjectModal project={editing} onClose={() => setEditing(null)} />
    </>
  );
}

function ProjectDetail({ id, onEdit, onDeleted }: { id: string; onEdit: (p: any) => void; onDeleted: () => void }) {
  const q = useProject(id);
  const [tab, setTab] = useState<'missions' | 'workspace' | 'knowledge' | 'files'>('missions');
  const [taskId, setTaskId] = useState<string | null>(null);
  const confirm = useConfirm();
  const remove = useAction(() => del(`/projects/${id}`), { success: 'Project deleted', invalidate: [['projects']] });
  const p = q.data;
  if (!p) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card
        title={p.name}
        actions={
          <>
            <button className="btn-ghost btn-sm" onClick={() => onEdit(p)}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              className="btn-ghost btn-sm text-rose-300"
              onClick={async () =>
                (await confirm({ title: `Delete project "${p.name}"?`, message: 'Missions, tasks and project knowledge are permanently deleted. Files stay in storage.', danger: true, confirmText: 'Delete' })) &&
                remove.mutate(undefined, { onSuccess: onDeleted })
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-400">{p.description || 'No description.'}</p>
      </Card>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'missions', label: `Missions (${p.missions.length})` },
          { id: 'workspace', label: 'Shared workspace' },
          { id: 'knowledge', label: `Knowledge (${p.knowledge.length})` },
          { id: 'files', label: `Files (${p.files.length})` },
        ]}
      />
      {tab === 'missions' && (
        <Card>
          <MissionList missions={p.missions} onOpenTask={setTaskId} />
        </Card>
      )}
      {tab === 'workspace' && <Workspace projectId={id} />}
      {tab === 'knowledge' && <KnowledgeBase projectId={id} />}
      {tab === 'files' && (
        <Card>
          {!p.files.length && <Empty title="No files in this project" />}
          <ul className="divide-y divide-white/5">
            {p.files.map((f: any) => (
              <li key={f.id} className="flex items-center justify-between py-2 text-sm">
                <span className="truncate text-slate-200">{f.name}</span>
                <a className="btn-ghost btn-sm" href={downloadUrl(`/files/${f.id}/download`)} target="_blank" rel="noreferrer">
                  <Download className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} onOpenTask={setTaskId} />
    </div>
  );
}

function Workspace({ projectId }: { projectId: string }) {
  const [path, setPath] = useState('');
  const q = useQuery({ queryKey: ['workspace', projectId, path], queryFn: () => get<any[]>(`/projects/${projectId}/workspace?path=${encodeURIComponent(path)}`) });
  return (
    <Card title={<span className="font-mono text-xs">workspace/{path}</span>} actions={path && <button className="btn-ghost btn-sm" onClick={() => setPath(path.split('/').slice(0, -1).join('/'))}>.. up</button>}>
      <p className="mb-3 text-xs text-slate-500">CLI agents (Claude Code, Codex, Antigravity) run inside this directory. Files they create appear here. Read-only view.</p>
      {!q.data?.length && <Empty icon={<Folder className="h-6 w-6" />} title="Empty workspace" />}
      <ul className="divide-y divide-white/5">
        {(q.data ?? []).map((e) => (
          <li key={e.path} className="flex items-center justify-between py-1.5 text-sm">
            {e.type === 'dir' ? (
              <button className="flex items-center gap-2 text-slate-200 hover:underline" onClick={() => setPath(e.path)}>
                <Folder className="h-4 w-4 text-amber-300" /> {e.name}
              </button>
            ) : (
              <span className="text-slate-300">{e.name}</span>
            )}
            <span className="flex items-center gap-3 text-xs text-slate-500">
              {e.type === 'file' && fmtBytes(e.size)} {timeAgo(e.modifiedAt)}
              {e.type === 'file' && (
                <a className="btn-ghost btn-sm" href={downloadUrl(`/projects/${projectId}/workspace/file?path=${encodeURIComponent(e.path)}`)}>
                  <Download className="h-3.5 w-3.5" />
                </a>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function KnowledgeBase({ projectId }: { projectId?: string }) {
  const [scope, setScope] = useState<string>(projectId ? 'project' : '');
  const [q, setQ] = useState('');
  const params = `?${new URLSearchParams(Object.entries({ scope, projectId: projectId ?? '', q }).filter(([, v]) => v) as [string, string][])}`;
  const list = useKnowledge(params);
  const [editing, setEditing] = useState<Partial<Knowledge> | null>(null);
  const confirm = useConfirm();
  const remove = useAction((id: string) => del(`/knowledge/${id}`), { success: 'Deleted', invalidate: [['knowledge']] });
  const agents = useAgents();
  const agentName = (id: string | null) => agents.data?.find((a) => a.id === id)?.name ?? '—';
  return (
    <Card
      title={<span className="flex items-center gap-2"><BookOpen className="h-4 w-4" /> Knowledge</span>}
      actions={
        <>
          <input className="input h-8 w-40 py-0 text-xs" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
          {!projectId && (
            <select className="input h-8 w-32 py-0 text-xs" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">All scopes</option>
              <option value="global">Global</option>
              <option value="project">Project</option>
              <option value="agent">Agent memory</option>
            </select>
          )}
          <button className="btn-primary btn-sm" onClick={() => setEditing({ scope: projectId ? 'project' : 'global', projectId: projectId ?? null })}>
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </>
      }
    >
      {!list.data?.length && <Empty title="No knowledge yet">Add guidelines, facts and reference material. Agents receive relevant entries they are permitted to see.</Empty>}
      <ul className="space-y-2">
        {(list.data ?? []).map((k) => (
          <li key={k.id} className="rounded-lg border border-white/5 bg-ink-850/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="font-medium text-slate-100">{k.title}</span>
                <Badge className="border-white/10 text-slate-400">{k.scope}</Badge>
                {k.scope === 'agent' && <span className="text-xs text-slate-500">{agentName(k.agentId)}</span>}
                <span className="text-xs text-slate-600">{k.sourceType}</span>
              </span>
              <span className="flex gap-1">
                <button className="btn-ghost btn-sm" onClick={() => setEditing(k)}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button className="btn-ghost btn-sm text-rose-300" onClick={async () => (await confirm({ title: 'Delete entry?', message: k.title, danger: true })) && remove.mutate(k.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-slate-400">{k.content}</p>
          </li>
        ))}
      </ul>
      <KnowledgeModal entry={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function KnowledgeModal({ entry, onClose }: { entry: Partial<Knowledge> | null; onClose: () => void }) {
  const projects = useProjects();
  const agents = useAgents();
  const [form, setForm] = useState<Partial<Knowledge>>({});
  useEffect(() => {
    setForm(entry ?? {});
  }, [entry]);
  const save = useAction(
    () =>
      form.id
        ? patch(`/knowledge/${form.id}`, { title: form.title, content: form.content, tags: form.tags })
        : post('/knowledge', { scope: form.scope, projectId: form.projectId || null, agentId: form.agentId || null, title: form.title, content: form.content, tags: form.tags ?? '' }),
    { success: 'Knowledge saved', invalidate: [['knowledge'], ['project']] },
  );
  return (
    <Modal
      open={!!entry}
      onClose={onClose}
      wide
      title={form.id ? 'Edit knowledge' : 'New knowledge entry'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!form.title || !form.content} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Scope">
          <select className="input" disabled={!!form.id} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as any })}>
            <option value="global">Global – all permitted agents</option>
            <option value="project">Project</option>
            <option value="agent">Agent-private memory</option>
          </select>
        </Field>
        {form.scope !== 'global' && (
          <Field label="Project">
            <select className="input" disabled={!!form.id} value={form.projectId ?? ''} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
              <option value="">—</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {form.scope === 'agent' && (
          <Field label="Agent">
            <select className="input" disabled={!!form.id} value={form.agentId ?? ''} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
              <option value="">—</option>
              {(agents.data ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Title" className="sm:col-span-3">
          <input className="input" value={form.title ?? ''} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Content" className="sm:col-span-3">
          <textarea className="input h-56 font-mono text-xs" value={form.content ?? ''} onChange={(e) => setForm({ ...form, content: e.target.value })} />
        </Field>
        <Field label="Tags (comma separated)" className="sm:col-span-3">
          <input className="input" value={form.tags ?? ''} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function ProjectModal({ project, onClose }: { project: any | null; onClose: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('active');
  useEffect(() => {
    setName(project?.name ?? '');
    setDescription(project?.description ?? '');
    setStatus(project?.status ?? 'active');
  }, [project]);
  const save = useAction(() => (project?.id ? patch(`/projects/${project.id}`, { name, description, status }) : post('/projects', { name, description })), {
    success: 'Project saved',
    invalidate: [['projects'], ['project']],
  });
  return (
    <Modal
      open={!!project}
      onClose={onClose}
      title={project?.id ? 'Edit project' : 'New project'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!name} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            Save
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description">
          <textarea className="input h-24" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        {project?.id && (
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </select>
          </Field>
        )}
      </div>
    </Modal>
  );
}
