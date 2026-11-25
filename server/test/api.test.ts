import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createMockAdapter, makeServices } from './helpers.js';

const mock = createMockAdapter(() => 'ok');
const env = makeServices(mock.adapter);
const app = createApp(env.s);
let token = '';
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(() => env.s.orchestrator.start());
afterAll(() => env.cleanup());

describe('REST API', () => {
  it('requires first-run setup, then authentication', async () => {
    const st = await request(app).get('/api/auth/status');
    expect(st.body.setupRequired).toBe(true);
    expect((await request(app).get('/api/agents')).status).toBe(401);

    const bad = await request(app).post('/api/auth/setup').send({ username: 'ceo', password: 'short' });
    expect(bad.status).toBe(400);
    const ok = await request(app).post('/api/auth/setup').send({ username: 'ceo', password: 'a-long-password' });
    expect(ok.status).toBe(201);
    token = ok.body.token;
    expect((await request(app).post('/api/auth/setup').send({ username: 'x', password: 'another-password' })).status).toBe(409);

    const login = await request(app).post('/api/auth/login').send({ username: 'ceo', password: 'wrong-password' });
    expect(login.status).toBe(401);
    const row = env.s.db.get<any>('SELECT password_hash FROM users');
    expect(row.password_hash).not.toContain('a-long-password');
  });

  it('never returns credentials to the client and stores them encrypted', async () => {
    const res = await request(app)
      .post('/api/providers')
      .set(auth())
      .send({ type: 'mock', name: 'Mock', config: {}, credentials: { apiKey: 'sk-secret-ABCD1234' }, maxConcurrency: 2 });
    expect(res.status).toBe(201);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('sk-secret');
    expect(res.body.credentialHints.apiKey).toBe('••••1234');
    const row = env.s.db.get<any>('SELECT credentials_enc FROM providers WHERE id = ?', [res.body.id]);
    expect(row.credentials_enc).not.toContain('sk-secret');
    const list = await request(app).get('/api/providers').set(auth());
    expect(JSON.stringify(list.body)).not.toContain('sk-secret');
    // audit log written without secrets
    const audit = await request(app).get('/api/audit').set(auth());
    expect(audit.body.some((a: any) => a.action === 'provider.create')).toBe(true);
    expect(JSON.stringify(audit.body)).not.toContain('sk-secret');
  });

  it('detects locally available AIs for the quick-setup wizard', async () => {
    const res = await request(app).get('/api/providers/detect').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.cli.map((c: any) => c.type).sort()).toEqual(['antigravity-cli', 'claude-code-cli', 'codex-cli']);
    for (const c of res.body.cli) expect(typeof c.found).toBe('boolean');
    expect(typeof res.body.ollama.found).toBe('boolean');
    expect(Array.isArray(res.body.ollama.models)).toBe(true);
  }, 60_000);

  it('creates agents, lists provider types and assigns work', async () => {
    const types = await request(app).get('/api/provider-types').set(auth());
    const typeIds = types.body.map((t: any) => t.type);
    for (const t of ['anthropic-api', 'claude-code-cli', 'openai-api', 'codex-cli', 'gemini-api', 'antigravity-cli', 'ollama', 'openai-compatible', 'subscription-tracker'])
      expect(typeIds).toContain(t);

    const roles = await request(app).get('/api/roles').set(auth());
    expect(roles.body.length).toBeGreaterThanOrEqual(9);
    const providers = await request(app).get('/api/providers').set(auth());
    const team = await request(app).post('/api/agents/team').set(auth()).send({ providerId: providers.body[0].id });
    expect(team.status).toBe(201);
    expect(team.body).toHaveLength(6);

    const dev = team.body.find((a: any) => a.roleKey === 'developer');
    const assign = await request(app).post(`/api/agents/${dev.id}/assign`).set(auth()).send({ text: 'say ok' });
    expect(assign.status).toBe(201);
    await env.s.orchestrator.idle();
    const m = await request(app).get(`/api/missions/${assign.body.id}`).set(auth());
    expect(m.body.status).toBe('completed');

    // Agent detail: `activity` stays the live state, the history is `activityLog` (mixing them crashed the UI).
    const detail = await request(app).get(`/api/agents/${dev.id}`).set(auth());
    expect(typeof detail.body.activity).toBe('string');
    expect(Array.isArray(detail.body.activityLog)).toBe(true);
    expect(detail.body.activityLog.length).toBeGreaterThan(0);

    // Model picker + switching an agent's AI/model.
    const models = await request(app).get(`/api/providers/${providers.body[0].id}/models`).set(auth());
    expect(models.status).toBe(200);
    expect(Array.isArray(models.body)).toBe(true);
    const switched = await request(app).patch(`/api/agents/${dev.id}`).set(auth()).send({ providerId: providers.body[0].id, model: 'mock-large' });
    expect(switched.status).toBe(200);
    expect(switched.body.model).toBe('mock-large');
    const reset = await request(app).patch(`/api/agents/${dev.id}`).set(auth()).send({ model: null });
    expect(reset.body.model).toBeNull();
    expect(m.body.tasks[0].output).toBe('ok');

    const overview = await request(app).get('/api/overview').set(auth());
    expect(overview.body.agents.total).toBe(6);
    expect(overview.body.tasks.completed).toBe(1);
  });

  it('requires explicit confirmation for destructive actions', async () => {
    const agents = await request(app).get('/api/agents').set(auth());
    const id = agents.body[0].id;
    const res = await request(app).delete(`/api/agents/${id}`).set(auth());
    expect(res.status).toBe(428);
    const ok = await request(app).delete(`/api/agents/${id}`).set(auth()).set('X-Confirm-Action', 'true');
    expect(ok.status).toBe(200);
    const stop = await request(app).post('/api/system/emergency-stop').set(auth());
    expect(stop.status).toBe(428);
  });

  it('validates input', async () => {
    const res = await request(app).post('/api/agents').set(auth()).send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('validation_error');
  });

  it('uploads files and extracts text', async () => {
    const res = await request(app)
      .post('/api/files')
      .set(auth())
      .attach('files', Buffer.from('name,score\nAn,9\nBình,8\n'), { filename: 'điểm.csv', contentType: 'text/csv' });
    expect(res.status).toBe(201);
    expect(res.body[0].name).toBe('điểm.csv');
    await new Promise((r) => setTimeout(r, 100));
    const text = await request(app).get(`/api/files/${res.body[0].id}/text`).set(auth());
    expect(text.body.text).toContain('Bình');
  });
});
