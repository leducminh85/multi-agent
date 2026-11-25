import { getLang, setLang } from '../lib/i18n';
import { cx } from './ui';

/** EN / VI switch. Changing the language reloads the page so every string is re-rendered. */
export default function LangToggle({ className }: { className?: string }) {
  const current = getLang();
  return (
    <div className={cx('flex overflow-hidden rounded-lg border border-white/10 text-xs', className)} title="Switch language" translate="no">
      {(['en', 'vi'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => l !== current && setLang(l)}
          className={cx('px-2 py-1 font-semibold transition', current === l ? 'bg-accent-600/30 text-white' : 'text-slate-400 hover:bg-white/5')}
        >
          {l === 'en' ? 'EN' : 'VI'}
        </button>
      ))}
    </div>
  );
}
