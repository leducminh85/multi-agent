import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Database } from '../db/database.js';
import type { ActivityService } from '../core/activity.js';
import type { EventBus } from '../core/eventBus.js';
import type { SettingsService } from '../core/settings.js';
import { HttpError, errorMessage, newId, notFound, nowIso } from '../core/util.js';
import type { ProviderService } from '../providers/service.js';
import type { ProviderAdapter } from '../providers/types.js';
import type { UsageService } from '../usage/service.js';
import { detectKind, extractCsv, extractDocx, extractPdf, extractText, extractXlsx, extractZip, type FileKind } from './extractors.js';
import { Ffmpeg } from './media.js';

export type FileScope = 'global' | 'project' | 'agent' | 'mission';
export type ExtractionStatus = 'pending' | 'processing' | 'done' | 'failed' | 'unsupported' | 'stored';

export interface StoredFile {
  id: string;
  scope: FileScope;
  projectId: string | null;
  agentId: string | null;
  missionId: string | null;
  name: string;
  mime: string;
  size: number;
  sha256: string;
  kind: FileKind;
  extractionStatus: ExtractionStatus;
  extractionNote: string | null;
  hasText: boolean;
  createdAt: string;
}

export interface IngestInput {
  tempPath: string;
  originalName: string;
  mime: string;
  scope: FileScope;
  projectId?: string | null;
  agentId?: string | null;
  missionId?: string | null;
  uploadedBy?: string;
}

const INLINE_IMAGE_LIMIT = 5 * 1024 * 1024;
const TRANSCRIBE_LIMIT = 24 * 1024 * 1024;

/**
 * File storage + multimodal processing pipeline.
 * Documents are parsed locally; audio/image/video understanding is delegated to a configured
 * provider (Settings → Media). Every result records which method/provider produced it.
 */
export class FileService {
  private ffmpeg: Ffmpeg;
  private processing = new Map<string, Promise<void>>();

  constructor(
    private db: Database,
    private bus: EventBus,
    private storageDir: string,
    private settings: SettingsService,
    private providers: ProviderService,
    private usage: UsageService,
    private activity: ActivityService,
    ffmpegPath: string,
  ) {
    this.ffmpeg = new Ffmpeg(ffmpegPath);
  }

  private map(r: any): StoredFile {
    return {
      id: r.id,
      scope: r.scope,
      projectId: r.project_id,
      agentId: r.agent_id,
      missionId: r.mission_id,
      name: r.name,
      mime: r.mime,
      size: r.size,
      sha256: r.sha256,
      kind: r.kind,
      extractionStatus: r.extraction_status,
      extractionNote: r.extraction_note,
      hasText: !!r.has_text,
      createdAt: r.created_at,
    };
  }

  private static COLS = `id, scope, project_id, agent_id, mission_id, name, mime, size, sha256, kind, extraction_status, extraction_note,
    (extracted_text IS NOT NULL AND length(extracted_text) > 0) AS has_text, created_at`;

  ingest(input: IngestInput): StoredFile {
    const id = newId('fil');
    const safeName = path.basename(input.originalName).replace(/[^\p{L}\p{N}._\- ]/gu, '_').slice(0, 180) || 'file';
    const dir = path.join(this.storageDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, safeName);
    fs.copyFileSync(input.tempPath, dest);
    fs.rmSync(input.tempPath, { force: true });
    const buf = fs.readFileSync(dest);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const kind = detectKind(input.mime || 'application/octet-stream', safeName);
    this.db.run(
      `INSERT INTO files (id, scope, project_id, agent_id, mission_id, name, mime, size, sha256, storage_path, kind, extraction_status, uploaded_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id,
        input.scope,
        input.projectId ?? null,
        input.agentId ?? null,
        input.missionId ?? null,
        safeName,
        input.mime || 'application/octet-stream',
        buf.length,
        sha,
        path.relative(this.storageDir, dest),
        kind,
        'pending',
        input.uploadedBy ?? null,
        nowIso(),
      ],
    );
    const p = this.process(id).finally(() => this.processing.delete(id));
    this.processing.set(id, p);
    const f = this.get(id);
    this.bus.publish('file.updated', f);
    return f;
  }

  list(filter: { scope?: FileScope; projectId?: string; agentId?: string; missionId?: string } = {}): StoredFile[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.scope) (where.push('scope = ?'), params.push(filter.scope));
    if (filter.projectId) (where.push('project_id = ?'), params.push(filter.projectId));
    if (filter.agentId) (where.push('agent_id = ?'), params.push(filter.agentId));
    if (filter.missionId) (where.push('mission_id = ?'), params.push(filter.missionId));
    return this.db
      .all(`SELECT ${FileService.COLS} FROM files ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT 1000`, params)
      .map((r) => this.map(r));
  }

  get(id: string): StoredFile {
    const r = this.db.get(`SELECT ${FileService.COLS} FROM files WHERE id = ?`, [id]);
    if (!r) throw notFound('File');
    return this.map(r);
  }

  text(id: string): string | null {
    return this.db.get<{ t: string | null }>('SELECT extracted_text AS t FROM files WHERE id = ?', [id])?.t ?? null;
  }

  absolutePath(id: string): string {
    const r = this.db.get<{ storage_path: string }>('SELECT storage_path FROM files WHERE id = ?', [id]);
    if (!r) throw notFound('File');
    const full = path.resolve(this.storageDir, r.storage_path);
    if (!full.startsWith(path.resolve(this.storageDir))) throw new HttpError(500, 'Corrupt storage path');
    return full;
  }

  imageBase64(id: string): { mime: string; base64: string; name: string } | null {
    const f = this.get(id);
    if (f.kind !== 'image' || f.size > INLINE_IMAGE_LIMIT) return null;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(f.mime)) return null;
    return { mime: f.mime === 'image/jpg' ? 'image/jpeg' : f.mime, base64: fs.readFileSync(this.absolutePath(id)).toString('base64'), name: f.name };
  }

  delete(id: string): void {
    const full = this.absolutePath(id);
    this.db.run('DELETE FROM files WHERE id = ?', [id]);
    fs.rmSync(path.dirname(full), { recursive: true, force: true });
    this.bus.publish('file.updated', { id, deleted: true });
  }

  async waitFor(ids: string[], timeoutMs = 10 * 60_000): Promise<void> {
    const pending = ids.map((id) => this.processing.get(id)).filter(Boolean) as Promise<void>[];
    if (!pending.length) return;
    await Promise.race([Promise.allSettled(pending), new Promise((r) => setTimeout(r, timeoutMs))]);
  }

  async reprocess(id: string): Promise<StoredFile> {
    await this.process(id);
    return this.get(id);
  }

  private setResult(id: string, status: ExtractionStatus, note: string, text?: string | null) {
    this.db.run('UPDATE files SET extraction_status = ?, extraction_note = ?, extracted_text = COALESCE(?, extracted_text) WHERE id = ?', [
      status,
      note,
      text ?? null,
      id,
    ]);
    this.bus.publish('file.updated', this.get(id));
  }

  private pickProvider(kind: 'transcribe' | 'vision'): { id: string; adapter: ProviderAdapter } | null {
    const media = this.settings.get('media');
    const preferred = kind === 'transcribe' ? media.transcriptionProviderId : media.visionProviderId;
    const candidates = this.providers.list().filter((p) => p.enabled && p.status !== 'error');
    const ordered = preferred ? [...candidates.filter((p) => p.id === preferred), ...candidates.filter((p) => p.id !== preferred)] : candidates;
    for (const p of ordered) {
      const adapter = this.providers.registry.get(p.type);
      if (kind === 'transcribe' && adapter.transcribe) return { id: p.id, adapter };
      if (kind === 'vision' && adapter.describeMedia) return { id: p.id, adapter };
    }
    return null;
  }

  private async process(id: string): Promise<void> {
    const f = this.get(id);
    const file = this.absolutePath(id);
    this.db.run("UPDATE files SET extraction_status = 'processing' WHERE id = ?", [id]);
    try {
      switch (f.kind) {
        case 'pdf': {
          const r = await extractPdf(file);
          return this.setResult(id, r.text ? 'done' : 'failed', `PDF parsed locally – ${r.note}`, r.text);
        }
        case 'docx': {
          const r = await extractDocx(file);
          return this.setResult(id, 'done', `DOCX parsed locally – ${r.note}`, r.text);
        }
        case 'xlsx': {
          const r = await extractXlsx(file);
          return this.setResult(id, 'done', `Spreadsheet parsed locally – ${r.note}`, r.text);
        }
        case 'csv': {
          const r = extractCsv(file);
          return this.setResult(id, 'done', `CSV – ${r.note}`, r.text);
        }
        case 'zip': {
          const r = await extractZip(file);
          return this.setResult(id, 'done', `ZIP – ${r.note}`, r.text);
        }
        case 'text': {
          const r = extractText(file);
          return this.setResult(id, r.text ? 'done' : 'unsupported', r.note, r.text);
        }
        case 'image':
          return await this.processImage(f, file);
        case 'audio':
          return await this.processAudio(f, file);
        case 'video':
          return await this.processVideo(f, file);
        default:
          return this.setResult(id, 'stored', 'Stored. No parser for this file type – agents receive its name and metadata only.');
      }
    } catch (e) {
      this.setResult(id, 'failed', `Extraction failed: ${errorMessage(e)}`);
    }
  }

  private async processImage(f: StoredFile, file: string) {
    const vision = this.pickProvider('vision');
    if (!vision) {
      return this.setResult(f.id, 'stored', 'Stored. Passed as an image to vision-capable agents. Configure a vision provider (Settings → Media) for text descriptions.');
    }
    const img = this.imageBase64(f.id);
    if (!img) return this.setResult(f.id, 'stored', 'Stored (format/size not supported for inline vision).');
    const ctx = this.providers.context(vision.id);
    const r = await vision.adapter.describeMedia!(ctx, img, 'Describe this image in detail. Transcribe any visible text exactly. Mention charts, UI elements, diagrams and their data.');
    this.usage.record({ providerId: vision.id, providerType: ctx.type, model: r.model, usage: r.usage, source: 'api_response' });
    this.setResult(f.id, 'done', `Image described by ${ctx.name}${r.model ? ` (${r.model})` : ''}`, `[Image description]\n${r.text}`);
  }

  private async transcribeFile(f: StoredFile, audioPath: string, mime: string): Promise<{ text: string; via: string } | null> {
    const tr = this.pickProvider('transcribe');
    if (!tr) return null;
    let p = audioPath;
    let m = mime;
    if (fs.statSync(p).size > TRANSCRIBE_LIMIT && (await this.ffmpeg.isAvailable())) {
      const out = await this.ffmpeg.extractAudio(p, path.join(path.dirname(p), '.derived'));
      if (out) {
        p = out;
        m = 'audio/mpeg';
      }
    }
    if (fs.statSync(p).size > TRANSCRIBE_LIMIT) throw new Error('Audio exceeds 24 MB even after compression (install ffmpeg to compress)');
    const ctx = this.providers.context(tr.id);
    const r = await tr.adapter.transcribe!(ctx, { path: p, mime: m, name: path.basename(p) });
    this.usage.record({ providerId: tr.id, providerType: ctx.type, model: r.model, usage: r.usage, source: 'api_response' });
    return { text: r.text, via: `${ctx.name}${r.model ? ` (${r.model})` : ''}` };
  }

  private async processAudio(f: StoredFile, file: string) {
    const r = await this.transcribeFile(f, file, f.mime);
    if (!r) return this.setResult(f.id, 'unsupported', 'No transcription provider configured (add OpenAI API or Gemini API and select it in Settings → Media).');
    this.setResult(f.id, 'done', `Transcribed by ${r.via}`, `[Audio transcript]\n${r.text}`);
  }

  private async processVideo(f: StoredFile, file: string) {
    const parts: string[] = [];
    const notes: string[] = [];
    if (await this.ffmpeg.isAvailable()) {
      const derived = path.join(path.dirname(file), '.derived');
      const dur = await this.ffmpeg.durationSeconds(file);
      if (dur) parts.push(`[Video duration] ${Math.round(dur)} s`);
      const audio = await this.ffmpeg.extractAudio(file, derived);
      if (audio) {
        try {
          const t = await this.transcribeFile(f, audio, 'audio/mpeg');
          if (t) {
            parts.push(`[Audio transcript]\n${t.text}`);
            notes.push(`audio transcribed by ${t.via}`);
          } else notes.push('no transcription provider');
        } catch (e) {
          notes.push(`transcription failed: ${errorMessage(e)}`);
        }
      } else notes.push('no audio track');
      const vision = this.pickProvider('vision');
      if (vision) {
        const frames = await this.ffmpeg.extractFrames(file, derived, 4);
        const ctx = this.providers.context(vision.id);
        for (const [i, frame] of frames.entries()) {
          const r = await vision.adapter.describeMedia!(
            ctx,
            { mime: 'image/jpeg', base64: fs.readFileSync(frame).toString('base64') },
            'This is a key frame from a video. Describe what is shown, including any on-screen text.',
          );
          this.usage.record({ providerId: vision.id, providerType: ctx.type, model: r.model, usage: r.usage, source: 'api_response' });
          parts.push(`[Key frame ${i + 1}/${frames.length}]\n${r.text}`);
        }
        notes.push(`${frames.length} key frames described by ${ctx.name}`);
      } else notes.push('no vision provider for key frames');
    } else {
      // No ffmpeg: Gemini can analyse small videos natively.
      const vision = this.pickProvider('vision');
      const ctx = vision ? this.providers.context(vision.id) : null;
      if (vision && ctx?.type === 'gemini-api' && f.size < 18 * 1024 * 1024) {
        const r = await vision.adapter.describeMedia!(
          ctx,
          { mime: f.mime, base64: fs.readFileSync(file).toString('base64') },
          'Analyse this video: describe scenes, actions and on-screen text, and transcribe the speech.',
        );
        this.usage.record({ providerId: vision.id, providerType: ctx.type, model: r.model, usage: r.usage, source: 'api_response' });
        parts.push(`[Video analysis]\n${r.text}`);
        notes.push(`analysed natively by ${ctx.name}`);
      } else {
        return this.setResult(f.id, 'unsupported', 'Video analysis needs ffmpeg (+ transcription/vision provider) or a Gemini provider for videos < 18 MB.');
      }
    }
    const text = parts.join('\n\n');
    this.setResult(f.id, text ? 'done' : 'unsupported', `Video processed: ${notes.join('; ')}`, text || null);
  }
}
