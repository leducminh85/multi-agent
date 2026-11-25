import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Cpu, KeyRound, Laptop, LogIn, RefreshCw, Sparkles, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, post } from '../lib/api';
import { useAgents, useProviders, useProviderTypes } from '../lib/hooks';
import type { Provider } from '../lib/types';
import { cx, Modal, Spinner, useToast } from './ui';

interface Detected {
  cli: { type: string; command: string; label: string; found: boolean; version: string | null; loggedIn: boolean | null; authMethod: string | null }[];
  ollama: { found: boolean; models: string[] };
}

/** API-key options. The model is preselected so the user only pastes a key. */
const KEY_OPTIONS = [
  { type: 'anthropic-api', label: 'Claude (Anthropic)', hint: 'Key starts with sk-ant-', model: 'claude-opus-5-5', where: 'console.anthropic.com → API keys' },
  { type: 'openai-api', label: 'ChatGPT (OpenAI)', hint: 'Key starts with sk-', model: 'gpt-5', where: 'platform.openai.com → API keys' },
  { type: 'gemini-api', label: 'Gemini (Google)', hint: 'Key from Google AI Studio', model: 'gemini-2.5-flash', where: 'aistudio.google.com → Get API key' },
];

const CLI_HINT: Record<string, string> = {
  'claude-code-cli': 'Uses the Claude account already signed in on this computer',
  'codex-cli': 'Uses the ChatGPT account already signed in on this computer',
  'antigravity-cli': 'Uses the Google account already signed in on this computer',
};

type Choice = { kind: 'cli'; type: string; label: string; command: string } | { kind: 'ollama'; model: string } | { kind: 'key'; type: string; label: string; model: string; key: string };

/**
 * One-screen onboarding for non-technical users: shows which AIs are already on this computer,
 * connects the chosen one with sensible defaults, checks it really works, then hires a default team.
 */
export default function SetupWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const providers = useProviders();
  const agents = useAgents();
  const types = useProviderTypes();
  const [waitingLogin, setWaitingLogin] = useState<null | { opened: boolean; manualCommand: string }>(null);
  const detect = useQuery({
    queryKey: ['provider-detect'],
    queryFn: () => get<Detected>('/providers/detect'),
    enabled: open,
    staleTime: 60_000,
    // While the user signs in to Claude in the browser, re-check every few seconds.
    refetchInterval: waitingLogin ? 4000 : false,
  });
  const claude = detect.data?.cli.find((c) => c.type === 'claude-code-cli');
  useEffect(() => {
    if (waitingLogin && claude?.loggedIn) setWaitingLogin(null);
  }, [waitingLogin, claude?.loggedIn]);
  const signIn = async () => {
    setError(null);
    try {
      setWaitingLogin(await post<{ opened: boolean; manualCommand: string }>('/providers/claude-login'));
    } catch (e: any) {
      setError(e.message);
    }
  };
  const [keyType, setKeyType] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [ollamaModel, setOllamaModel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const executable = (providers.data ?? []).filter((p) => p.canExecute);
  const hasAgents = (agents.data?.length ?? 0) > 0;

  const defaults = (type: string) => {
    const d = types.data?.find((t) => t.type === type);
    const cfg: Record<string, unknown> = {};
    for (const f of d?.configFields ?? []) if (f.default !== undefined) cfg[f.key] = f.default;
    return cfg;
  };

  const makeTeam = async (providerId: string) => {
    if (!hasAgents) await post('/agents/team', { providerId });
  };

  const connect = async (c: Choice) => {
    const id = c.kind === 'cli' ? c.type : c.kind === 'ollama' ? 'ollama' : c.type;
    setBusy(id);
    setError(null);
    try {
      let body: any;
      if (c.kind === 'cli') body = { type: c.type, name: c.label, config: { ...defaults(c.type), command: c.type === 'claude-code-cli' ? 'claude' : c.command } };
      else if (c.kind === 'ollama') body = { type: 'ollama', name: 'Ollama (on this computer)', config: { ...defaults('ollama'), defaultModel: c.model } };
      else body = { type: c.type, name: c.label, config: { ...defaults(c.type), defaultModel: c.model }, credentials: { apiKey: c.key.trim() } };
      const p = await post<Provider>('/providers', body);
      const check = await post<{ ok: boolean; message: string }>(`/providers/${p.id}/check`);
      if (!check.ok) {
        setError(`Connected, but the test failed: ${check.message}. You can fix it later in Settings → Providers.`);
        void qc.invalidateQueries();
        return;
      }
      await makeTeam(p.id);
      setDone(hasAgents ? `Connected ${p.name}.` : `Connected ${p.name} and hired a team of 6 AI employees.`);
      toast.push({ kind: 'success', text: 'Your office is ready' });
      void qc.invalidateQueries();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const hireOnly = async (p: Provider) => {
    setBusy(p.id);
    setError(null);
    try {
      await makeTeam(p.id);
      setDone(`Hired a team of 6 AI employees using ${p.name}.`);
      void qc.invalidateQueries();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const keyOpt = KEY_OPTIONS.find((k) => k.type === keyType);
  const models = detect.data?.ollama.models ?? [];

  return (
    <Modal open={open} onClose={onClose} wide title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-accent-400" /> Set up your office</span>}>
      {done ? (
        <div className="py-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-400" />
          <div className="mt-3 text-lg font-semibold text-white">Done!</div>
          <p className="mt-1 text-sm text-slate-400">{done}</p>
          <p className="mt-3 text-sm text-slate-300">Type a request in the box at the top of the dashboard and the team gets started.</p>
          <button className="btn-primary mt-5" onClick={onClose}>
            Open the dashboard
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-slate-400">Choose an AI to run your office. Nothing technical needed: the system picks the settings for you and checks that it actually works.</p>

          {executable.length > 0 && !hasAgents && (
            <section>
              <h4 className="mb-2 text-sm font-semibold text-white">Already connected</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {executable.map((p) => (
                  <Option key={p.id} icon={<CheckCircle2 className="h-5 w-5 text-emerald-400" />} title={p.name} sub="Hire 6 employees on this AI" busy={busy === p.id} onClick={() => void hireOnly(p)} />
                ))}
              </div>
            </section>
          )}

          <section>
            <h4 className="mb-2 text-sm font-semibold text-white">Found on this computer</h4>
            {detect.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Spinner /> Checking your computer…
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {claude && (
                  <div className={cx('rounded-xl border p-3 sm:col-span-2', claude.found ? 'border-accent-500/40 bg-ink-850' : 'border-white/10 bg-ink-850/60')}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 text-lg">✳️</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-white">Claude (Claude Code)</div>
                        {claude.found && claude.loggedIn !== false && <div className="text-xs text-emerald-300">Uses your Claude subscription. Signed in and ready.</div>}
                        {claude.found && claude.loggedIn === false && <div className="text-xs text-amber-300">Found on this computer, but not signed in yet.</div>}
                        {!claude.found && (
                          <div className="text-xs text-slate-400">
                            <div>Not installed. Install the official Claude Code (one command in PowerShell), then press Check again:</div>
                            <code translate="no" className="mt-1 block select-all rounded bg-ink-950 px-2 py-1 text-[11px] text-slate-200">
                              irm https://claude.ai/install.ps1 | iex
                            </code>
                          </div>
                        )}
                        {waitingLogin && (
                          <div className="mt-2 rounded-md border border-sky-500/30 bg-sky-500/10 p-2 text-xs text-sky-200">
                            {waitingLogin.opened ? (
                              <span className="flex items-center gap-2">
                                <Spinner /> A Claude sign-in window opened. Finish signing in in your browser – this page notices automatically.
                              </span>
                            ) : (
                              <>
                                <div>Run this command in a terminal to sign in:</div>
                                <code translate="no" className="mt-1 block select-all rounded bg-ink-950 px-2 py-1 text-[11px]">
                                  {waitingLogin.manualCommand}
                                </code>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1.5">
                        {claude.found && claude.loggedIn !== false && (
                          <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => void connect({ kind: 'cli', type: claude.type, label: claude.label, command: claude.command })}>
                            {busy === claude.type ? <Spinner /> : 'Use'}
                          </button>
                        )}
                        {claude.found && claude.loggedIn === false && (
                          <button className="btn-primary btn-sm" onClick={() => void signIn()}>
                            <LogIn className="h-3.5 w-3.5" /> Sign in to Claude
                          </button>
                        )}
                        <button className="btn-ghost btn-sm" onClick={() => void detect.refetch()}>
                          <RefreshCw className={cx('h-3.5 w-3.5', detect.isFetching && 'animate-spin')} /> Check again
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                {(detect.data?.cli ?? []).filter((c) => c.type !== 'claude-code-cli').map((c) => (
                  <Option
                    key={c.type}
                    icon={<Laptop className={cx('h-5 w-5', c.found ? 'text-accent-400' : 'text-slate-600')} />}
                    title={c.label}
                    sub={c.found ? CLI_HINT[c.type] : 'Not installed on this computer'}
                    disabled={!c.found}
                    busy={busy === c.type}
                    onClick={() => void connect({ kind: 'cli', type: c.type, label: c.label, command: c.command })}
                  />
                ))}
                <div className={cx('rounded-xl border p-3', detect.data?.ollama.found && models.length ? 'border-white/10 bg-ink-850' : 'border-white/5 opacity-50')}>
                  <div className="flex items-start gap-3">
                    <Cpu className="mt-0.5 h-5 w-5 text-emerald-400" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white">Ollama (free, runs offline)</div>
                      <div className="text-xs text-slate-500">
                        {!detect.data?.ollama.found ? 'Ollama is not running' : models.length ? `${models.length} model(s) available` : 'Ollama is running but has no models yet'}
                      </div>
                      {detect.data?.ollama.found && models.length > 0 && (
                        <div className="mt-2 flex gap-2">
                          <select className="input h-8 py-0 text-xs" value={ollamaModel || models[0]} onChange={(e) => setOllamaModel(e.target.value)}>
                            {models.map((m) => (
                              <option key={m}>{m}</option>
                            ))}
                          </select>
                          <button className="btn-primary btn-sm" disabled={!!busy} onClick={() => void connect({ kind: 'ollama', model: ollamaModel || models[0] })}>
                            {busy === 'ollama' ? <Spinner /> : 'Use'}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section>
            <h4 className="mb-2 text-sm font-semibold text-white">Or use an API key</h4>
            <div className="flex flex-wrap gap-2">
              {KEY_OPTIONS.map((k) => (
                <button key={k.type} className={cx('btn-outline btn-sm', keyType === k.type && 'border-accent-500 text-white')} onClick={() => setKeyType(k.type)}>
                  <KeyRound className="h-3.5 w-3.5" /> {k.label}
                </button>
              ))}
            </div>
            {keyOpt && (
              <div className="mt-3 rounded-xl border border-white/10 bg-ink-850 p-3">
                <div className="mb-1 text-xs text-slate-400">
                  {`Paste your ${keyOpt.label} API key (${keyOpt.hint}). Get one at:`} <span className="text-slate-300">{keyOpt.where}</span>. The key is stored encrypted.
                </div>
                <div className="flex gap-2">
                  <input className="input" type="password" autoComplete="off" placeholder="Paste the key here" value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
                  <button
                    className="btn-primary"
                    disabled={!apiKey.trim() || !!busy}
                    onClick={() => void connect({ kind: 'key', type: keyOpt.type, label: keyOpt.label, model: keyOpt.model, key: apiKey })}
                  >
                    {busy === keyOpt.type ? <Spinner /> : 'Connect'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Option({ icon, title, sub, onClick, disabled, busy }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <button
      disabled={disabled || busy}
      onClick={onClick}
      className={cx('flex items-start gap-3 rounded-xl border p-3 text-left transition', disabled ? 'cursor-not-allowed border-white/5 opacity-50' : 'border-white/10 bg-ink-850 hover:border-accent-500/60 hover:shadow-glow')}
    >
      <span className="mt-0.5">{busy ? <Spinner className="h-5 w-5" /> : icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{title}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
    </button>
  );
}
