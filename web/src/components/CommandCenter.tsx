import { useQueryClient } from '@tanstack/react-query';
import { FileAudio, FileImage, FileText, FileVideo, Mic, MicOff, Paperclip, Send, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { post, uploadFiles } from '../lib/api';
import { useProjects } from '../lib/hooks';
import { fmtBytes } from '../lib/format';
import { cx, Spinner, useToast } from './ui';

type SpeechRec = any;

function fileIcon(f: File) {
  if (f.type.startsWith('image/')) return <FileImage className="h-3.5 w-3.5" />;
  if (f.type.startsWith('audio/')) return <FileAudio className="h-3.5 w-3.5" />;
  if (f.type.startsWith('video/')) return <FileVideo className="h-3.5 w-3.5" />;
  return <FileText className="h-3.5 w-3.5" />;
}

/**
 * AI Command Center: text + live dictation (Web Speech API) + microphone recording
 * (uploaded and transcribed server-side) + any number of attachments.
 * Mode "mission" sends to the Orchestrator; mode "chat" talks to the CEO Assistant;
 * mode "direct" assigns to one agent.
 */
export default function CommandCenter({
  mode = 'mission',
  agentId,
  onSubmitted,
  placeholder,
  compact,
}: {
  mode?: 'mission' | 'chat' | 'direct';
  agentId?: string;
  onSubmitted?: (r: any) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [recording, setRecording] = useState(false);
  const [lang, setLang] = useState(() => (navigator.language?.startsWith('vi') ? 'vi-VN' : 'en-US'));
  const recRef = useRef<SpeechRec | null>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const projects = useProjects();
  const toast = useToast();
  const qc = useQueryClient();
  const SR: any = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

  useEffect(() => () => recRef.current?.stop?.(), []);

  const toggleDictation = () => {
    if (!SR) return toast.push({ kind: 'error', text: 'Live dictation is not supported by this browser – use the recorder instead (transcribed on the server).' });
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e: any) => {
      let chunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) chunk += e.results[i][0].transcript;
      if (chunk) setText((t) => (t ? `${t} ${chunk.trim()}` : chunk.trim()));
    };
    rec.onerror = (e: any) => toast.push({ kind: 'error', text: `Speech recognition: ${e.error}` });
    rec.onend = () => setListening(false);
    rec.start();
    recRef.current = rec;
    setListening(true);
  };

  const toggleRecording = async () => {
    if (recording) {
      mediaRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const type = mr.mimeType || 'audio/webm';
        const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
        const blob = new Blob(chunksRef.current, { type });
        setFiles((f) => [...f, new File([blob], `voice-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`, { type })]);
        setRecording(false);
      };
      mr.start();
      mediaRef.current = mr;
      setRecording(true);
    } catch (e: any) {
      toast.push({ kind: 'error', text: `Microphone unavailable: ${e.message}` });
    }
  };

  const submit = async () => {
    if (!text.trim() && !files.length) return;
    setBusy(true);
    try {
      let fileIds: string[] = [];
      if (files.length) {
        const uploaded = await uploadFiles(files, { scope: 'mission', projectId: projectId || undefined });
        fileIds = uploaded.map((f) => f.id);
      }
      const body = text.trim() || 'Please process the attached files.';
      let r;
      if (mode === 'chat') r = await post('/chat', { text: body, fileIds });
      else if (mode === 'direct' && agentId) r = await post(`/agents/${agentId}/assign`, { text: body, fileIds, projectId: projectId || undefined });
      else r = await post('/missions', { text: body, fileIds, projectId: projectId || undefined });
      setText('');
      setFiles([]);
      toast.push({ kind: 'success', text: mode === 'chat' ? 'Message sent' : 'Mission submitted to the orchestrator' });
      void qc.invalidateQueries({ queryKey: ['missions'] });
      onSubmitted?.(r);
    } catch (e: any) {
      toast.push({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cx('rounded-xl border border-white/10 bg-ink-850/80 transition focus-within:border-accent-500/60 focus-within:shadow-glow')}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)]);
      }}
    >
      <textarea
        className={cx('w-full resize-none bg-transparent px-4 pt-3 text-sm text-slate-100 outline-none placeholder:text-slate-500', compact ? 'h-16' : 'h-24')}
        placeholder={placeholder ?? 'Describe what you need – the orchestrator will plan, split and assign the work… (drop files here)'}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
        }}
      />
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pb-2">
          {files.map((f, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-ink-800 px-2 py-1 text-xs text-slate-300">
              {fileIcon(f)}
              <span className="max-w-[160px] truncate">{f.name}</span>
              <span className="text-slate-500">{fmtBytes(f.size)}</span>
              <button onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-300">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1 border-t border-white/5 px-2 py-1.5">
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => (setFiles((f) => [...f, ...Array.from(e.target.files ?? [])]), (e.target.value = ''))} />
        <button className="btn-ghost btn-sm" onClick={() => fileInput.current?.click()} title="Attach files (images, audio, video, PDF, DOCX, XLSX, CSV, ZIP…)">
          <Paperclip className="h-4 w-4" />
        </button>
        <button className={cx('btn-ghost btn-sm', listening && 'text-rose-300')} onClick={toggleDictation} title="Live dictation (browser speech-to-text)">
          {listening ? <MicOff className="h-4 w-4 animate-pulse" /> : <Mic className="h-4 w-4" />}
        </button>
        <select className="rounded bg-transparent text-xs text-slate-500 outline-none" value={lang} onChange={(e) => setLang(e.target.value)} title="Dictation language">
          <option value="vi-VN">VI</option>
          <option value="en-US">EN</option>
          <option value="ja-JP">JA</option>
          <option value="zh-CN">ZH</option>
        </select>
        <button className={cx('btn-ghost btn-sm', recording && 'text-rose-300')} onClick={() => void toggleRecording()} title="Record a voice note (transcribed by the configured provider)">
          {recording ? <Square className="h-4 w-4 animate-pulse fill-current" /> : <FileAudio className="h-4 w-4" />}
          <span className="text-xs">{recording ? 'Stop' : 'Record'}</span>
        </button>
        {mode !== 'chat' && (
          <select className="ml-1 max-w-[160px] rounded bg-transparent text-xs text-slate-400 outline-none" value={projectId} onChange={(e) => setProjectId(e.target.value)} title="Project">
            <option value="">Project: default</option>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        <div className="flex-1" />
        <span className="hidden text-[11px] text-slate-600 sm:inline">Ctrl+Enter</span>
        <button className="btn-primary btn-sm" disabled={busy || (!text.trim() && !files.length)} onClick={() => void submit()}>
          {busy ? <Spinner /> : <Send className="h-3.5 w-3.5" />}
          {mode === 'chat' ? 'Send' : mode === 'direct' ? 'Assign' : 'Launch mission'}
        </button>
      </div>
    </div>
  );
}
