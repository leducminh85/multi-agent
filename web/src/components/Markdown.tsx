import { memo, useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { downloadUrl } from '../lib/api';
import { cx } from './ui';

/** Where relative paths in agent output live (the project workspace of this task / mission). */
export interface MediaContext {
  taskId?: string | null;
  missionId?: string | null;
  projectId?: string | null;
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?.*)?$/i;
const VIDEO = /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i;
const AUDIO = /\.(mp3|wav|ogg|m4a|flac)(\?.*)?$/i;
const isRemote = (u: string) => /^(https?:|data:|blob:|mailto:|#)/i.test(u);
/** Title marking media found in plain text (not an explicit Markdown image): hidden if it cannot be loaded. */
const AUTO = 'mao:auto';
const isMedia =(u: string) => IMAGE.test(u) || VIDEO.test(u) || !!youtubeId(u) || !!vimeoId(u);

/**
 * Keep local paths (Windows drive letters would otherwise be read as a URL scheme and dropped) but never allow
 * script URLs: only http(s), mailto, data:image/*, anchors and plain paths pass.
 */
export function safeUrl(url: string): string {
  const u = url.trim();
  if (/^(https?:|mailto:|#)/i.test(u)) return u;
  if (/^data:image\/(png|jpe?g|gif|webp);/i.test(u)) return u;
  if (/^file:\/\//i.test(u) || /^[A-Za-z]:[\\/]/.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return ''; // javascript:, vbscript:, data:text/html …
  return u;
}

/** Turn an agent's local path into a URL the office serves (only inside the workspaces – enforced server-side). */
export function mediaUrl(src: string, ctx: MediaContext = {}): string {
  if (!src || isRemote(src)) return src;
  const qs = new URLSearchParams({ path: src.replace(/^<|>$/g, '') });
  if (ctx.projectId) qs.set('projectId', ctx.projectId);
  if (ctx.taskId) qs.set('taskId', ctx.taskId);
  if (ctx.missionId) qs.set('missionId', ctx.missionId);
  return downloadUrl(`/media?${qs.toString()}`);
}

function youtubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/i);
  return m ? m[1] : null;
}
function vimeoId(url: string): string | null {
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d{6,})/i);
  return m ? m[1] : null;
}

// Paths to media files mentioned in plain text: file:// URLs, absolute Windows/Unix paths, or relative paths with a folder.
const MEDIA_EXT = '(?:png|jpe?g|gif|webp|svg|bmp|avif|mp4|webm|mov|m4v)';
const BARE_MEDIA = new RegExp(
  `(?:file:///[^\\s)\\]'"<>]+?|[A-Za-z]:[\\\\/][^\\s)\\]'"<>*?|]+?|(?:\\.{1,2}/|/)?[\\w.-]+(?:[\\\\/][\\w.-]+)+?|https?://[^\\s)\\]'"<>]+?)\\.${MEDIA_EXT}(?![\\w])`,
  'gi',
);

/**
 * Agents often answer with a bare path ("saved to D:\\...\\chart.png") instead of Markdown. Show such media inline:
 * every media path on a line that is not already a Markdown image/link is appended below that line as an image.
 * Fenced code blocks are left untouched.
 */
export function embedBareMedia(md: string): string {
  let inFence = false;
  const out: string[] = [];
  for (const line of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    out.push(line);
    if (inFence) continue;
    const found = new Set<string>();
    for (const m of line.matchAll(BARE_MEDIA)) {
      // Already the target of a Markdown image/link: ](path) or ](<path>)
      if (/\]\(<?$/.test(line.slice(0, m.index))) continue;
      found.add(m[0]);
    }
    for (const p of found) {
      const already = md.includes(`](${p})`) || md.includes(`](<${p}>)`);
      if (already) continue;
      const name = p.split(/[\\/]/).pop() ?? 'media';
      out.push('', `![${name}](<${p.replace(/\\/g, '/')}> "${AUTO}")`, '');
    }
  }
  return out.join('\n');
}

/**
 * A YouTube / Vimeo video: shows the thumbnail with a play button and loads the real player only on click,
 * so a chat full of video links stays light.
 */
function VideoEmbed({ yt, vm, title }: { yt: string | null; vm: string | null; title?: string }) {
  const [play, setPlay] = useState(false);
  const box = 'my-2 block aspect-video w-full max-w-xl overflow-hidden rounded-lg border border-white/10 bg-black';
  if (play || !yt)
    return (
      <span className={box}>
        <iframe
          className="h-full w-full"
          src={yt ? `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1` : `https://player.vimeo.com/video/${vm}`}
          title={title || 'video'}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          // YouTube refuses to play without a Referer (error 153); the app itself sends no-referrer.
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </span>
    );
  return (
    <button type="button" onClick={() => setPlay(true)} className={cx(box, 'group relative')} title={title || 'Play video'}>
      <img src={`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`} alt={title ?? ''} loading="lazy" className="h-full w-full object-cover opacity-90 group-hover:opacity-100" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-12 w-16 items-center justify-center rounded-xl bg-red-600/90 text-2xl text-white shadow-lg group-hover:bg-red-600">▶</span>
      </span>
    </button>
  );
}

/** Video links (YouTube / Vimeo) mentioned inside sentences – shown as players below the message. */
export function inlineVideos(md: string, max = 2): string[] {
  const urls = md.match(/https?:\/\/[^\s)\]'"<>]+/g) ?? [];
  const standalone = new Set(
    md
      .split('\n')
      .map((l) => l.trim().replace(/^<|>$/g, '').replace(/^\[[^\]]*\]\((.+)\)$/, '$1'))
      .filter((l) => /^https?:\/\/\S+$/.test(l))
      .map((l) => youtubeId(l) ?? vimeoId(l)),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    const id = youtubeId(u) ?? vimeoId(u);
    if (!id || seen.has(id) || standalone.has(id)) continue;
    seen.add(id);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

function Media({ src, alt, ctx, quiet }: { src: string; alt?: string; ctx: MediaContext; quiet?: boolean }) {
  const [broken, setBroken] = useState(false);
  const url = mediaUrl(src, ctx);
  const yt = youtubeId(src);
  const vm = vimeoId(src);
  if (yt || vm) return <VideoEmbed yt={yt} vm={vm} title={alt} />;
  if (broken && quiet) return null;
  if (broken)
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded border border-white/10 px-1.5 py-0.5 text-xs text-slate-400">
        {VIDEO.test(src) ? '▶' : '🖼'} {alt || src.split(/[\\/]/).pop()} <span className="text-slate-600">(cannot be shown)</span>
      </a>
    );
  if (VIDEO.test(src)) return <video controls preload="metadata" src={url} className="my-2 block max-h-[420px] w-full max-w-2xl rounded-lg border border-white/10 bg-black" onError={() => setBroken(true)} />;
  if (AUDIO.test(src)) return <audio controls src={url} className="my-2 block w-full max-w-md" onError={() => setBroken(true)} />;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="my-2 block w-fit">
      <img src={url} alt={alt ?? ''} loading="lazy" className="max-h-[420px] max-w-full rounded-lg border border-white/10 bg-ink-950 object-contain" onError={() => setBroken(true)} />
      {alt && <span className="mt-0.5 block text-[11px] text-slate-500">{alt}</span>}
    </a>
  );
}

/** Renders agent output: Markdown (GFM tables, task lists…) with images / videos / YouTube shown inline. */
function MarkdownImpl({ text, ctx = {}, className }: { text: string; ctx?: MediaContext; className?: string }) {
  const components: Components = {
    img: ({ src, alt, title }) => (src ? <Media src={String(src)} alt={alt} ctx={ctx} quiet={title === AUTO} /> : null),
    // A paragraph that is only a link to media (on its own line) shows the media itself.
    p: ({ node, children }) => {
      const kids = (node?.children ?? []).filter((c: any) => !(c.type === 'text' && !c.value.trim()));
      const only = kids.length === 1 && kids[0].type === 'element' && (kids[0] as any).tagName === 'a' ? String((kids[0] as any).properties?.href ?? '') : '';
      if (only && isMedia(only)) {
        const label = (kids[0] as any).children?.[0]?.value;
        return <div className="my-1">{<Media src={only} alt={label && label !== only ? label : undefined} ctx={ctx} />}</div>;
      }
      return <p>{children}</p>;
    },
    a: ({ href, children }) => {
      const h = String(href ?? '');
      // Inside a sentence a media link stays a link (with an icon) so the text is not broken up by a player.
      const icon = youtubeId(h) || vimeoId(h) || VIDEO.test(h) ? '▶ ' : IMAGE.test(h) ? '🖼 ' : '';
      return (
        <a href={isRemote(h) ? h : mediaUrl(h, ctx)} target="_blank" rel="noreferrer">
          {icon}
          {children}
        </a>
      );
    },
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto">
        <table>{children}</table>
      </div>
    ),
  };
  return (
    <div translate="no" className={cx('md', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} urlTransform={safeUrl}>
        {embedBareMedia(text)}
      </ReactMarkdown>
      {inlineVideos(text).map((u) => (
        <Media key={u} src={u} ctx={ctx} />
      ))}
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
export default Markdown;
