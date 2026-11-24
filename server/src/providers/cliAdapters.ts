import fs from 'node:fs';
import path from 'node:path';
import { cliVersion, flattenPrompt, runCli, safeArg } from './cli.js';
import { ProviderError, type ProviderAdapter, type ProviderContext, type RunRequest, type RunResult } from './types.js';

const cliCaps = {
  streaming: false,
  vision: false,
  transcription: false,
  video: false,
  agenticTools: true,
  billingApi: false,
  rateLimitHeaders: false,
  subscriptionQuotaApi: false,
};

function ensureCwd(cwd?: string) {
  if (cwd) fs.mkdirSync(cwd, { recursive: true });
  return cwd;
}

function imagesToFiles(req: RunRequest): string {
  // CLI agents read files from disk: materialise attached images inside the workspace.
  const cwd = req.cwd;
  const names: string[] = [];
  if (!cwd) return '';
  const dir = path.join(cwd, '.mao-attachments');
  for (const m of req.messages) {
    for (const img of m.images ?? []) {
      fs.mkdirSync(dir, { recursive: true });
      const ext = img.mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
      const name = (img.name ?? `image-${names.length + 1}.${ext}`).replace(/[^\w.\-]/g, '_');
      fs.writeFileSync(path.join(dir, name), Buffer.from(img.base64, 'base64'));
      names.push(path.join('.mao-attachments', name));
    }
  }
  return names.length ? `\n\nAttached images (in the workspace): ${names.join(', ')}` : '';
}

// ---------------- Claude Code CLI ----------------
async function runClaude(ctx: ProviderContext, req: RunRequest): Promise<RunResult> {
  const started = Date.now();
  const command = ctx.config.command || 'claude';
  const p = req.permissions;
  const allowed = ['Read', 'Glob', 'Grep', 'LS'];
  if (p.allowFileWrite) allowed.push('Edit', 'MultiEdit', 'Write', 'NotebookEdit');
  if (p.allowCommandExecution) allowed.push('Bash');
  if (p.allowNetwork) allowed.push('WebFetch', 'WebSearch');
  const disallowed = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch'].filter((t) => !allowed.includes(t));
  const args = ['-p', '--output-format', 'json', '--allowedTools', allowed.join(',')];
  if (disallowed.length) args.push('--disallowedTools', disallowed.join(','));
  const model = safeArg(req.model || ctx.config.defaultModel, 'model');
  if (model) args.push('--model', model);
  const prompt = flattenPrompt(req.system, req.messages) + imagesToFiles(req);
  req.onStatus?.('CLI process started');
  const r = await runCli({
    command,
    args,
    stdin: prompt,
    cwd: ensureCwd(req.cwd),
    signal: req.signal,
    timeoutMs: req.timeoutMs ?? 15 * 60_000,
  });
  req.onStatus?.('CLI process exited');
  let json: any;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop() ?? '');
  } catch {
    throw new ProviderError(`Claude CLI returned no JSON (exit ${r.code}): ${(r.stderr || r.stdout).slice(0, 400)}`, r.code !== 0);
  }
  const u = json.usage ?? {};
  const usage = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  if (json.is_error || json.subtype !== 'success') {
    const err = new ProviderError(`Claude CLI error: ${json.result ?? json.subtype ?? 'unknown'}`, /rate|overloaded|limit/i.test(String(json.result)));
    (err as any).usage = usage;
    throw err;
  }
  const modelUsed = json.modelUsage ? Object.keys(json.modelUsage)[0] : model;
  return {
    text: String(json.result ?? ''),
    model: modelUsed,
    usage,
    costUsd: typeof json.total_cost_usd === 'number' ? json.total_cost_usd : undefined,
    costSource: typeof json.total_cost_usd === 'number' ? 'reported' : undefined,
    durationMs: Date.now() - started,
    meta: { sessionId: json.session_id, numTurns: json.num_turns },
  };
}

export const claudeCliAdapter: ProviderAdapter = {
  descriptor: {
    type: 'claude-code-cli',
    displayName: 'Claude Code (CLI)',
    vendor: 'Anthropic',
    integration: 'cli',
    description:
      'Runs the locally installed `claude` CLI in print mode inside the project workspace. Uses whatever login the CLI has (Claude Pro/Max subscription or API key). Agentic: can read/edit files and run commands when permitted.',
    configFields: [
      { key: 'command', label: 'Command', type: 'text', placeholder: 'claude', default: 'claude' },
      { key: 'defaultModel', label: 'Model (optional)', type: 'text', placeholder: 'e.g. opus, sonnet, claude-opus-5-5' },
    ],
    credentialFields: [],
    capabilities: { ...cliCaps, usageReporting: 'tokens+cost' },
    suggestedModels: ['opus', 'sonnet', 'haiku'],
    limitations: [
      'Subscription quota (5-hour / weekly limits) is NOT exposed by any official API; the CLI only shows it interactively (/usage). Track it via manual quota entries.',
      'Reported cost (total_cost_usd) is the API-equivalent value; on a subscription login it is not actually billed.',
      'Tool permissions are enforced with --allowedTools/--disallowedTools based on the agent permissions.',
    ],
    canExecute: true,
  },
  run: runClaude,
  async checkConnection(ctx) {
    try {
      const v = await cliVersion(ctx.config.command || 'claude');
      return { ok: true, message: `CLI available: ${v}. Login state is checked on first run.` };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },
};

// ---------------- OpenAI Codex CLI ----------------
async function runCodex(ctx: ProviderContext, req: RunRequest): Promise<RunResult> {
  const started = Date.now();
  const command = ctx.config.command || 'codex';
  const p = req.permissions;
  const sandbox = p.allowFileWrite || p.allowCommandExecution ? 'workspace-write' : 'read-only';
  const args = ['exec', '--json', '--skip-git-repo-check', '--sandbox', sandbox];
  if (sandbox === 'workspace-write' && p.allowNetwork) args.push('-c', 'sandbox_workspace_write.network_access=true');
  const model = safeArg(req.model || ctx.config.defaultModel, 'model');
  if (model) args.push('--model', model);
  args.push('-');
  const prompt = flattenPrompt(req.system, req.messages) + imagesToFiles(req);
  let text = '';
  let usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 };
  let failure: string | null = null;
  req.onStatus?.('CLI process started');
  const r = await runCli({
    command,
    args,
    stdin: prompt,
    cwd: ensureCwd(req.cwd),
    signal: req.signal,
    timeoutMs: req.timeoutMs ?? 15 * 60_000,
    onStdoutLine: (line) => {
      let ev: any;
      try {
        ev = JSON.parse(line);
      } catch {
        return;
      }
      if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') {
        text = ev.item.text ?? text;
      } else if (ev.type === 'item.started' && ev.item?.type === 'command_execution') {
        req.onStatus?.(`running command: ${String(ev.item.command ?? '').slice(0, 80)}`);
      } else if (ev.type === 'turn.completed' && ev.usage) {
        usage = {
          inputTokens: usage.inputTokens + (ev.usage.input_tokens ?? 0),
          outputTokens: usage.outputTokens + (ev.usage.output_tokens ?? 0),
          cacheReadTokens: usage.cacheReadTokens + (ev.usage.cached_input_tokens ?? 0),
          reasoningTokens: usage.reasoningTokens + (ev.usage.reasoning_output_tokens ?? 0),
        };
      } else if (ev.type === 'turn.failed' || ev.type === 'error') {
        failure = ev.error?.message ?? ev.message ?? 'Codex turn failed';
      }
    },
  });
  req.onStatus?.('CLI process exited');
  if (failure) {
    const err = new ProviderError(`Codex error: ${failure}`, /rate|limit|overloaded|timeout/i.test(failure));
    (err as any).usage = usage;
    throw err;
  }
  if (r.code !== 0 && !text) throw new ProviderError(`Codex exited with code ${r.code}: ${(r.stderr || r.stdout).slice(-400)}`, false);
  return { text, model, usage, durationMs: Date.now() - started };
}

export const codexCliAdapter: ProviderAdapter = {
  descriptor: {
    type: 'codex-cli',
    displayName: 'OpenAI Codex (CLI)',
    vendor: 'OpenAI',
    integration: 'cli',
    description:
      'Runs the locally installed `codex exec --json` inside the project workspace. Uses the CLI login (ChatGPT plan or API key). Sandbox mode follows the agent permissions (read-only / workspace-write).',
    configFields: [
      { key: 'command', label: 'Command', type: 'text', placeholder: 'codex', default: 'codex' },
      { key: 'defaultModel', label: 'Model (optional)', type: 'text' },
    ],
    credentialFields: [],
    capabilities: { ...cliCaps, usageReporting: 'tokens' },
    suggestedModels: [],
    limitations: [
      'ChatGPT-plan rate limits (5-hour / weekly) are not exposed through an official API; record them via manual quota entries.',
      'Token usage is read from the JSON event stream (turn.completed). No dollar cost is reported.',
    ],
    canExecute: true,
  },
  run: runCodex,
  async checkConnection(ctx) {
    try {
      const v = await cliVersion(ctx.config.command || 'codex');
      return { ok: true, message: `CLI available: ${v}. Login state is checked on first run.` };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },
};

// ---------------- Google Antigravity CLI (agy) ----------------
const ARG_PROMPT_LIMIT = 20_000;

async function runAgy(ctx: ProviderContext, req: RunRequest): Promise<RunResult> {
  const started = Date.now();
  const command = ctx.config.command || 'agy';
  const p = req.permissions;
  const cwd = ensureCwd(req.cwd);
  const args = ['--output-format', 'json'];
  const model = safeArg(req.model || ctx.config.defaultModel, 'model');
  if (model) args.push('--model', model);
  if (!p.allowFileWrite && !p.allowCommandExecution) args.push('--mode', 'plan');
  else args.push('--mode', 'accept-edits');
  if (ctx.config.sandbox !== false) args.push('--sandbox');
  const timeoutMs = req.timeoutMs ?? 15 * 60_000;
  args.push('--print-timeout', `${Math.floor(timeoutMs / 1000)}s`);
  let prompt = flattenPrompt(req.system, req.messages) + imagesToFiles(req);
  if (prompt.length > ARG_PROMPT_LIMIT) {
    // Windows command lines are limited to ~32k chars: hand over long prompts through a file.
    if (!cwd) throw new ProviderError('Prompt too long for Antigravity CLI without a workspace', false);
    const dir = path.join(cwd, '.mao-prompts');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `prompt-${Date.now()}.md`);
    fs.writeFileSync(file, prompt, 'utf8');
    prompt = `Your full instructions are in the file ${path.relative(cwd, file)} (in the current workspace). Read that file completely and carry out the instructions it contains. Reply with your final answer only.`;
  }
  args.push(`--print=${prompt}`);
  req.onStatus?.('CLI process started');
  const r = await runCli({ command, args, cwd, signal: req.signal, timeoutMs: timeoutMs + 15_000 });
  req.onStatus?.('CLI process exited');
  let json: any;
  try {
    json = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop() ?? '');
  } catch {
    throw new ProviderError(`Antigravity CLI returned no JSON (exit ${r.code}): ${(r.stderr || r.stdout).slice(0, 400)}`, r.code !== 0);
  }
  const u = json.usage ?? {};
  const usage = {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: (u.output_tokens ?? 0) + (u.thinking_tokens ?? 0),
    cacheReadTokens: u.cache_read_tokens ?? 0,
    reasoningTokens: u.thinking_tokens ?? 0,
  };
  if (json.status !== 'SUCCESS') {
    const err = new ProviderError(`Antigravity error: ${json.status ?? 'unknown'} ${json.error ?? json.response ?? ''}`.trim(), /RATE|QUOTA|LIMIT|TIMEOUT/i.test(String(json.status)));
    (err as any).usage = usage;
    throw err;
  }
  return {
    text: String(json.response ?? ''),
    model,
    usage,
    durationMs: Date.now() - started,
    meta: { conversationId: json.conversation_id, numTurns: json.num_turns },
  };
}

export const antigravityCliAdapter: ProviderAdapter = {
  descriptor: {
    type: 'antigravity-cli',
    displayName: 'Google Antigravity (CLI)',
    vendor: 'Google',
    integration: 'cli',
    description:
      'Runs the Antigravity CLI (`agy`) in print mode with JSON output inside the project workspace. Uses the account logged into Antigravity. Plan mode when the agent may not edit files.',
    configFields: [
      { key: 'command', label: 'Command', type: 'text', placeholder: 'agy', default: 'agy' },
      { key: 'defaultModel', label: 'Model (optional)', type: 'text', placeholder: 'see `agy models`' },
      { key: 'sandbox', label: 'Run with --sandbox', type: 'boolean', default: true },
    ],
    credentialFields: [],
    capabilities: { ...cliCaps, usageReporting: 'tokens' },
    suggestedModels: [],
    limitations: [
      'The Antigravity desktop IDE has no public API; only the `agy` CLI is automatable.',
      'Plan quota / remaining credits are not exposed via an official API – record them via manual quota entries.',
      'Token usage (input/output/thinking) is read from the CLI JSON result; no cost is reported.',
    ],
    canExecute: true,
  },
  run: runAgy,
  async checkConnection(ctx) {
    const command = ctx.config.command || 'agy';
    try {
      const ctrl = new AbortController();
      const r = await runCli({ command, args: ['models'], signal: ctrl.signal, timeoutMs: 30000 });
      if (r.code !== 0) return { ok: false, message: (r.stderr || r.stdout).trim().slice(0, 300) || `exit ${r.code}` };
      const models = r.stdout
        .split('\n')
        .map((l) => l.split('\t')[0].trim())
        .filter((l) => l && !/^Fetching/i.test(l));
      return { ok: true, message: `CLI available – ${models.length} models`, models };
    } catch (e: any) {
      return { ok: false, message: e.message };
    }
  },
};
