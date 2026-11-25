import { z } from 'zod';

export const permissionsSchema = z.object({
  /** Which knowledge scopes are injected into the agent's context. */
  knowledgeScopes: z.array(z.enum(['global', 'project', 'agent'])).default(['global', 'project', 'agent']),
  /** Which uploaded files the agent may read. */
  fileAccess: z.enum(['none', 'project', 'all']).default('project'),
  /** CLI agents: allow shell command execution in the workspace. */
  allowCommandExecution: z.boolean().default(false),
  /** CLI agents: allow writing/editing files in the workspace. */
  allowFileWrite: z.boolean().default(false),
  /** CLI agents: allow web/network tools. */
  // Read-only web access (search, open pages). On by default: research/content work needs it.
  allowNetwork: z.boolean().default(true),
  /** May ask other agents for help (creates sub-tasks). */
  canDelegate: z.boolean().default(true),
  /** May send messages to other agents. */
  canMessageAgents: z.boolean().default(true),
  /** Sensitive actions requested by the agent need manager approval. Always enforced; kept for display. */
  requireApprovalForSensitiveActions: z.boolean().default(true),
});
export type AgentPermissions = z.infer<typeof permissionsSchema>;

export const limitsSchema = z.object({
  maxConcurrentTasks: z.number().int().min(1).max(64).default(1),
  maxOutputTokens: z.number().int().min(256).max(128000).default(16000),
  timeoutMs: z.number().int().min(10_000).max(6 * 3600_000).default(15 * 60_000),
  /** Optional daily token budget (input+output) measured from real usage records. */
  dailyTokenBudget: z.number().int().positive().nullable().default(null),
});
export type AgentLimits = z.infer<typeof limitsSchema>;

export const defaultPermissions = (): AgentPermissions => permissionsSchema.parse({});
export const defaultLimits = (): AgentLimits => limitsSchema.parse({});
