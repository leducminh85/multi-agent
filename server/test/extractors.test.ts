import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { detectKind, extractCsv, extractText, extractZip } from '../src/files/extractors.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mao-ext-'));

describe('file kind detection', () => {
  it.each([
    ['image/png', 'a.png', 'image'],
    ['audio/mpeg', 'a.mp3', 'audio'],
    ['video/mp4', 'a.mp4', 'video'],
    ['application/pdf', 'a.pdf', 'pdf'],
    ['application/octet-stream', 'a.docx', 'docx'],
    ['application/octet-stream', 'a.xlsx', 'xlsx'],
    ['text/csv', 'a.csv', 'csv'],
    ['application/zip', 'a.zip', 'zip'],
    ['application/octet-stream', 'main.py', 'text'],
    ['application/octet-stream', 'blob.bin', 'other'],
  ])('%s %s → %s', (mime, name, kind) => {
    expect(detectKind(mime, name)).toBe(kind);
  });
});

describe('extractors', () => {
  it('reads text and refuses binary', () => {
    const t = path.join(tmp, 'a.md');
    fs.writeFileSync(t, '# Xin chào');
    expect(extractText(t).text).toBe('# Xin chào');
    const b = path.join(tmp, 'b.txt');
    fs.writeFileSync(b, Buffer.from([1, 0, 2, 3]));
    expect(extractText(b).text).toBe('');
  });

  it('summarises CSV', () => {
    const c = path.join(tmp, 'c.csv');
    fs.writeFileSync(c, 'a,b,c\n1,2,3\n4,5,6\n');
    expect(extractCsv(c).note).toBe('3 lines, ~3 columns');
  });

  it('lists ZIP entries and extracts text files', async () => {
    const zip = new JSZip();
    zip.file('src/index.ts', 'export const x = 1;');
    zip.file('img.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const z = path.join(tmp, 'z.zip');
    fs.writeFileSync(z, await zip.generateAsync({ type: 'nodebuffer' }));
    const r = await extractZip(z);
    expect(r.text).toContain('src/index.ts');
    expect(r.text).toContain('img.png');
    expect(r.text).toContain('export const x = 1;');
    expect(r.note).toBe('2 files, 1 text files extracted');
  });
});
