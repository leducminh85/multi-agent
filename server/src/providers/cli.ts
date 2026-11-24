import spawn from 'cross-spawn';
import { ProviderError } from './types.js';

export interface CliRunOptions {
  command: string;
  args: string[];
  stdin?: string;
  cwd?: string;
  signal: AbortSignal;
  timeoutMs: number;
  env?: Record<string, string>;
  onStdoutLine?: (line: string) => void;
}

export interface CliRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Spawn a CLI process with cancellation + timeout. The process is killed on abort. */
export function runCli(opts: CliRunOptions): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) return reject(new ProviderError('Request cancelled', false));
    let child;
    try {
      child = spawn(opts.command, opts.args, {
        cwd: opts.cwd,
        env: { ...process.env, ...opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e: any) {
      return reject(new ProviderError(`Cannot start "${opts.command}": ${e?.message ?? e}`, false));
    }
    let stdout = '';
    let stderr = '';
    let lineBuf = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal.removeEventListener('abort', onAbort);
      fn();
    };
    const kill = () => {
      try {
        child.kill('SIGTERM');
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }, 3000).unref();
      } catch {
        /* ignore */
      }
    };
    const onAbort = () => {
      kill();
      finish(() => reject(new ProviderError('Request cancelled', false)));
    };
    opts.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => {
      kill();
      finish(() => reject(new ProviderError(`CLI timed out after ${Math.round(opts.timeoutMs / 1000)} s`, true)));
    }, opts.timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (d: string) => {
      stdout += d;
      if (opts.onStdoutLine) {
        lineBuf += d;
        let i: number;
        while ((i = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, i).trim();
          lineBuf = lineBuf.slice(i + 1);
          if (line) opts.onStdoutLine(line);
        }
      }
    });
    child.stderr?.on('data', (d: string) => {
      stderr += d;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', (e: any) => {
      const msg = e?.code === 'ENOENT' ? `Command "${opts.command}" not found – is the CLI installed and on PATH?` : e?.message;
      finish(() => reject(new ProviderError(msg, false)));
    });
    child.on('close', (code: number | null) => {
      if (opts.onStdoutLine && lineBuf.trim()) opts.onStdoutLine(lineBuf.trim());
      finish(() => resolve({ stdout, stderr, code }));
    });
    if (opts.stdin !== undefined) {
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(opts.stdin, 'utf8');
    } else child.stdin?.end();
  });
}

/** Model / identifier values passed as CLI args must be simple tokens. */
export function safeArg(value: string | undefined, what: string): string | undefined {
  if (!value) return undefined;
  if (!/^[A-Za-z0-9._:/@\-[\]]{1,120}$/.test(value)) throw new ProviderError(`Invalid ${what}: ${value}`, false);
  return value;
}

export async function cliVersion(command: string): Promise<string> {
  const ctrl = new AbortController();
  const r = await runCli({ command, args: ['--version'], signal: ctrl.signal, timeoutMs: 20000 });
  if (r.code !== 0) throw new ProviderError((r.stderr || r.stdout || `exit ${r.code}`).trim().slice(0, 300), false);
  return (r.stdout || r.stderr).trim().split('\n')[0];
}

/** Combine system prompt + conversation into one prompt for single-shot CLIs. */
export function flattenPrompt(system: string, messages: { role: string; content: string }[]): string {
  const parts = [`<instructions>\n${system}\n</instructions>`];
  for (const m of messages) parts.push(m.role === 'user' ? m.content : `<previous_assistant_reply>\n${m.content}\n</previous_assistant_reply>`);
  return parts.join('\n\n');
}
