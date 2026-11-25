import { useEffect, useState } from 'react';
import { post } from '../lib/api';
import { useAction, useProviders, useRoles } from '../lib/hooks';
import AgentForm from './AgentForm';
import { cx, Modal } from './ui';

/** Plain-language job descriptions, keyed by built-in role key. */
const JOBS: Record<string, { emoji: string; title: string; text: string }> = {
  ceo_assistant: { emoji: '🧑‍💼', title: 'Personal assistant', text: 'Talks with you, coordinates the team and reports back' },
  project_manager: { emoji: '📋', title: 'Project manager', text: 'Breaks big requests into steps and assigns them' },
  researcher: { emoji: '🔎', title: 'Researcher', text: 'Looks things up and summarises information' },
  developer: { emoji: '💻', title: 'Programmer', text: 'Writes and fixes code' },
  designer: { emoji: '🎨', title: 'Designer', text: 'Layout, UI/UX and visual ideas' },
  content: { emoji: '✍️', title: 'Writer', text: 'Articles, scripts, marketing copy' },
  data_analyst: { emoji: '📊', title: 'Data analyst', text: 'Numbers, spreadsheets and reports' },
  qa: { emoji: '✅', title: 'Reviewer', text: 'Checks the quality of finished work' },
  general: { emoji: '🧰', title: 'All-rounder', text: 'Handles general tasks' },
};

const NAMES = ['Minh', 'Lan', 'Huy', 'Mai', 'Nam', 'Linh', 'Tuấn', 'Hà', 'Khoa', 'Trang', 'Phúc', 'Vy', 'An', 'Bảo', 'Ngọc', 'Quân'];

/**
 * "Hire an employee" in two clicks: pick a job, (optionally) rename, done.
 * Provider/model/permissions use safe defaults; everything else lives behind "Advanced".
 */
export default function QuickAgentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const roles = useRoles();
  const providers = useProviders();
  const executable = (providers.data ?? []).filter((p) => p.canExecute && p.enabled);
  const [roleKey, setRoleKey] = useState('researcher');
  const [name, setName] = useState('');
  const [providerId, setProviderId] = useState('');
  const [advanced, setAdvanced] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(NAMES[Math.floor(Math.random() * NAMES.length)]);
    setRoleKey('researcher');
    setProviderId(executable.find((p) => p.status === 'connected')?.id ?? executable[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const role = roles.data?.find((r) => r.key === roleKey);
  const create = useAction(() => post('/agents', { name: name.trim(), roleId: role!.id, providerId: providerId || null }), {
    success: `${name} joined the office`,
    invalidate: [['agents']],
  });

  const order = Object.keys(JOBS);
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : order.length);
  const list = [...(roles.data ?? [])].sort((a, b) => rank(a.key) - rank(b.key)).map((r) => ({ r, job: JOBS[r.key] ?? { emoji: '🤖', title: r.name, text: r.description } }));

  return (
    <>
      <Modal
        open={open && !advanced}
        onClose={onClose}
        wide
        title="Hire an AI employee"
        footer={
          <>
            <button className="btn-ghost mr-auto text-xs" onClick={() => setAdvanced(true)}>
              Advanced settings…
            </button>
            <button className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" disabled={!name.trim() || !role || !providerId || create.isPending} onClick={() => create.mutate(undefined, { onSuccess: onClose })}>
              Hire
            </button>
          </>
        }
      >
        <div className="mb-2 text-sm font-medium text-white">1. What should they do?</div>
        <div className="grid gap-2 sm:grid-cols-3">
          {list.map(({ r, job }) => (
            <button
              key={r.id}
              onClick={() => setRoleKey(r.key)}
              className={cx('rounded-xl border p-3 text-left transition', roleKey === r.key ? 'border-accent-500 bg-accent-600/15 shadow-glow' : 'border-white/10 bg-ink-850 hover:border-white/20')}
            >
              <div className="text-lg">{job.emoji}</div>
              <div className="text-sm font-medium text-white">{job.title}</div>
              <div className="text-xs text-slate-500">{job.text}</div>
            </button>
          ))}
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-white">2. Name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-white">3. Which AI does the work?</span>
            {executable.length ? (
              <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                {executable.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.cooldownUntil ? ' (out of quota – using another AI)' : p.status === 'error' ? ' (connection problem)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-sm text-amber-300">Connect an AI first (Set up button on the dashboard).</div>
            )}
          </label>
        </div>
      </Modal>
      <AgentForm
        open={open && advanced}
        onClose={() => {
          setAdvanced(false);
          onClose();
        }}
      />
    </>
  );
}
