import type { Agent, AgentService } from '../agents/service.js';
import type { RoleService } from '../agents/roles.js';
import type { CommsService } from '../comms/service.js';
import type { SettingsService } from '../core/settings.js';
import { truncate } from '../core/util.js';
import type { FileService } from '../files/service.js';
import type { KnowledgeService } from '../knowledge/service.js';
import type { ChatMessage, InputImage } from '../providers/types.js';
import { PROTOCOL_INSTRUCTIONS } from './protocol.js';
import type { Mission, Store, Task } from './store.js';

/**
 * Clip a colleague's output for inlining. The note tells the agent to work with what it got: asking colleagues
 * to "resend the cut part" just produces another clipped copy and burns tokens (observed in real runs).
 */
function clipInput(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}
…[${text.length - max} more characters omitted for length. Work with the part above; do not ask colleagues to resend it – if something essential is missing, say so in your answer.]`;
}

export interface BuiltContext {
  system: string;
  messages: ChatMessage[];
  stats: { dependencies: number; knowledge: number; files: number; images: number; inbox: number; chars: number };
}

/**
 * Builds the prompt for a task: role + agent persona, mission brief, task, dependency outputs,
 * help results, manager answers, permitted knowledge and permitted files.
 */
export class ContextBuilder {
  constructor(
    private store: Store,
    private agents: AgentService,
    private roles: RoleService,
    private knowledge: KnowledgeService,
    private files: FileService,
    private comms: CommsService,
    private settings: SettingsService,
  ) {}

  systemFor(agent: Agent, opts: { protocol: boolean }): string {
    const role = this.roles.get(agent.roleId);
    const parts = [
      `You are "${agent.name}", working as ${role.name} in an AI office team managed by a human manager (the CEO).`,
      role.systemPrompt,
    ];
    if (agent.systemPrompt.trim()) parts.push(`## Your personal instructions\n${agent.systemPrompt.trim()}`);
    if (agent.specialties.trim()) parts.push(`## Your specialties\n${agent.specialties.trim()}`);
    parts.push(
      'Answer in the same language as the manager\'s request unless the task says otherwise. Be honest: if information is missing, say what is missing instead of inventing it.',
    );
    if (opts.protocol) {
      const others = this.agents.list().filter((a) => a.id !== agent.id && a.enabled);
      parts.push(
        PROTOCOL_INSTRUCTIONS({
          canDelegate: agent.permissions.canDelegate,
          canMessage: agent.permissions.canMessageAgents,
          roles: this.roles.list().map((r) => r.key),
          agents: others.map((a) => `${a.name} (${a.roleKey})`),
        }),
      );
    }
    return parts.join('\n\n');
  }

  attachmentsBlock(agent: Agent, mission: Mission | null, budget: number): { text: string; images: InputImage[]; count: number } {
    if (!mission?.attachments.length || agent.permissions.fileAccess === 'none') return { text: '', images: [], count: 0 };
    const parts: string[] = [];
    const images: InputImage[] = [];
    let remaining = budget;
    for (const id of mission.attachments) {
      let f;
      try {
        f = this.files.get(id);
      } catch {
        continue;
      }
      if (agent.permissions.fileAccess === 'project' && f.projectId && f.projectId !== mission.projectId) continue;
      const text = this.files.text(id);
      const header = `### Attachment: ${f.name} (${f.kind}, ${f.size} bytes) – ${f.extractionNote ?? f.extractionStatus}`;
      if (text && remaining > 500) {
        const chunk = truncate(text, Math.min(remaining, 60_000));
        parts.push(`${header}\n${chunk}`);
        remaining -= chunk.length;
      } else parts.push(header);
      if (f.kind === 'image') {
        const img = this.files.imageBase64(id);
        if (img) images.push(img);
      }
    }
    return { text: parts.join('\n\n'), images, count: parts.length };
  }

  buildForTask(task: Task, agent: Agent, mission: Mission | null): BuiltContext {
    const rt = this.settings.get('runtime');
    const sections: string[] = [];
    if (mission) {
      sections.push(`# Manager's original request\n${mission.requestText}`);
      const plan = mission.plan as { summary?: string } | null;
      if (plan?.summary) sections.push(`# Overall plan\n${plan.summary}`);
    }
    sections.push(`# Your task: ${task.title}\n${task.description || task.title}`);

    // Outputs of completed dependencies.
    let deps = 0;
    for (const depId of task.dependsOn) {
      const dep = this.store.findTask(depId);
      if (!dep) continue;
      deps++;
      const body = dep.status === 'completed' ? clipInput(dep.output ?? '', rt.maxContextChars) : `(${dep.status}) ${dep.errorLog.split('\n').filter(Boolean).pop() ?? ''}`;
      sections.push(`## Input from "${dep.title}" (by ${dep.agentName ?? 'unknown'}, status ${dep.status})\n${body}`);
    }

    // Help results, manager answers, approvals.
    for (const x of task.extraContext) sections.push(`## ${x.label}\n${truncate(x.content, rt.maxContextChars)}`);

    // Messages from colleagues.
    const inbox = mission ? this.comms.inboxFor(agent.id, mission.id) : [];
    if (inbox.length) sections.push(`## Messages from colleagues\n${inbox.map((m) => `- ${m.fromName}: ${truncate(m.content, 2000)}`).join('\n')}`);

    // Knowledge allowed by permissions.
    const knowledge = this.knowledge.retrieve({
      agentId: agent.id,
      projectId: task.projectId,
      scopes: agent.permissions.knowledgeScopes,
      query: `${task.title} ${task.description} ${mission?.requestText ?? ''}`,
      maxChars: 8000,
    });
    if (knowledge.length) sections.push(`## Relevant knowledge\n${knowledge.map((k) => `### ${k.title} [${k.scope}]\n${k.content}`).join('\n\n')}`);

    const att = this.attachmentsBlock(agent, mission, 120_000);
    if (att.text) sections.push(`## Attached files\n${att.text}`);

    if (task.kind === 'synthesis') {
      sections.push(
        '## Instructions\nConsolidate the team results above into the final deliverable for the manager. Lead with the outcome, include the actual content produced (do not just summarise that work happened), list failed or incomplete parts honestly, and end with recommended next steps. Do not request help or approvals.',
      );
    } else if (task.kind === 'review') {
      sections.push('## Instructions\nReview the deliverables above against the original request. List concrete issues (severity, location, fix) and finish with a verdict: APPROVED or CHANGES REQUESTED.');
    }

    const user = sections.join('\n\n');
    return {
      system: this.systemFor(agent, { protocol: task.kind !== 'synthesis' }),
      messages: [{ role: 'user', content: user, images: att.images.length ? att.images : undefined }],
      stats: { dependencies: deps, knowledge: knowledge.length, files: att.count, images: att.images.length, inbox: inbox.length, chars: user.length },
    };
  }
}
