import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import spawn from 'cross-spawn';
import { runCli } from './cli.js';

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? ['claude.exe', 'claude.cmd', 'claude'] : ['claude'];

/**
 * Variables that mark "we are inside another Claude Code session". If the office server itself was
 * started from such a session they must not leak into agent processes (the child would think it is nested
 * and try to use the parent's host-managed auth).
 */
export const NESTED_SESSION_ENV = [
  'CLAUDECODE',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_HOST_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_AGENT_SDK_VERSION',
  'CLAUDE_PID',
];

function exists(p: string) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** Compare dotted versions found anywhere in a path ("2.1.330" > "2.1.322"). */
function versionOf(p: string): number[] {
  const m = p.match(/(\d+)\.(\d+)\.(\d+)/g);
  return m ? m[m.length - 1].split('.').map(Number) : [0, 0, 0];
}
function byNewest(a: string, b: string) {
  const va = versionOf(a);
  const vb = versionOf(b);
  for (let i = 0; i < 3; i++) if (va[i] !== vb[i]) return vb[i] - va[i];
  return 0;
}

function onPath(): string | null {
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const name of EXE) {
      const p = path.join(dir, name);
      if (exists(p)) return p;
    }
  }
  return null;
}

/**
 * Every `claude` CLI binary on this machine, best first: the one on PATH / official installs, then the copies
 * bundled with the Claude desktop app and the VS Code (or Cursor/Windsurf) extension, newest version first.
 */
export function findClaudeBinaries(): string[] {
  const home = os.homedir();
  const found: string[] = [];
  const add = (p: string | null) => p && exists(p) && !found.includes(p) && found.push(p);

  add(onPath());
  for (const name of EXE) {
    add(path.join(home, '.local', 'bin', name));
    add(path.join(home, '.claude', 'local', name));
    if (process.env.APPDATA) add(path.join(process.env.APPDATA, 'npm', name));
  }

  const bundled: string[] = [];
  // Claude desktop app: <data>/claude-code/<version>/<hash>/claude(.exe)
  const appRoots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Claude-Data'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'Claude'),
    path.join(home, 'Library', 'Application Support', 'Claude'),
    path.join(home, '.config', 'Claude'),
  ].filter(Boolean) as string[];
  for (const root of appRoots) {
    for (const base of [root, ...subdirs(root)]) {
      for (const ver of subdirs(path.join(base, 'claude-code'))) {
        for (const leaf of [ver, ...subdirs(ver)]) for (const name of EXE) if (exists(path.join(leaf, name))) bundled.push(path.join(leaf, name));
      }
    }
  }
  // Editor extensions: <ext>/anthropic.claude-code-<version>-<platform>/resources/native-binary/claude(.exe)
  for (const ed of ['.vscode', '.vscode-insiders', '.cursor', '.windsurf']) {
    for (const ext of subdirs(path.join(home, ed, 'extensions'))) {
      if (!/anthropic\.claude-code-/i.test(path.basename(ext))) continue;
      for (const name of EXE) {
        const p = path.join(ext, 'resources', 'native-binary', name);
        if (exists(p)) bundled.push(p);
      }
    }
  }
  bundled.sort(byNewest).forEach((p) => add(p));
  return found;
}

/**
 * The command to run for a provider configured with `configured` ("claude", empty, or an absolute path).
 * An absolute path that disappeared (the app/extension updated itself) falls back to a fresh search.
 */
export function resolveClaudeCommand(configured?: string): string {
  const c = (configured ?? '').trim();
  if (c && c !== 'claude' && (path.isAbsolute(c) ? exists(c) : true)) return c;
  return findClaudeBinaries()[0] ?? 'claude';
}

export function cleanEnvForClaude(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of NESTED_SESSION_ENV) delete env[k];
  return env;
}

export interface ClaudeAuth {
  loggedIn: boolean;
  authMethod: string | null;
  email?: string | null;
}

/** `claude auth status` → JSON. Null when the CLI is too old to support it. */
export async function claudeAuthStatus(command: string): Promise<ClaudeAuth | null> {
  const ctrl = new AbortController();
  try {
    const r = await runCli({ command, args: ['auth', 'status'], signal: ctrl.signal, timeoutMs: 20_000, replaceEnv: cleanEnvForClaude() });
    const text = (r.stdout || '').trim();
    const start = text.indexOf('{');
    if (start < 0) return null;
    const j = JSON.parse(text.slice(start));
    return { loggedIn: !!j.loggedIn, authMethod: j.authMethod ?? null, email: j.email ?? null };
  } catch {
    return null;
  }
}

/**
 * Open the official interactive sign-in (`claude auth login`) in its own visible console window on this
 * computer. The user completes it in the browser; nothing about the credentials passes through the office.
 */
export function openClaudeLogin(command: string): { opened: boolean; manualCommand: string } {
  const manualCommand = `"${command}" auth login`;
  if (!IS_WIN || /["&|<>^%\r\n]/.test(command)) return { opened: false, manualCommand };
  // `start` gives the CLI its own console window (with visible input/output) independent of the server.
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "Claude sign-in" "${command}" auth login`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
    windowsVerbatimArguments: true,
    env: cleanEnvForClaude() as NodeJS.ProcessEnv,
  });
  child.on('error', () => undefined);
  child.unref();
  return { opened: true, manualCommand };
}
