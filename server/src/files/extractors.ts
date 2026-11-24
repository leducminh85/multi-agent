import fs from 'node:fs';
import path from 'node:path';

export type FileKind = 'image' | 'audio' | 'video' | 'pdf' | 'docx' | 'xlsx' | 'csv' | 'zip' | 'text' | 'other';

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'yaml', 'yml', 'xml', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'c', 'h', 'cpp', 'hpp', 'cs', 'swift', 'sql', 'sh', 'ps1', 'bat', 'toml', 'ini',
  'env', 'log', 'tsv', 'vue', 'svelte', 'scss', 'less', 'graphql', 'proto', 'dockerfile', 'gitignore', 'srt', 'vtt', 'rtf', 'tex',
]);

export function detectKind(mime: string, name: string): FileKind {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'webm_audio', 'aac', 'opus'].includes(ext)) return 'audio';
  if (mime.startsWith('video/') || ['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v'].includes(ext)) return mime.startsWith('audio/') ? 'audio' : 'video';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (ext === 'docx' || mime.includes('wordprocessingml')) return 'docx';
  if (ext === 'xlsx' || ext === 'xlsm' || mime.includes('spreadsheetml')) return 'xlsx';
  if (ext === 'csv' || mime === 'text/csv') return 'csv';
  if (ext === 'zip' || mime === 'application/zip' || mime === 'application/x-zip-compressed') return 'zip';
  if (mime.startsWith('text/') || TEXT_EXT.has(ext) || mime === 'application/json' || mime === 'application/xml') return 'text';
  return 'other';
}

export const MAX_EXTRACT_CHARS = 400_000;

function clip(s: string): string {
  return s.length > MAX_EXTRACT_CHARS ? `${s.slice(0, MAX_EXTRACT_CHARS)}\n…[truncated – original ${s.length} chars]` : s;
}

export async function extractPdf(file: string): Promise<{ text: string; note: string }> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
  const { totalPages, text } = await extractText(pdf, { mergePages: true });
  const t = Array.isArray(text) ? text.join('\n\n') : text;
  if (!t.trim()) return { text: '', note: `PDF has ${totalPages} pages but no extractable text layer (scanned document – OCR not available)` };
  return { text: clip(t), note: `${totalPages} pages` };
}

export async function extractDocx(file: string): Promise<{ text: string; note: string }> {
  const mammoth = await import('mammoth');
  const r = await mammoth.extractRawText({ buffer: fs.readFileSync(file) });
  return { text: clip(r.value), note: r.messages.length ? `${r.messages.length} conversion warnings` : 'ok' };
}

export async function extractXlsx(file: string): Promise<{ text: string; note: string }> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const parts: string[] = [];
  const MAX_ROWS = 3000;
  wb.eachSheet((ws) => {
    parts.push(`### Sheet: ${ws.name} (${ws.rowCount} rows × ${ws.columnCount} cols)`);
    let n = 0;
    ws.eachRow({ includeEmpty: false }, (row) => {
      if (n++ >= MAX_ROWS) return;
      const values = (row.values as unknown[]).slice(1).map((v) => cellText(v));
      parts.push(values.map(csvEscape).join(','));
    });
    if (ws.rowCount > MAX_ROWS) parts.push(`…[${ws.rowCount - MAX_ROWS} more rows not included]`);
  });
  return { text: clip(parts.join('\n')), note: `${wb.worksheets.length} sheets` };
}

function cellText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as any;
    if (o.result !== undefined) return String(o.result);
    if (o.text !== undefined) return String(o.text);
    if (o.richText) return o.richText.map((r: any) => r.text).join('');
    if (o.hyperlink) return String(o.text ?? o.hyperlink);
    return JSON.stringify(o);
  }
  return String(v);
}

const csvEscape = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function extractCsv(file: string): { text: string; note: string } {
  const raw = fs.readFileSync(file, 'utf8');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const cols = lines[0] ? lines[0].split(',').length : 0;
  return { text: clip(raw), note: `${lines.length} lines, ~${cols} columns` };
}

export function extractText(file: string): { text: string; note: string } {
  const buf = fs.readFileSync(file);
  if (buf.subarray(0, 8000).includes(0)) return { text: '', note: 'binary content – not extracted' };
  return { text: clip(buf.toString('utf8')), note: 'ok' };
}

export async function extractZip(file: string): Promise<{ text: string; note: string }> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const entries = Object.values(zip.files);
  const listing: string[] = [];
  const contents: string[] = [];
  let budget = 200_000;
  for (const e of entries) {
    if (e.dir) continue;
    const size = (e as any)._data?.uncompressedSize ?? 0;
    listing.push(`- ${e.name}${size ? ` (${size} bytes)` : ''}`);
    const kind = detectKind('', e.name);
    if ((kind === 'text' || kind === 'csv') && budget > 0 && !e.name.includes('node_modules/')) {
      const text = await e.async('string');
      if (text.includes('\u0000')) continue;
      const chunk = text.slice(0, Math.min(budget, 20_000));
      contents.push(`=== ${e.name} ===\n${chunk}${text.length > chunk.length ? '\n…[truncated]' : ''}`);
      budget -= chunk.length;
    }
  }
  return {
    text: clip(`Archive contents (${listing.length} files):\n${listing.join('\n')}\n\n${contents.join('\n\n')}`),
    note: `${listing.length} files, ${contents.length} text files extracted`,
  };
}
