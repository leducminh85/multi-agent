import { Building2, Lock } from 'lucide-react';
import { useState } from 'react';
import { post } from '../lib/api';

export default function LoginPage({ setupRequired, onAuthenticated }: { setupRequired: boolean; onAuthenticated: (token: string) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setupRequired && password !== confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      const r = await post<{ token: string }>(setupRequired ? '/auth/setup' : '/auth/login', { username, password });
      onAuthenticated(r.token);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 shadow-glow">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-600/20 text-accent-400">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-white">AI Multi-Agent Office</div>
            <div className="text-xs text-slate-400">{setupRequired ? 'First run – create the manager (CEO) account' : 'Sign in to your office'}</div>
          </div>
        </div>
        <label className="label">Username</label>
        <input className="input mb-3" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        <label className="label">Password</label>
        <input className="input mb-3" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={setupRequired ? 'new-password' : 'current-password'} required minLength={setupRequired ? 8 : 1} />
        {setupRequired && (
          <>
            <label className="label">Confirm password</label>
            <input className="input mb-3" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </>
        )}
        {error && <div className="mb-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}
        <button className="btn-primary w-full" disabled={busy}>
          <Lock className="h-4 w-4" /> {setupRequired ? 'Create account' : 'Sign in'}
        </button>
        {setupRequired && <p className="mt-3 text-xs text-slate-500">The password is stored as a salted scrypt hash. Minimum 8 characters.</p>}
      </form>
    </div>
  );
}
