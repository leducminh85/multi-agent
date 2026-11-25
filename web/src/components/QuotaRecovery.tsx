import { LogIn, RefreshCw } from 'lucide-react';
import { post } from '../lib/api';
import { useAction } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { Spinner } from './ui';

/**
 * Shown for an AI that is out of quota: when it reopens, plus the two ways out –
 * switch the account (Antigravity CLI keeps its own sign-in) and "retry now" after switching/topping up.
 */
export default function QuotaRecovery({ provider }: { provider: { id: string; type: string; name: string; cooldownUntil?: string | null } }) {
  const retry = useAction(() => post<{ ok: boolean; message: string }>(`/providers/${provider.id}/clear-cooldown`), {
    success: (r) => (r.ok ? `${provider.name} is available again.` : `Still not available: ${r.message}`),
    invalidate: [['providers'], ['usage-overview'], ['overview'], ['provider-detect']],
  });
  const signIn = useAction(() => post<{ opened: boolean; manualCommand: string }>(`/providers/${provider.id}/antigravity-console`), {
    success: (r) =>
      r.opened
        ? 'An Antigravity window opened. Type /logout, press Enter, then /login and sign in with the new account. Then press Retry now.'
        : `Open a terminal, run "${r.manualCommand}", type /logout then /login. Then press Retry now.`,
  });
  if (!provider.cooldownUntil) return null;
  return (
    <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-100">
      <div>{`Out of quota – reopens ${fmtDate(provider.cooldownUntil)}. Meanwhile the office uses another connected AI.`}</div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {provider.type === 'antigravity-cli' && (
          <button className="btn-outline btn-sm" onClick={() => signIn.mutate()} disabled={signIn.isPending}>
            <LogIn className="h-3.5 w-3.5" /> Switch account
          </button>
        )}
        <button className="btn-primary btn-sm" onClick={() => retry.mutate()} disabled={retry.isPending}>
          {retry.isPending ? <Spinner /> : <RefreshCw className="h-3.5 w-3.5" />} Retry now
        </button>
      </div>
    </div>
  );
}
