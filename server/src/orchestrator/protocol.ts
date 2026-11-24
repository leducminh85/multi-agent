import { z } from 'zod';

/**
 * Agent ⇄ orchestrator protocol.
 * Agents answer in plain text and MAY append one fenced block:
 *
 * ```mao-actions
 * { "messages": [...], "help_requests": [...], "question_for_manager": "...", "approval_request": {...}, "memory": [...] }
 * ```
 */
export const actionsSchema = z.object({
  messages: z
    .array(z.object({ to: z.string().min(1), content: z.string().min(1) }))
    .max(10)
    .optional(),
  help_requests: z
    .array(z.object({ role: z.string().min(1), request: z.string().min(1), title: z.string().optional() }))
    .max(5)
    .optional(),
  question_for_manager: z.string().min(1).optional(),
  approval_request: z.object({ action: z.string().min(1), reason: z.string().default(''), details: z.string().optional() }).optional(),
  memory: z.array(z.string().min(1)).max(10).optional(),
  create_mission: z.object({ title: z.string().min(1), request: z.string().min(1) }).optional(),
});
export type AgentActions = z.infer<typeof actionsSchema>;

const BLOCK_RE = /```mao-actions\s*\n([\s\S]*?)```/i;

export function parseAgentOutput(text: string): { output: string; actions: AgentActions; actionError?: string } {
  const m = BLOCK_RE.exec(text);
  if (!m) return { output: text.trim(), actions: {} };
  const output = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  try {
    const raw = JSON.parse(m[1]);
    const parsed = actionsSchema.safeParse(raw);
    if (!parsed.success) return { output, actions: {}, actionError: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
    return { output, actions: parsed.data };
  } catch (e) {
    return { output, actions: {}, actionError: `Invalid JSON in mao-actions block: ${(e as Error).message}` };
  }
}

/** Extract the first JSON object from model output (```json fences or bare braces). */
export function extractJson(text: string): unknown {
  const fence = /```(?:json)?\s*\n([\s\S]*?)```/i.exec(text);
  const candidates = fence ? [fence[1], text] : [text];
  for (const c of candidates) {
    const start = c.indexOf('{');
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(c.slice(start, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error('No valid JSON object found in planner output');
}

export const planSchema = z.object({
  intent: z.string().default(''),
  title: z.string().optional(),
  summary: z.string().default(''),
  tasks: z
    .array(
      z.object({
        key: z.string().min(1),
        title: z.string().min(1),
        description: z.string().default(''),
        role: z.string().default('general'),
        depends_on: z.array(z.string()).default([]),
      }),
    )
    .min(1)
    .max(25),
});
export type Plan = z.infer<typeof planSchema>;

/** Validate plan structure: unique keys, known dependencies, no cycles. Returns a topologically valid plan. */
export function validatePlan(raw: unknown): Plan {
  const plan = planSchema.parse(raw);
  const keys = new Set<string>();
  for (const t of plan.tasks) {
    if (keys.has(t.key)) throw new Error(`Duplicate task key "${t.key}"`);
    keys.add(t.key);
  }
  for (const t of plan.tasks) t.depends_on = [...new Set(t.depends_on.filter((d) => keys.has(d) && d !== t.key))];
  // cycle detection (DFS)
  const graph = new Map(plan.tasks.map((t) => [t.key, t.depends_on]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (k: string, trail: string[]) => {
    const s = state.get(k) ?? 0;
    if (s === 1) throw new Error(`Dependency cycle: ${[...trail, k].join(' → ')}`);
    if (s === 2) return;
    state.set(k, 1);
    for (const d of graph.get(k) ?? []) visit(d, [...trail, k]);
    state.set(k, 2);
  };
  for (const k of graph.keys()) visit(k, []);
  return plan;
}

export const PROTOCOL_INSTRUCTIONS = (opts: { canDelegate: boolean; canMessage: boolean; roles: string[]; agents: string[] }) => `
## Collaboration protocol
Write your deliverable as normal text first. If – and only if – you need one of the actions below, append ONE fenced block at the very end:

\`\`\`mao-actions
{
${opts.canMessage ? `  "messages": [{"to": "<agent name>", "content": "<message>"}],\n` : ''}${opts.canDelegate ? `  "help_requests": [{"role": "<role key>", "title": "<short title>", "request": "<precise, self-contained request>"}],\n` : ''}  "question_for_manager": "<question – only if you cannot proceed without the manager's input>",
  "approval_request": {"action": "<sensitive action>", "reason": "<why>"},
  "memory": ["<durable fact worth remembering for future tasks>"]
}
\`\`\`
Rules:
- Omit keys you do not need; omit the whole block if you need nothing.
${opts.canDelegate ? `- help_requests: another agent does that work; your task pauses and resumes with their result. Available roles: ${opts.roles.join(', ')}.\n` : '- You may not delegate work to other agents.\n'}${opts.canMessage ? `- messages: informational notes to colleagues. Agents: ${opts.agents.join(', ') || '(none)'}.\n` : ''}- Request approval before anything sensitive: deleting data, sending information outside the office, spending money, executing transactions.
- Never claim to have done something you did not do.`;
