import { useQueryClient } from '@tanstack/react-query';
import { Paperclip, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { post, uploadFiles } from '../lib/api';
import { fmtBytes } from '../lib/format';
import { cx, Spinner, useToast } from './ui';

/**
 * Answer an agent's question with text and/or files (pick, drag & drop, or paste a screenshot).
 * Files are uploaded to the task's project and handed to the agent with the answer.
 */
export default function AnswerBox({ taskId, projectId, compact, onSent }: { taskId: string; projectId?: string | null; compact?: boolean; onSent?: () => void }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const qc = useQueryClient();

  const previews = useMemo(() => files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : null)), [files]);
  useEffect(() => () => previews.forEach((u) => u && URL.revokeObjectURL(u)), [previews]);

  const add = (list: FileList | File[] | null) => {
    if (!list) return;
    const arr = Array.from(list);
    if (arr.length) setFiles((f) => [...f, ...arr].slice(0, 20));
  };

  const send = async () => {
    if (!text.trim() && !files.length) return;
    setBusy(true);
    try {
      const uploaded = files.length ? await uploadFiles(files, { scope: 'mission', projectId: projectId ?? undefined }) : [];
      await post(`/tasks/${taskId}/respond`, { answer: text.trim(), fileIds: uploaded.map((f) => f.id) });
      setText('');
      setFiles([]);
      toast.push({ kind: 'success', text: 'Answer sent – task resumed' });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['task', taskId] });
      void qc.invalidateQueries({ queryKey: ['messages'] });
      void qc.invalidateQueries({ queryKey: ['overview'] });
      onSent?.();
    } catch (e: any) {
      toast.push({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-lg border border-white/10 bg-ink-850/80 focus-within:border-accent-500/60"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        add(e.dataTransfer.files);
      }}
    >
      <textarea
        className={cx('w-full resize-none bg-transparent px-3 pt-2 text-sm text-slate-100 outline-none placeholder:text-slate-500', compact ? 'h-14' : 'h-20')}
        placeholder="Your answer… (you can paste a screenshot or drop files here)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = Array.from(e.clipboardData.files);
          if (pasted.length) {
            e.preventDefault();
            add(pasted.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `screenshot-${Date.now()}-${i + 1}.${f.type.split('/')[1] || 'png'}`, { type: f.type }))));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void send();
        }}
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-2 pb-2">
          {files.map((f, i) => (
            <span key={i} className="relative inline-flex items-center gap-1 rounded-md border border-white/10 bg-ink-800 p-1 text-xs text-slate-300">
              {previews[i] ? <img src={previews[i]!} alt={f.name} className="h-12 w-12 rounded object-cover" /> : <span className="max-w-[140px] truncate px-1">📎 {f.name}</span>}
              {!previews[i] && <span className="text-slate-500">{fmtBytes(f.size)}</span>}
              <button className="text-slate-500 hover:text-rose-300" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} aria-label="Remove file">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 border-t border-white/5 px-2 py-1">
        <input ref={input} type="file" multiple hidden onChange={(e) => (add(e.target.files), (e.target.value = ''))} />
        <button className="btn-ghost btn-sm" onClick={() => input.current?.click()} title="Attach images or files">
          <Paperclip className="h-4 w-4" />
        </button>
        <span className="hidden text-[11px] text-slate-600 sm:inline">Ctrl+V to paste an image</span>
        <div className="flex-1" />
        <button className="btn-primary btn-sm" disabled={busy || (!text.trim() && !files.length)} onClick={() => void send()}>
          {busy ? <Spinner /> : <Send className="h-3.5 w-3.5" />} Send
        </button>
      </div>
    </div>
  );
}
