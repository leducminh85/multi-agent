import { downloadUrl } from '../lib/api';

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
const VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i;
const AUDIO = /\.(mp3|wav|ogg|m4a|webm|flac)$/i;

/** Files attached to a message: images and videos are shown inline, other files as download chips. */
export default function Attachments({ items, className }: { items: { fileId: string; name: string }[]; className?: string }) {
  if (!items.length) return null;
  const inline = (id: string) => downloadUrl(`/files/${id}/download?inline=1`);
  return (
    <div className={className ?? 'mt-1.5 flex flex-wrap gap-1.5'}>
      {items.map((a) =>
        IMAGE.test(a.name) ? (
          <a key={a.fileId} href={inline(a.fileId)} target="_blank" rel="noreferrer" title={a.name} className="block">
            <img src={inline(a.fileId)} alt={a.name} loading="lazy" className="max-h-48 max-w-[16rem] rounded-lg border border-white/10 object-cover" />
          </a>
        ) : VIDEO.test(a.name) && !/^voice-/.test(a.name) ? (
          <video key={a.fileId} controls preload="metadata" src={inline(a.fileId)} className="max-h-60 max-w-xs rounded-lg border border-white/10 bg-black" />
        ) : AUDIO.test(a.name) ? (
          <audio key={a.fileId} controls src={inline(a.fileId)} className="h-9 max-w-xs" title={a.name} />
        ) : (
          <a
            key={a.fileId}
            href={downloadUrl(`/files/${a.fileId}/download`)}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-400 hover:text-white"
          >
            📎 {a.name}
          </a>
        ),
      )}
    </div>
  );
}
