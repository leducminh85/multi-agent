import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture every CLI invocation instead of spawning real processes.
const calls: { command: string; args: string[]; stdin?: string; env?: Record<string, string | undefined> }[] = [];
let nextStdout = '';
vi.mock('../src/providers/cli.js', async (orig) => {
  const real: any = await orig();
  return {
    ...real,
    runCli: vi.fn(async (o: any) => {
      calls.push({ command: o.command, args: o.args, stdin: o.stdin, env: o.replaceEnv });
      return { stdout: nextStdout, stderr: '', code: 0 };
    }),
  };
});

const { antigravityCliAdapter, claudeCliAdapter } = await import('../src/providers/cliAdapters.js');
const { resolveClaudeCommand, NESTED_SESSION_ENV } = await import('../src/providers/claudeLocate.js');

const perms = (write = false) => ({
  knowledgeScopes: ['global'],
  fileAccess: 'project',
  allowCommandExecution: false,
  allowFileWrite: write,
  allowNetwork: false,
  canDelegate: true,
  canMessageAgents: true,
  requireApprovalForSensitiveActions: true,
});
const req = (write = false) => ({
  system: 'You are a researcher.',
  messages: [{ role: 'user' as const, content: 'Find 3 facts.' }],
  signal: new AbortController().signal,
  permissions: perms(write) as any,
  cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'mao-cli-')),
});

beforeEach(() => {
  calls.length = 0;
});

describe('Antigravity CLI adapter', () => {
  it('never uses plan mode for read-only agents (plan mode only drafts a plan instead of answering)', async () => {
    nextStdout = JSON.stringify({ status: 'SUCCESS', response: 'three facts', usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2 } });
    const r = await antigravityCliAdapter.run({ providerId: 'p', config: { command: 'agy' }, credentials: {} }, req(false));
    expect(r.text).toBe('three facts');
    expect(r.usage?.outputTokens).toBe(7);
    const args = calls[0].args;
    expect(args).not.toContain('plan');
    expect(args).not.toContain('--mode');
    expect(args).toContain('--sandbox');
    expect(args).toContain('--disable-slash-commands');
    expect(args.find((a) => a.startsWith('--print='))).toMatch(/final answer directly/);
  });

  it('uses accept-edits when the agent may write files', async () => {
    nextStdout = JSON.stringify({ status: 'SUCCESS', response: 'ok', usage: {} });
    await antigravityCliAdapter.run({ providerId: 'p', config: { command: 'agy' }, credentials: {} }, req(true));
    const args = calls[0].args;
    expect(args[args.indexOf('--mode') + 1]).toBe('accept-edits');
  });
});

describe('Claude Code CLI adapter', () => {
  it('turns "Not logged in" into a clear, non-retryable error', async () => {
    nextStdout = JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in · Please run /login', usage: {} });
    await expect(claudeCliAdapter.run({ providerId: 'p', config: { command: 'claude' }, credentials: {} }, req())).rejects.toMatchObject({
      message: expect.stringMatching(/not signed in/),
      retryable: false,
    });
  });

  it('runs read-only with tool restrictions and without nested-session variables', async () => {
    process.env.CLAUDECODE = '1';
    process.env.CLAUDE_CODE_ENTRYPOINT = 'sdk';
    nextStdout = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'answer', total_cost_usd: 0.01, usage: { input_tokens: 3, output_tokens: 4 } });
    const r = await claudeCliAdapter.run({ providerId: 'p', config: { command: 'claude' }, credentials: {} }, req());
    expect(r.text).toBe('answer');
    expect(r.costUsd).toBe(0.01);
    const c = calls[0];
    expect(c.args).toContain('-p');
    expect(c.args[c.args.indexOf('--disallowedTools') + 1]).toContain('Write');
    for (const k of NESTED_SESSION_ENV) expect(c.env?.[k]).toBeUndefined();
    delete process.env.CLAUDECODE;
    delete process.env.CLAUDE_CODE_ENTRYPOINT;
  });
});

describe('resolveClaudeCommand', () => {
  it('keeps an existing absolute path and falls back to a search when it disappeared', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mao-claude-'));
    const bin = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
    fs.writeFileSync(bin, '');
    expect(resolveClaudeCommand(bin)).toBe(bin);
    const gone = path.join(dir, 'missing', 'claude.exe');
    expect(resolveClaudeCommand(gone)).not.toBe(gone);
  });
});
