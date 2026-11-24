import fs from 'node:fs';
import path from 'node:path';
import spawn from 'cross-spawn';

/** Thin ffmpeg/ffprobe wrapper used for audio normalisation and video analysis. */
export class Ffmpeg {
  private available: boolean | null = null;

  constructor(private bin: string) {}

  private exec(bin: string, args: string[], timeoutMs = 10 * 60_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn(bin, args, { windowsHide: true });
      let stdout = '';
      let stderr = '';
      const t = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      child.stdout?.on('data', (d) => (stdout += d));
      child.stderr?.on('data', (d) => {
        stderr += d;
        if (stderr.length > 50_000) stderr = stderr.slice(-20_000);
      });
      child.on('error', () => {
        clearTimeout(t);
        resolve({ code: -1, stdout, stderr: stderr || 'spawn failed' });
      });
      child.on('close', (code) => {
        clearTimeout(t);
        resolve({ code, stdout, stderr });
      });
    });
  }

  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;
    const r = await this.exec(this.bin, ['-version'], 15000);
    this.available = r.code === 0;
    return this.available;
  }

  async durationSeconds(file: string): Promise<number | null> {
    const r = await this.exec(this.bin, ['-i', file, '-hide_banner'], 30000);
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }

  /** Mono 16 kHz MP3 – small enough for transcription APIs. */
  async extractAudio(input: string, outDir: string): Promise<string | null> {
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, 'audio.mp3');
    const r = await this.exec(this.bin, ['-y', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out]);
    return r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0 ? out : null;
  }

  /** Evenly spaced key frames as JPEG. */
  async extractFrames(input: string, outDir: string, count: number): Promise<string[]> {
    fs.mkdirSync(outDir, { recursive: true });
    const duration = (await this.durationSeconds(input)) ?? 0;
    const frames: string[] = [];
    for (let i = 0; i < count; i++) {
      const ts = duration > 0 ? (duration * (i + 0.5)) / count : i;
      const out = path.join(outDir, `frame-${i + 1}.jpg`);
      const r = await this.exec(this.bin, ['-y', '-ss', ts.toFixed(2), '-i', input, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', out], 60000);
      if (r.code === 0 && fs.existsSync(out)) frames.push(out);
    }
    return frames;
  }
}
