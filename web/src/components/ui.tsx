import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Overlays are portaled to <body>: an ancestor with backdrop-filter (every .card) or a transform
 * (framer-motion) would otherwise become the containing block of `position: fixed` and clip/cover them.
 */
function Overlay({ children }: { children: ReactNode }) {
  return typeof document === 'undefined' ? <>{children}</> : createPortal(children, document.body);
}
import { ACTIVITY_COLOR, ACTIVITY_LABEL, STATUS_COLOR } from '../lib/format';
import Markdown, { type MediaContext } from './Markdown';

export const cx = clsx;

// ---------------------------------------------------------------- badges
export function Badge({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium', className)}>{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge className={STATUS_COLOR[status] ?? STATUS_COLOR.unknown}>
      {(status === 'running' || status === 'reviewing' || status === 'planning') && <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-current" />}
      {status}
    </Badge>
  );
}

export function ActivityBadge({ activity }: { activity: string }) {
  return (
    <Badge className={ACTIVITY_COLOR[activity] ?? ACTIVITY_COLOR.idle}>
      {activity !== 'idle' && <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-current" />}
      {ACTIVITY_LABEL[activity] ?? activity}
    </Badge>
  );
}

// ---------------------------------------------------------------- layout primitives
export function Card({ title, actions, className, children, pad = true }: { title?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode; pad?: boolean }) {
  return (
    <section className={cx('card', className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-white/5 px-4 py-2.5">
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <div className="flex items-center gap-1">{actions}</div>
        </header>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{actions}</div>
    </div>
  );
}

export function Stat({ label, value, hint, icon, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; tone?: 'default' | 'good' | 'bad' | 'warn' }) {
  const tones = { default: 'text-white', good: 'text-emerald-300', bad: 'text-rose-300', warn: 'text-amber-300' };
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-slate-400">
        {label}
        <span className="text-slate-500">{icon}</span>
      </div>
      <div className={cx('mt-1.5 text-2xl font-semibold tabular-nums', tones[tone])}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <div className="text-slate-600">{icon}</div>
      <div className="text-sm font-medium text-slate-300">{title}</div>
      {children && <div className="max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-4 w-4 animate-spin', className)} />;
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-lg border border-white/5 bg-ink-900 p-0.5">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cx('rounded-md px-3 py-1.5 text-xs font-medium transition', value === t.id ? 'bg-accent-600 text-white shadow' : 'text-slate-400 hover:text-slate-200')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, help, children, className }: { label: string; help?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {help && <span className="mt-1 block text-xs text-slate-500">{help}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2 text-sm text-slate-300 disabled:opacity-50">
      <span className={cx('relative h-5 w-9 rounded-full transition', checked ? 'bg-accent-600' : 'bg-ink-700')}>
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white transition', checked ? 'left-[18px]' : 'left-0.5')} />
      </span>
      {label}
    </button>
  );
}

export function ProgressBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'good' | 'warn' | 'bad' }) {
  const colors = { accent: 'bg-accent-500', good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-rose-500' };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
      <div className={cx('h-full rounded-full transition-all', colors[tone])} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------- modal
export function Modal({ open, onClose, title, children, wide, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <Overlay>
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            className={cx('card w-full shadow-2xl', wide ? 'max-w-4xl' : 'max-w-lg')}
            initial={{ y: 16, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-white/5 px-5 py-3">
              <h2 className="text-base font-semibold text-white">{title}</h2>
              <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
            {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-white/5 px-5 py-3">{footer}</footer>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </Overlay>
  );
}

// ---------------------------------------------------------------- drawer
export function Drawer({ open, onClose, title, children, width = 'max-w-2xl' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string }) {
  return (
    <Overlay>
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-40 bg-black/50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.aside
            className={cx('absolute right-0 top-0 flex h-full w-full flex-col border-l border-white/5 bg-ink-900 shadow-2xl', width)}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between gap-2 border-b border-white/5 px-5 py-3">
              <div className="min-w-0 flex-1 text-base font-semibold text-white">{title}</div>
              <button className="btn-ghost btn-sm" onClick={onClose} aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
    </Overlay>
  );
}

// ---------------------------------------------------------------- confirm dialog
type ConfirmOpts = { title: string; message: ReactNode; confirmText?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const close = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={
          <span className="flex items-center gap-2">
            {state?.danger && <AlertTriangle className="h-4 w-4 text-rose-400" />}
            {state?.title}
          </span>
        }
        footer={
          <>
            <button className="btn-ghost" onClick={() => close(false)}>
              Cancel
            </button>
            <button className={state?.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)} autoFocus>
              {state?.confirmText ?? 'Confirm'}
            </button>
          </>
        }
      >
        <div className="text-sm text-slate-300">{state?.message}</div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

// ---------------------------------------------------------------- toasts
type Toast = { id: number; kind: 'success' | 'error' | 'info'; text: string };
const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'>) => void }>({ push: () => undefined });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++idRef.current;
    setToasts((x) => [...x, { ...t, id }].slice(-5));
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), t.kind === 'error' ? 7000 : 3500);
  }, []);
  const icon = { success: <CheckCircle2 className="h-4 w-4 text-emerald-400" />, error: <XCircle className="h-4 w-4 text-rose-400" />, info: <Info className="h-4 w-4 text-sky-400" /> };
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} className="card pointer-events-auto flex items-start gap-2 px-3 py-2.5 text-sm shadow-xl">
              {icon[t.kind]}
              <span className="flex-1 break-words text-slate-200">{t.text}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- misc
export function Output({ text, className, ctx, raw: forceRaw }: { text: string | null | undefined; className?: string; ctx?: MediaContext; raw?: boolean }) {
  const [raw, setRaw] = useState(false);
  if (!text) return <div className="text-sm italic text-slate-500">No output yet.</div>;
  const box = cx('max-h-[560px] overflow-auto rounded-lg border border-white/5 bg-ink-950/60 p-3', className);
  if (forceRaw) return <pre className={cx('prose-output', box)}>{text}</pre>;
  return (
    <div className="relative">
      <button className="absolute right-2 top-2 z-10 rounded bg-ink-800/80 px-1.5 py-0.5 text-[10px] text-slate-400 hover:text-white" onClick={() => setRaw((v) => !v)}>
        {raw ? 'Formatted' : 'Raw text'}
      </button>
      {raw ? <pre className={cx('prose-output', box)}>{text}</pre> : <Markdown text={text} ctx={ctx} className={box} />}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-white/10 bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{children}</kbd>;
}
