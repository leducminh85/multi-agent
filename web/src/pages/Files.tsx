import { useQuery } from '@tanstack/react-query';
import { Download, Eye, FileUp, RefreshCw, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Badge, Card, Empty, Modal, PageHeader, Spinner, cx, useConfirm, useToast } from '../components/ui';
import { del, downloadUrl, get, post, uploadFiles } from '../lib/api';
import { useAction, useAgents, useFiles, useProjects } from '../lib/hooks';
import { fmtBytes, timeAgo } from '../lib/format';
import type { StoredFile } from '../lib/types';

const STATUS_STYLE: Record<string, string> = {
  done: 'border-emerald-500/30 text-emerald-300',
  processing: 'border-sky-500/30 text-sky-300',
  pending: 'border-slate-500/30 text-slate-300',
  failed: 'border-rose-500/30 text-rose-300',
  unsupported: 'border-amber-500/30 text-amber-300',
  stored: 'border-zinc-500/30 text-zinc-300',
};

export default function FilesPage() {
  const [scope, setScope] = useState('');
  const [projectId, setProjectId] = useState('');
  const [uploadScope, setUploadScope] = useState('project');
  const [uploadAgent, setUploadAgent] = useState('');
  const [preview, setPreview] = useState<StoredFile | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const params = `?${new URLSearchParams(Object.entries({ scope, projectId }).filter(([, v]) => v) as [string, string][])}`;
  const files = useFiles(params);
  const projects = useProjects();
  const agents = useAgents();
  const toast = useToast();
  const confirm = useConfirm();
  const remove = useAction((id: string) => del(`/files/${id}`), { success: 'File deleted', invalidate: [['files']] });
  const reprocess = useAction((id: string) => post(`/files/${id}/reprocess`), { success: 'Re-processed', invalidate: [['files']] });

  const upload = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    try {
      await uploadFiles(list, { scope: uploadScope, projectId: projectId || undefined, agentId: uploadScope === 'agent' ? uploadAgent : undefined });
      toast.push({ kind: 'success', text: `${list.length} file(s) uploaded – processing…` });
    } catch (e: any) {
      toast.push({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="File Manager"
        subtitle="Shared file storage. Documents are parsed locally (PDF, DOCX, XLSX, CSV, ZIP, text); audio/images/video use your configured media providers."
        actions={
          <>
            <select className="input w-40" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="">All scopes</option>
              <option value="global">Global</option>
              <option value="project">Project</option>
              <option value="mission">Mission attachments</option>
              <option value="agent">Agent</option>
            </select>
            <select className="input w-44" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">All projects</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </>
        }
      />
      <div
        className="card mb-5 flex flex-wrap items-center gap-3 border-dashed p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void upload(Array.from(e.dataTransfer.files));
        }}
      >
        <FileUp className="h-5 w-5 text-accent-400" />
        <span className="text-sm text-slate-400">Drop files here or</span>
        <input ref={input} type="file" multiple hidden onChange={(e) => (void upload(Array.from(e.target.files ?? [])), (e.target.value = ''))} />
        <button className="btn-primary btn-sm" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Spinner /> : 'Choose files'}
        </button>
        <span className="text-sm text-slate-500">Upload to</span>
        <select className="input h-8 w-36 py-0 text-xs" value={uploadScope} onChange={(e) => setUploadScope(e.target.value)}>
          <option value="project">{projectId ? 'selected project' : 'default project'}</option>
          <option value="global">global (all agents)</option>
          <option value="agent">one agent</option>
        </select>
        {uploadScope === 'agent' && (
          <select className="input h-8 w-40 py-0 text-xs" value={uploadAgent} onChange={(e) => setUploadAgent(e.target.value)}>
            <option value="">Select agent…</option>
            {(agents.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}
      </div>
      <Card pad={false}>
        {files.isLoading ? (
          <div className="p-4">
            <Spinner />
          </div>
        ) : !files.data?.length ? (
          <Empty title="No files" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="border-b border-white/5">
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2">Size</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Processing</th>
                <th className="px-3 py-2">Uploaded</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {files.data.map((f) => (
                <tr key={f.id} className="border-b border-white/5 hover:bg-white/[.02]">
                  <td className="max-w-[280px] truncate px-3 py-2 text-slate-200">{f.name}</td>
                  <td className="px-3 py-2 text-slate-400">{f.kind}</td>
                  <td className="px-3 py-2 text-slate-400">{fmtBytes(f.size)}</td>
                  <td className="px-3 py-2 text-slate-400">{f.scope}</td>
                  <td className="max-w-[320px] px-3 py-2">
                    <Badge className={STATUS_STYLE[f.extractionStatus]}>{f.extractionStatus}</Badge>
                    <div className="truncate text-xs text-slate-500" title={f.extractionNote ?? ''}>
                      {f.extractionNote}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-slate-500">{timeAgo(f.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button className="btn-ghost btn-sm" title="Preview" onClick={() => setPreview(f)}>
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                    <a className="btn-ghost btn-sm" title="Download" href={downloadUrl(`/files/${f.id}/download`)}>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                    <button className="btn-ghost btn-sm" title="Re-process" onClick={() => reprocess.mutate(f.id)}>
                      <RefreshCw className={cx('h-3.5 w-3.5', reprocess.isPending && 'animate-spin')} />
                    </button>
                    <button
                      className="btn-ghost btn-sm text-rose-300"
                      title="Delete"
                      onClick={async () => (await confirm({ title: 'Delete file?', message: `${f.name} will be permanently deleted from storage.`, danger: true, confirmText: 'Delete' })) && remove.mutate(f.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <PreviewModal file={preview} onClose={() => setPreview(null)} />
    </>
  );
}

function PreviewModal({ file, onClose }: { file: StoredFile | null; onClose: () => void }) {
  const text = useQuery({ queryKey: ['file-text', file?.id], queryFn: () => get<{ text: string | null }>(`/files/${file!.id}/text`), enabled: !!file });
  const src = file ? downloadUrl(`/files/${file.id}/download?inline=1`) : '';
  return (
    <Modal open={!!file} onClose={onClose} wide title={file?.name ?? ''}>
      {file?.kind === 'image' && <img src={src} alt={file.name} className="mb-3 max-h-80 rounded-lg" />}
      {file?.kind === 'audio' && <audio src={src} controls className="mb-3 w-full" />}
      {file?.kind === 'video' && <video src={src} controls className="mb-3 max-h-80 w-full rounded-lg" />}
      <div className="label">Extracted content</div>
      {text.isLoading ? <Spinner /> : <pre className="prose-output max-h-[50vh] overflow-auto rounded-lg bg-ink-950/60 p-3 text-xs">{text.data?.text || file?.extractionNote || 'No extracted text.'}</pre>}
    </Modal>
  );
}
