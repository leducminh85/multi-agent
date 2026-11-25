import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, patch } from '../lib/api';
import { useAction, useProviders } from '../lib/hooks';
import type { Agent } from '../lib/types';
import { Spinner } from './ui';

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
          onChange={(e) => {
            setProviderId(e.target.value);
            setModel('');
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
      {models.isFetching && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
          <Spinner /> Loading models…
        </div>
      )}
      {!usable.length && <div className="mt-1 text-xs text-amber-300">Connect an AI first (Set up button on the dashboard).</div>}
    </div>
  );
}
