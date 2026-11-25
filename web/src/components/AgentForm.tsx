import { useEffect, useMemo, useState } from 'react';
import { patch, post } from '../lib/api';
import { useAction, useProviders, useProviderTypes, useRoles } from '../lib/hooks';
import type { Agent, AgentLimits, AgentPermissions } from '../lib/types';
import { Field, Modal, Toggle } from './ui';

const DEPARTMENTS = ['', 'manager', 'main', 'research', 'development', 'design', 'content', 'meeting', 'server'];

const DEFAULT_PERMS: AgentPermissions = {
  knowledgeScopes: ['global', 'project', 'agent'],
  fileAccess: 'project',
  allowCommandExecution: false,
  allowFileWrite: false,
  allowNetwork: true,
  canDelegate: true,
  canMessageAgents: true,
  requireApprovalForSensitiveActions: true,
};
const DEFAULT_LIMITS: AgentLimits = { maxConcurrentTasks: 1, maxOutputTokens: 16000, timeoutMs: 900000, dailyTokenBudget: null };

export default function AgentForm({ open, onClose, agent }: { open: boolean; onClose: () => void; agent?: Agent | null }) {
  const roles = useRoles();
  const providers = useProviders();
  const types = useProviderTypes();
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [model, setModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [department, setDepartment] = useState('');
  const [perms, setPerms] = useState<AgentPermissions>(DEFAULT_PERMS);
  const [limits, setLimits] = useState<AgentLimits>(DEFAULT_LIMITS);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(agent?.name ?? '');
    setRoleId(agent?.roleId ?? roles.data?.find((r) => r.key === 'general')?.id ?? '');
    setProviderId(agent?.providerId ?? providers.data?.find((p) => p.canExecute)?.id ?? '');
    setModel(agent?.model ?? '');
    setSystemPrompt(agent?.systemPrompt ?? '');
    setSpecialties(agent?.specialties ?? '');
    setDepartment(agent ? (agent.department === roles.data?.find((r) => r.id === agent.roleId)?.department ? '' : agent.department) : '');
    setPerms(agent?.permissions ?? DEFAULT_PERMS);
    setLimits(agent?.limits ?? DEFAULT_LIMITS);
    setEnabled(agent?.enabled ?? true);
  }, [open, agent, roles.data, providers.data]);

  const provider = providers.data?.find((p) => p.id === providerId);
  const descriptor = types.data?.find((t) => t.type === provider?.type);
  const isCli = descriptor?.integration === 'cli';
  const modelHints = useMemo(() => descriptor?.suggestedModels ?? [], [descriptor]);

  const save = useAction(
    async () => {
      const body = {
        name,
        roleId,
        providerId: providerId || null,
        model: model || null,
        systemPrompt,
        specialties,
        department: department || null,
        permissions: perms,
        limits,
        enabled,
      };
      return agent ? patch(`/agents/${agent.id}`, body) : post('/agents', body);
    },
    { success: agent ? 'Agent updated' : 'Agent created', invalidate: [['agents']] },
  );

  const setP = <K extends keyof AgentPermissions>(k: K, v: AgentPermissions[K]) => setPerms((p) => ({ ...p, [k]: v }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={agent ? `Edit ${agent.name}` : 'New agent'}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!name || !roleId || save.isPending} onClick={() => save.mutate(undefined, { onSuccess: onClose })}>
            {agent ? 'Save' : 'Create agent'}
          </button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rin (Research)" />
        </Field>
        <Field label="Role" help="Roles define default behaviour, department and visible activity. Create custom roles in Settings.">
          <select className="input" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {(roles.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.key})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Provider" help={descriptor ? `${descriptor.integration.toUpperCase()} integration – ${descriptor.vendor}` : 'Configure providers in Settings → Providers'}>
          <select className="input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            <option value="">— none —</option>
            {(providers.data ?? [])
              .filter((p) => p.canExecute)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.displayName} {p.status === 'error' ? '(error)' : ''}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Model" help={`Leave empty to use the provider default${provider?.config?.defaultModel ? ` (${provider.config.defaultModel})` : ''}.`}>
          <input className="input" list="model-hints" value={model} onChange={(e) => setModel(e.target.value)} placeholder={provider?.config?.defaultModel ?? ''} />
          <datalist id="model-hints">
            {modelHints.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </Field>
        <Field label="Specialties" className="md:col-span-2">
          <input className="input" value={specialties} onChange={(e) => setSpecialties(e.target.value)} placeholder="e.g. TypeScript, React, PostgreSQL" />
        </Field>
        <Field label="Personal system prompt (added to the role prompt)" className="md:col-span-2">
          <textarea className="input h-24 font-mono text-xs" value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} placeholder="Tone, rules, output format…" />
        </Field>
        <Field label="Office department (optional override)">
          <select className="input" value={department} onChange={(e) => setDepartment(e.target.value)}>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d || 'role default'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <Toggle checked={enabled} onChange={setEnabled} label={enabled ? 'Enabled' : 'Disabled'} />
        </Field>
      </div>

      <h4 className="mb-2 mt-6 text-sm font-semibold text-white">Permissions</h4>
      <div className="grid gap-3 rounded-lg border border-white/5 bg-ink-850/50 p-3 md:grid-cols-2">
        <Field label="Knowledge access">
          <div className="flex gap-3 text-sm">
            {(['global', 'project', 'agent'] as const).map((s) => (
              <label key={s} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={perms.knowledgeScopes.includes(s)}
                  onChange={(e) => setP('knowledgeScopes', e.target.checked ? [...perms.knowledgeScopes, s] : perms.knowledgeScopes.filter((x) => x !== s))}
                />
                {s}
              </label>
            ))}
          </div>
        </Field>
        <Field label="File access">
          <select className="input" value={perms.fileAccess} onChange={(e) => setP('fileAccess', e.target.value as AgentPermissions['fileAccess'])}>
            <option value="none">none</option>
            <option value="project">project files only</option>
            <option value="all">all files</option>
          </select>
        </Field>
        <Toggle checked={perms.canDelegate} onChange={(v) => setP('canDelegate', v)} label="May request help from other agents" />
        <Toggle checked={perms.canMessageAgents} onChange={(v) => setP('canMessageAgents', v)} label="May message other agents" />
        <div className="md:col-span-2 text-xs text-slate-500">
          Workspace tools (only for CLI agents{isCli ? '' : ' – not applicable to the selected provider'}). Agents run inside the project workspace directory.
        </div>
        <Toggle disabled={!isCli} checked={perms.allowFileWrite} onChange={(v) => setP('allowFileWrite', v)} label="Write / edit files in workspace" />
        <Toggle disabled={!isCli} checked={perms.allowCommandExecution} onChange={(v) => setP('allowCommandExecution', v)} label="Execute shell commands" />
        <Toggle disabled={!isCli} checked={perms.allowNetwork} onChange={(v) => setP('allowNetwork', v)} label="Network / web tools" />
        <div className="text-xs text-slate-500">Sensitive actions (deleting data, sending information out, transactions) always require your approval.</div>
      </div>

      <h4 className="mb-2 mt-6 text-sm font-semibold text-white">Resource limits</h4>
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Concurrent tasks">
          <input className="input" type="number" min={1} max={64} value={limits.maxConcurrentTasks} onChange={(e) => setLimits({ ...limits, maxConcurrentTasks: Number(e.target.value) })} />
        </Field>
        <Field label="Max output tokens">
          <input className="input" type="number" min={256} value={limits.maxOutputTokens} onChange={(e) => setLimits({ ...limits, maxOutputTokens: Number(e.target.value) })} />
        </Field>
        <Field label="Timeout (min)">
          <input className="input" type="number" min={1} value={Math.round(limits.timeoutMs / 60000)} onChange={(e) => setLimits({ ...limits, timeoutMs: Number(e.target.value) * 60000 })} />
        </Field>
        <Field label="Daily token budget">
          <input
            className="input"
            type="number"
            min={0}
            placeholder="unlimited"
            value={limits.dailyTokenBudget ?? ''}
            onChange={(e) => setLimits({ ...limits, dailyTokenBudget: e.target.value ? Number(e.target.value) : null })}
          />
        </Field>
      </div>
    </Modal>
  );
}
