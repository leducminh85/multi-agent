import { describe, expect, it } from 'vitest';
import { embedBareMedia, mediaUrl, safeUrl } from './Markdown';

describe('embedBareMedia', () => {
  it('embeds bare local image / video paths below the line that mentions them', () => {
    const out = embedBareMedia(String.raw`Saved the chart to D:\data\workspaces\prj_1\out\chart.png for you.`);
    expect(out).toContain('![chart.png](<D:/data/workspaces/prj_1/out/chart.png>)');
    expect(embedBareMedia('Video: out/clip.mp4')).toContain('![clip.mp4](<out/clip.mp4>)');
    expect(embedBareMedia('See file:///C:/x/y/pic.webp')).toContain('![pic.webp](<file:///C:/x/y/pic.webp>)');
    expect(embedBareMedia('Ảnh: https://example.com/a/b.jpg')).toContain('![b.jpg](<https://example.com/a/b.jpg>)');
  });

  it('leaves existing Markdown images/links, code blocks and plain file names alone', () => {
    const md = '![logo](out/logo.png)\n[report](out/chart.png)';
    expect(embedBareMedia(md)).toBe(md);
    const code = '```\ncp out/a.png out/b.png\n```';
    expect(embedBareMedia(code)).toBe(code);
    expect(embedBareMedia('I would call it logo.png')).toBe('I would call it logo.png');
  });
});

describe('safeUrl', () => {
  it('keeps web, data-image and local paths but drops script URLs', () => {
    expect(safeUrl('https://x.org/a.png')).toBe('https://x.org/a.png');
    expect(safeUrl(String.raw`C:\a\b.png`)).toBe(String.raw`C:\a\b.png`);
    expect(safeUrl('out/b.png')).toBe('out/b.png');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('data:text/html,<script>')).toBe('');
  });
});

describe('mediaUrl', () => {
  it('routes local paths through the office media endpoint with the task context', () => {
    const u = mediaUrl('out/chart.png', { taskId: 'tsk_1' });
    expect(u.startsWith('/api/media?')).toBe(true);
    expect(u).toContain('path=out%2Fchart.png');
    expect(u).toContain('taskId=tsk_1');
    expect(mediaUrl('https://x.org/a.png')).toBe('https://x.org/a.png');
  });
});
