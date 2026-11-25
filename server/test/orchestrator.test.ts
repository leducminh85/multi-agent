import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderError } from '../src/providers/types.js';
import { createMockAdapter, isPlanner, makeServices, seedTeam, taskTitle, waitFor, type MockScript } from './helpers.js';

const PLAN = JSON.stringify({
  intent: 'write a report',
  title: 'Market report',
  summary: 'Research two markets in parallel, then write.',
  tasks: [
    { key: 'r1', title: 'Research market A', description: 'A', role: 'researcher', depends_on: [] },
    { key: 'r2', title: 'Research market B', description: 'B', role: 'researcher', depends_on: [] },
    { key: 'w', title: 'Write report', description: 'combine', role: 'content', depends_on: ['r1', 'r2'] },
  ],
});

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

function setup(script: MockScript, opts: { delayMs?: number; roles?: string[] } = {}) {
  const mock = createMockAdapter(script, { delayMs: opts.delayMs });
  const env = makeServices(mock.adapter);
  cleanup = env.cleanup;
  const team = seedTeam(env.s, opts.roles);
  env.s.orchestrator.start();
  return { ...env, mock, team };
}

describe('Orchestrator – planning and execution', () => {
  it('plans, runs independent tasks in parallel, respects dependencies, synthesises and completes', async () => {
    const { s, mock } = setup((req, call) => {
      if (isPlanner(req)) return PLAN;
      const t = taskTitle(call.prompt);
      if (t === 'Final report for the manager') return 'FINAL REPORT';
      return `output of ${t}`;
    }, { delayMs: 80 });
    const researchers = s.agents.list().filter((a) => a.roleKey === 'researcher');
    // second researcher so both research tasks can run at the same time
    s.agents.create({ name: 'researcher-2', roleId: researchers[0].roleId, providerId: researchers[0].providerId, model: 'claude-sonnet-5-5' });

    const m = await s.orchestrator.submitMission({ text: 'Compare markets A and B' }, 'ceo');
    await waitFor(() => ['completed', 'failed'].includes(s.store.getMission(m.id).status), 10000, 'mission end');
    await s.orchestrator.idle();

    const mission = s.store.getMission(m.id);
    expect(mission.status).toBe('completed');
    expect(mission.title).toBe('Market report');
    expect(mission.result).toBe('FINAL REPORT');

    const tasks = s.store.listTasks({ missionId: m.id });
    expect(tasks).toHaveLength(4);
    expect(tasks.every((t) => t.status === 'completed')).toBe(true);

    const callFor = (title: string) => mock.calls.find((c) => taskTitle(c.prompt) === title)!;
    const a = callFor('Research market A');
    const b = callFor('Research market B');
    const w = callFor('Write report');
    // parallel: B started before A ended
    expect(b.startedAt).toBeLessThan(a.endedAt!);
    // dependency: writer started after both research tasks ended
    expect(w.startedAt).toBeGreaterThanOrEqual(Math.max(a.endedAt!, b.endedAt!));
    // writer received both research outputs as context
    expect(w.prompt).toContain('output of Research market A');
    expect(w.prompt).toContain('output of Research market B');
    expect(mock.maxActive).toBeGreaterThanOrEqual(2);

    // real progress: steps recorded, usage recorded with estimated cost
    const steps = s.store.steps(tasks[0].id);
    expect(steps.map((x) => x.label)).toContain('Response received');
    const usage = s.usage.summary();
    expect(usage.totals.requests).toBe(5); // 1 plan + 3 work + 1 synthesis
    expect(usage.totals.cost_estimated).toBeGreaterThan(0);

    // CEO report posted in global chat
    expect(s.comms.list({ channel: 'global' }).some((x) => x.kind === 'report' && x.content.includes('FINAL REPORT'))).toBe(true);
  });

  it('falls back to a single task when the planner returns invalid JSON twice', async () => {
    const { s } = setup((req) => (isPlanner(req) ? 'I cannot produce JSON' : 'done'));
    const m = await s.orchestrator.submitMission({ text: 'Do something' }, 'ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 8000, 'mission completed');
    const mission = s.store.getMission(m.id);
    expect((mission.plan as any).fallbackReason).toMatch(/invalid/);
    expect(s.store.listTasks({ missionId: m.id })).toHaveLength(1);
    expect(mission.result).toContain('done');
  });

  it('fails the mission clearly when no agent exists', async () => {
    const mock = createMockAdapter(() => 'x');
    const env = makeServices(mock.adapter);
    cleanup = env.cleanup;
    env.s.orchestrator.start();
    const m = await env.s.orchestrator.submitMission({ text: 'Hello' }, 'ceo');
    await waitFor(() => env.s.store.getMission(m.id).status === 'failed', 5000, 'failed');
    expect(env.s.store.getMission(m.id).error).toMatch(/No available agent/);
  });

  it('runs direct assignments on the chosen agent without planning', async () => {
    const { s, mock, team } = setup(() => 'direct result');
    const dev = team.agents.find((a) => a.roleKey === 'developer')!;
    const m = await s.orchestrator.submitMission({ text: 'Fix bug 42', mode: 'direct', agentId: dev.id }, 'ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 5000, 'completed');
    const [t] = s.store.listTasks({ missionId: m.id });
    expect(t.agentId).toBe(dev.id);
    expect(t.kind).toBe('direct');
    expect(mock.calls.some((c) => c.system.includes('## Planning mode'))).toBe(false);
  });
});

describe('Orchestrator – reliability', () => {
  it('retries retryable errors and records the error log', async () => {
    let failed = false;
    const { s } = setup((req, call) => {
      if (isPlanner(req)) return JSON.stringify({ tasks: [{ key: 'a', title: 'Flaky', role: 'developer' }] });
      if (!failed) {
        failed = true;
        return new ProviderError('HTTP 529: overloaded', true, 529);
      }
      return 'ok after retry';
    });
    const m = await s.orchestrator.submitMission({ text: 'go' }, 'ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 8000, 'completed');
    const [t] = s.store.listTasks({ missionId: m.id });
    expect(t.attempts).toBe(2);
    expect(t.errorLog).toMatch(/overloaded/);
    expect(t.output).toBe('ok after retry');
  });

  it('fails tasks after max attempts, cancels dependants and allows a manual retry', async () => {
    let healthy = false;
    const { s } = setup(
      (req, call) => {
        if (isPlanner(req))
          return JSON.stringify({ tasks: [{ key: 'a', title: 'Broken', role: 'developer' }, { key: 'b', title: 'After', role: 'content', depends_on: ['a'] }] });
        if (taskTitle(call.prompt) === 'Broken' && !healthy) return new ProviderError('HTTP 400: bad request', false, 400);
        return 'fine';
      },
      { roles: ['project_manager', 'developer', 'content'] },
    );
    const m = await s.orchestrator.submitMission({ text: 'go' }, 'ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'failed', 8000, 'failed');
    const tasks = s.store.listTasks({ missionId: m.id });
    const broken = tasks.find((t) => t.title === 'Broken')!;
    const after = tasks.find((t) => t.title === 'After')!;
    expect(broken.status).toBe('failed');
    expect(after.status).toBe('cancelled');
    expect(after.errorLog).toMatch(/Dependency/);

    healthy = true;
    s.orchestrator.retryTask(broken.id, 'ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 8000, 'completed after retry');
    expect(s.store.getTask(after.id).status).toBe('completed');
  });

  it('does not stop at a failure: the PM hands the task to another agent with a backup plan', async () => {
    const { s, mock, team } = setup(
      (req, call) => {
        if (isPlanner(req)) return JSON.stringify({ tasks: [{ key: 'a', title: 'Edit video', role: 'developer' }, { key: 'b', title: 'Publish', role: 'content', depends_on: ['a'] }] });
        if (req.system.includes('## Failure recovery mode')) {
          const content = team.agents.find((a) => a.roleKey === 'content')!;
          return JSON.stringify({ decision: 'new_approach', agent_id: content.id, instructions: 'Use ffmpeg instead of the editor', reason: 'Editor crashed; ffmpeg works.' });
        }
        if (taskTitle(call.prompt) === 'Edit video' && req.system.includes('You are "developer-agent"')) return new ProviderError('HTTP 400: tool crashed', false, 400);
        return `done: ${taskTitle(call.prompt)}`;
      },
      { roles: ['project_manager', 'developer', 'content'] },
    );
    const m = await s.orchestrator.submitMission({ text: 'make a video' }, 'ceo');
    await waitFor(() => ['completed', 'failed'].includes(s.store.getMission(m.id).status), 10000, 'mission end');
    await s.orchestrator.idle();
    expect(s.store.getMission(m.id).status).toBe('completed');
    const edit = s.store.listTasks({ missionId: m.id }).find((t) => t.title === 'Edit video')!;
    expect(edit.status).toBe('completed');
    expect(edit.agentName).toBe('content-agent');
    // The new agent got the backup plan; the team chat explains what happened.
    const retry = mock.calls.filter((c) => taskTitle(c.prompt) === 'Edit video').pop()!;
    expect(retry.prompt).toContain('Use ffmpeg instead of the editor');
    expect(s.comms.list({ channel: 'agents' }).some((x) => x.content.includes('backup approach') && x.content.includes('ffmpeg works'))).toBe(true);
  });

  it('lets the PM skip a non-essential failed task with a workaround so the mission continues', async () => {
    const { s } = setup(
      (req, call) => {
        if (isPlanner(req)) return JSON.stringify({ tasks: [{ key: 'a', title: 'Fetch logo', role: 'developer' }, { key: 'b', title: 'Write post', role: 'content', depends_on: ['a'] }] });
        if (req.system.includes('## Failure recovery mode')) return JSON.stringify({ decision: 'skip', output: 'Use the text logo instead.', reason: 'Logo is optional.' });
        if (taskTitle(call.prompt) === 'Fetch logo') return new ProviderError('HTTP 400: blocked', false, 400);
        return call.prompt.includes('Use the text logo instead.') ? 'post with text logo' : 'post';
      },
      { roles: ['project_manager', 'developer', 'content'] },
    );
    const m = await s.orchestrator.submitMission({ text: 'post' }, 'ceo');
    await waitFor(() => ['completed', 'failed'].includes(s.store.getMission(m.id).status), 10000, 'mission end');
    const tasks = s.store.listTasks({ missionId: m.id });
    expect(tasks.find((t) => t.title === 'Fetch logo')!.output).toMatch(/Skipped/);
    expect(tasks.find((t) => t.title === 'Write post')!.output).toBe('post with text logo');
  });

  it('cancels a running mission and aborts provider calls', async () => {
    const { s } = setup((req) => (isPlanner(req) ? JSON.stringify({ tasks: [{ key: 'a', title: 'Slow', role: 'developer' }] }) : 'never'), { delayMs: 3000 });
    const m = await s.orchestrator.submitMission({ text: 'go' }, 'ceo');
    await waitFor(() => s.store.listTasks({ missionId: m.id }).some((t) => t.status === 'running'), 8000, 'running');
    s.orchestrator.cancelMission(m.id, 'ceo');
    await s.orchestrator.idle();
    expect(s.store.getMission(m.id).status).toBe('cancelled');
    expect(s.store.listTasks({ missionId: m.id })[0].status).toBe('cancelled');
    expect(s.runtime).toBeDefined();
  });

  it('emergency stop interrupts running work and resume continues it', async () => {
    let calls = 0;
    const { s } = setup(
      (req) => {
        if (isPlanner(req)) return JSON.stringify({ tasks: [{ key: 'a', title: 'Long', role: 'developer' }] });
        calls++;
        return 'finished';
      },
      { delayMs: 400 },
    );
    const m = await s.orchestrator.submitMission({ text: 'go' }, 'ceo');
    await waitFor(() => s.store.listTasks({ missionId: m.id }).some((t) => t.status === 'running'), 8000, 'running');
    const n = s.orchestrator.emergencyStop('ceo');
    expect(n).toBe(1);
    await new Promise((r) => setTimeout(r, 150));
    expect(s.store.listTasks({ missionId: m.id })[0].status).toBe('pending');
    s.orchestrator.resume('ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 8000, 'completed after resume');
    expect(calls).toBe(1);
  });
});

describe('Orchestrator – collaboration', () => {
  it('handles agent-to-agent help requests (hierarchical delegation)', async () => {
    const { s, mock } = setup((req, call) => {
      if (isPlanner(req)) return JSON.stringify({ tasks: [{ key: 'a', title: 'Build feature', role: 'developer' }] });
      const t = taskTitle(call.prompt);
      if (t === 'Build feature') {
        if (call.prompt.includes('Help result from')) return 'feature built using API docs';
        return 'Need docs first.\n```mao-actions\n{"help_requests":[{"role":"researcher","title":"Find API docs","request":"Find the API docs"}],"messages":[{"to":"researcher-agent","content":"ping"}]}\n```';
      }
      if (t === 'Find API docs') return 'API docs: GET /v1/things';
      return 'x';
    });
    const m = await s.orchestrator.submitMission({ text: 'build it' }, 'ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 8000, 'completed');
    const tasks = s.store.listTasks({ missionId: m.id });
    const parent = tasks.find((t) => t.title === 'Build feature')!;
    const child = tasks.find((t) => t.title === 'Find API docs')!;
    expect(child.parentTaskId).toBe(parent.id);
    expect(child.kind).toBe('help');
    expect(parent.output).toBe('feature built using API docs');
    const resumed = mock.calls.filter((c) => taskTitle(c.prompt) === 'Build feature').pop()!;
    expect(resumed.prompt).toContain('API docs: GET /v1/things');
    const agentMsgs = s.comms.list({ channel: 'agents' });
    expect(agentMsgs.some((x) => x.kind === 'help_request')).toBe(true);
    expect(agentMsgs.some((x) => x.kind === 'message' && x.content === 'ping')).toBe(true);
  });

  it('waits for the manager when an agent asks a question, then resumes with the answer', async () => {
    const { s, mock } = setup((req, call) => {
      if (isPlanner(req)) return JSON.stringify({ tasks: [{ key: 'a', title: 'Write post', role: 'content' }] });
      if (call.prompt.includes("Manager's answer")) return 'Post written in English';
      return 'Draft.\n```mao-actions\n{"question_for_manager":"Which language?"}\n```';
    });
    const m = await s.orchestrator.submitMission({ text: 'write a post' }, 'ceo');
    await waitFor(() => s.store.listTasks({ missionId: m.id }).some((t) => t.status === 'waiting'), 8000, 'waiting');
    const t = s.store.listTasks({ missionId: m.id })[0];
    expect(t.waitingReason).toContain('manager answer');
    expect(s.comms.list({ channel: 'global' }).some((x) => x.kind === 'question' && x.content.includes('Which language?'))).toBe(true);
    s.orchestrator.respondToTask(t.id, 'English please', 'ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 8000, 'completed');
    expect(s.store.getTask(t.id).output).toBe('Post written in English');
    expect(mock.calls.pop()!.prompt).toContain('English please');
    // The manager sees feedback right after answering and the result in the main chat – the conversation does not go silent.
    const global = s.comms.list({ channel: 'global' });
    expect(global.some((x) => x.fromType === 'system' && x.content.includes('received your answer and is continuing'))).toBe(true);
    expect(global.some((x) => x.kind === 'result' && x.taskId === t.id && x.content.includes('Post written in English'))).toBe(true);
  });

  it('gates sensitive actions behind manager approval', async () => {
    const { s } = setup((req, call) => {
      if (isPlanner(req)) return JSON.stringify({ tasks: [{ key: 'a', title: 'Clean data', role: 'developer' }] });
      if (call.prompt.includes('Manager decision')) return call.prompt.includes('REJECTED') ? 'Skipped deletion' : 'Deleted';
      return 'Ready.\n```mao-actions\n{"approval_request":{"action":"delete old records","reason":"cleanup"}}\n```';
    });
    const m = await s.orchestrator.submitMission({ text: 'clean' }, 'ceo');
    await waitFor(() => s.approvals.list('pending').length === 1, 8000, 'approval');
    const ap = s.approvals.list('pending')[0];
    expect(ap.actionType).toBe('delete old records');
    s.orchestrator.decideApproval(ap.id, 'rejected', 'not now', 'ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 8000, 'completed');
    expect(s.store.listTasks({ missionId: m.id })[0].output).toBe('Skipped deletion');
  });

  it('stores agent memory in agent-scoped knowledge and injects it later', async () => {
    const { s, mock, team } = setup((req, call) => {
      if (call.prompt.includes('Second job')) return 'used memory';
      return 'ok\n```mao-actions\n{"memory":["The manager prefers bullet lists for reports"]}\n```';
    });
    const dev = team.agents.find((a) => a.roleKey === 'developer')!;
    const m1 = await s.orchestrator.submitMission({ text: 'First job about reports', mode: 'direct', agentId: dev.id }, 'ceo');
    await waitFor(() => s.store.getMission(m1.id).status === 'completed', 5000, 'm1');
    expect(s.knowledge.list({ scope: 'agent', agentId: dev.id })).toHaveLength(1);
    const m2 = await s.orchestrator.submitMission({ text: 'Second job: write reports', mode: 'direct', agentId: dev.id }, 'ceo');
    await waitFor(() => s.store.getMission(m2.id).status === 'completed', 5000, 'm2');
    expect(mock.calls.pop()!.prompt).toContain('prefers bullet lists');
  });

  it('respects reassignment by the manager', async () => {
    const { s, team } = setup((req) => (isPlanner(req) ? JSON.stringify({ tasks: [{ key: 'a', title: 'T', role: 'developer' }] }) : 'done'), { delayMs: 500 });
    const content = team.agents.find((a) => a.roleKey === 'content')!;
    const m = await s.orchestrator.submitMission({ text: 'go' }, 'ceo');
    await waitFor(() => s.store.listTasks({ missionId: m.id }).some((t) => t.status === 'running'), 8000, 'running');
    const t = s.store.listTasks({ missionId: m.id })[0];
    s.orchestrator.reassignTask(t.id, content.id, 'ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 8000, 'completed');
    expect(s.store.getTask(t.id).agentId).toBe(content.id);
  });
});

describe('Orchestrator – out-of-quota failover', () => {
  it('moves work to another connected AI when the agent’s AI is out of quota, and remembers the cooldown', async () => {
    let quotaProviderId = '';
    const { s, mock, team } = setup((req, call) => {
      if (call.providerId === quotaProviderId) return new ProviderError('Antigravity error: ERROR Individual quota reached. Please upgrade your subscription. Resets in 2h5m0s.', false);
      if (isPlanner(req)) return JSON.stringify({ tasks: [{ key: 'a', title: 'Research', role: 'researcher' }] });
      return 'done on the backup AI';
    });
    quotaProviderId = team.provider.id;
    const backup = s.providers.create({ type: 'mock', name: 'Backup AI', config: {}, credentials: { apiKey: 'sk-test-999999' }, enabled: true, maxConcurrency: 4 });
    s.providers.setStatus(backup.id, 'connected', 'ok');

    const m = await s.orchestrator.submitMission({ text: 'research something' }, 'ceo');
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 8000, 'completed');
    const t = s.store.listTasks({ missionId: m.id }).find((x) => x.title === 'Research')!;
    expect(t.output).toBe('done on the backup AI');
    // The failing AI is in cooldown with the provider's own reset time; the manager was told once.
    const cd = s.providers.cooldown(team.provider.id)!;
    expect(cd.until.getTime() - Date.now()).toBeGreaterThan(2 * 3600_000);
    expect(s.providers.get(team.provider.id).status).toBe('error');
    const notices = s.comms.list({ channel: 'global' }).filter((x) => x.fromType === 'system' && x.content.includes('continues on Backup AI'));
    expect(notices).toHaveLength(1);
    // Later calls skip the exhausted AI entirely (no slow failing call first).
    const before = mock.calls.filter((c) => c.providerId === team.provider.id).length;
    const m2 = await s.orchestrator.submitMission({ text: 'again' }, 'ceo');
    await waitFor(() => s.store.getMission(m2.id).status === 'completed', 8000, 'second mission');
    expect(mock.calls.filter((c) => c.providerId === team.provider.id).length).toBe(before);
  });

  it('fails clearly (no retries) when no other AI is available', async () => {
    const { s } = setup((req) => {
      if (isPlanner(req)) return JSON.stringify({ tasks: [{ key: 'a', title: 'Research', role: 'researcher' }] });
      return new ProviderError('ERROR Individual quota reached. Resets in 10m0s.', false);
    });
    const m = await s.orchestrator.submitMission({ text: 'research something' }, 'ceo');
    await waitFor(() => ['failed', 'completed'].includes(s.store.getMission(m.id).status), 8000, 'finished');
    expect(s.comms.list({ channel: 'global' }).some((x) => x.kind === 'error' && x.content.includes('No other AI is available'))).toBe(true);
  });
});

describe('Orchestrator – answering with files', () => {
  it('passes files attached to an answer to the agent (text extracted, shown in chat)', async () => {
    const { s, mock } = setup((req, call) => {
      if (isPlanner(req)) return JSON.stringify({ tasks: [{ key: 'a', title: 'Design logo', role: 'content' }] });
      if (call.prompt.includes('Files attached by the manager')) return 'Logo done using the brief';
      return 'Need input.\n```mao-actions\n{"question_for_manager":"Do you have a brand brief?"}\n```';
    });
    const m = await s.orchestrator.submitMission({ text: 'make a logo' }, 'ceo');
    await waitFor(() => s.store.listTasks({ missionId: m.id }).some((t) => t.status === 'waiting'), 8000, 'waiting');
    const t = s.store.listTasks({ missionId: m.id })[0];
    const tmp = path.join(os.tmpdir(), `brief-${Date.now()}.txt`);
    fs.writeFileSync(tmp, 'Brand colour: teal. Mood: calm.');
    const f = s.files.ingest({ tempPath: tmp, originalName: 'brief.txt', mime: 'text/plain', size: 31, scope: 'mission', uploadedBy: 'ceo' } as any);
    await waitFor(() => s.files.get(f.id).extractionStatus !== 'pending', 4000, 'extraction');
    s.orchestrator.respondToTask(t.id, 'Yes, attached', 'ceo', [f.id]);
    await waitFor(() => s.store.getMission(m.id).status === 'completed', 8000, 'completed');
    const last = mock.calls.pop()!;
    expect(last.prompt).toContain('Brand colour: teal');
    const answerMsg = s.comms.list({ channel: 'global' }).find((x) => x.fromType === 'user' && x.taskId === t.id)!;
    expect(answerMsg.attachments.map((a) => a.name)).toEqual(['brief.txt']);
  });
});
