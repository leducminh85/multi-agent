import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, patch, post } from '../lib/api';
import { useAction, useProviders } from '../lib/hooks';
import type { Agent, Provider } from '../lib/types';
import { Spinner, useToast } from './ui';

export interface ModelOption {
  id: string;
  label?: string;
}

export const useProviderModels = (providerId: string | null | undefined) =>
  useQuery({
    queryKey: ['provider-models', providerId],
    queryFn: () => get<ModelOption[]>(`/providers/${providerId}/models`),
    enabled: !!providerId,
    staleTime: 5 * 60_000,
  });

interface DetectedCli {
  type: string;
  command: string;
  label: string;
  found: boolean;
  loggedIn: boolean | null;
}

/**
 * AIs found on this computer that are not connected yet (e.g. Claude Code signed in but never added),
 * plus a one-click `connect` that adds them with safe defaults and verifies the connection.
 */
export function useConnectableAis() {
  const providers = useProviders();
  const qc = useQueryClient();
  const toast = useToast();
  const detect = useQuery({ queryKey: ['provider-detect'], queryFn: () => get<{ cli: DetectedCli[] }>('/providers/detect'), staleTime: 60_000 });
  const connectedTypes = new Set((providers.data ?? []).map((p) => p.type));
  const connectable = (detect.data?.cli ?? []).filter((c) => c.found && !connectedTypes.has(c.type));

  const connect = async (type: string): Promise<Provider | null> => {
    const c = connectable.find((x) => x.type === type);
    if (!c) return null;
    if (c.loggedIn === false) {
      const r = await post<{ opened: boolean; manualCommand: string }>('/providers/claude-login');
      toast.push({
        kind: 'info',
        text: r.opened ? 'A Claude sign-in window opened. Finish signing in in your browser, then choose Claude again.' : `Run this in a terminal to sign in: ${r.manualCommand}`,
      });
      void qc.invalidateQueries({ queryKey: ['provider-detect'] });
      return null;
    }
    const p = await post<Provider>('/providers', {
      type: c.type,
      name: c.label,
      config: { command: c.type === 'claude-code-cli' ? 'claude' : c.command, ...(c.type === 'antigravity-cli' ? { sandbox: true } : {}) },
    });
    const check = await post<{ ok: boolean; message: string }>(`/providers/${p.id}/check`);
    await qc.invalidateQueries({ queryKey: ['providers'] });
    void qc.invalidateQueries({ queryKey: ['provider-detect'] });
    toast.push({ kind: check.ok ? 'success' : 'error', text: check.ok ? `Connected ${p.name}.` : `Connected, but the test failed: ${check.message}` });
    return p;
  };
  return { connectable, connect };
}

/**
 * "Which AI does this employee use?" – pick a connected AI and (optionally) a model, then save.
 * Empty model = the AI's own default, which is the safe choice for non-technical users.
 */
export default function AgentAiPicker({ agent }: { agent: Agent }) {
  const providers = useProviders();
  const usable = (providers.data ?? []).filter((p) => p.canExecute && p.enabled);
  const [providerId, setProviderId] = useState(agent.providerId ?? '');
  const [model, setModel] = useState(agent.model ?? '');
  const models = useProviderModels(providerId || null);
  const { connectable, connect } = useConnectableAis();
  const [connecting, setConnecting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setProviderId(agent.providerId ?? '');
    setModel(agent.model ?? '');
  }, [agent.id, agent.providerId, agent.model]);

  const dirty = providerId !== (agent.providerId ?? '') || model !== (agent.model ?? '');
  const save = useAction(() => patch(`/agents/${agent.id}`, { providerId: providerId || null, model: model || null }), {
    success: `${agent.name} now uses the selected AI`,
    invalidate: [['agents'], ['agent', agent.id]],
  });

  const known = (models.data ?? []).some((m) => m.id === model);

  return (
    <div className="rounded-lg border border-white/10 bg-ink-850/60 p-3">
      <div className="mb-2 text-sm font-medium text-white">AI & model</div>
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <select
          className="input"
          value={providerId}
          onChange={async (e) => {
            const v = e.target.value;
            setModel('');
            if (!v.startsWith('connect:')) return setProviderId(v);
            setConnecting(true);
            try {
              const p = await connect(v.slice('connect:'.length));
              if (p) setProviderId(p.id);
            } catch (err: any) {
              toast.push({ kind: 'error', text: err.message });
            } finally {
              setConnecting(false);
            }
          }}
          aria-label="AI"
        >
          {!providerId && <option value="">Select…</option>}
          {usable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.status === 'error' ? ' (connection problem)' : ''}
            </option>
          ))}
          {connectable.map((c) => (
            <option key={c.type} value={`connect:${c.type}`}>
              {`${c.label} – ${c.loggedIn === false ? 'sign in to connect' : 'not connected yet, choose to connect'}`}
            </option>
          ))}
        </select>
        <select className="input" value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" disabled={!providerId}>
          <option value="">Default (recommended)</option>
          {model && !known && <option value={model}>{model}</option>}
          {(models.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label ? `${m.label} – ${m.id}` : m.id}
            </option>
          ))}
        </select>
        <button className="btn-primary" disabled={!dirty || !providerId || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Spinner /> : <Check className="h-4 w-4" />} Save
        </button>
      </div>
      {connecting && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <Spinner /> Connecting…
        </div>
      )}
      {models.isFetching && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <Spinner /> Loading models…
        </div>
      )}
      {!usable.length && !connectable.length && <div className="mt-1 text-xs text-amber-300">Connect an AI first (Set up button on the dashboard).</div>}
    </div>
  );
}
