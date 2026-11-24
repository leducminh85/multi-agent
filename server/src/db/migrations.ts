import type { DatabaseSync } from 'node:sqlite';

/**
 * Ordered schema migrations. Each entry is applied once, inside a transaction.
 * Never edit an already-released migration – append a new one.
 */
const MIGRATIONS: string[] = [
  /* 1 – initial schema */ `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen_at TEXT
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE providers (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}',
    credentials_enc TEXT,
    credential_hint TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'unknown',
    status_message TEXT,
    last_checked_at TEXT,
    rate_limit TEXT,
    max_concurrency INTEGER NOT NULL DEFAULT 2,
    account_label TEXT,
    plan_name TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE roles (
    id TEXT PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    work_activity TEXT NOT NULL DEFAULT 'working',
    builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role_id TEXT NOT NULL REFERENCES roles(id),
    provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL,
    model TEXT,
    system_prompt TEXT NOT NULL DEFAULT '',
    specialties TEXT NOT NULL DEFAULT '',
    department TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    paused INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'idle',
    activity TEXT NOT NULL DEFAULT 'idle',
    activity_detail TEXT,
    current_task_id TEXT,
    permissions TEXT NOT NULL DEFAULT '{}',
    limits TEXT NOT NULL DEFAULT '{}',
    appearance TEXT NOT NULL DEFAULT '{}',
    last_active_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE missions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    request_text TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL,
    intent TEXT,
    plan TEXT,
    result TEXT,
    error TEXT,
    planner_agent_id TEXT,
    options TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    mission_id TEXT REFERENCES missions(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    parent_task_id TEXT,
    key TEXT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'work',
    role_key TEXT,
    agent_id TEXT,
    provider_id TEXT,
    status TEXT NOT NULL,
    progress REAL,
    depends_on TEXT NOT NULL DEFAULT '[]',
    output TEXT,
    error_log TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 2,
    waiting_reason TEXT,
    extra_context TEXT NOT NULL DEFAULT '[]',
    pinned INTEGER NOT NULL DEFAULT 0,
    not_before TEXT,
    depth INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_tasks_mission ON tasks(mission_id);
  CREATE INDEX idx_tasks_status ON tasks(status);
  CREATE INDEX idx_tasks_agent ON tasks(agent_id);
  CREATE TABLE task_steps (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    status TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE INDEX idx_steps_task ON task_steps(task_id);
  CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    mission_id TEXT,
    task_id TEXT,
    channel TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'message',
    from_type TEXT NOT NULL,
    from_id TEXT,
    from_name TEXT,
    to_type TEXT,
    to_id TEXT,
    to_name TEXT,
    content TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_messages_channel ON messages(channel, created_at);
  CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    mission_id TEXT,
    task_id TEXT,
    agent_id TEXT,
    provider_id TEXT,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_activities_created ON activities(created_at);
  CREATE INDEX idx_activities_agent ON activities(agent_id, created_at);
  CREATE TABLE usage_records (
    id TEXT PRIMARY KEY,
    provider_id TEXT,
    provider_type TEXT,
    agent_id TEXT,
    task_id TEXT,
    mission_id TEXT,
    model TEXT,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    reasoning_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL,
    cost_source TEXT NOT NULL DEFAULT 'unknown',
    source TEXT NOT NULL,
    requests INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_usage_created ON usage_records(created_at);
  CREATE INDEX idx_usage_provider ON usage_records(provider_id, created_at);
  CREATE TABLE quota_entries (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    label TEXT NOT NULL,
    used REAL,
    limit_value REAL,
    unit TEXT NOT NULL DEFAULT 'percent',
    resets_at TEXT,
    confidence TEXT NOT NULL,
    source TEXT NOT NULL,
    note TEXT,
    captured_at TEXT NOT NULL
  );
  CREATE INDEX idx_quota_provider ON quota_entries(provider_id, metric, captured_at);
  CREATE TABLE alerts (
    id TEXT PRIMARY KEY,
    provider_id TEXT,
    level TEXT NOT NULL,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    dedupe_key TEXT,
    acknowledged INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE INDEX idx_alerts_dedupe ON alerts(dedupe_key, resolved_at);
  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    project_id TEXT,
    agent_id TEXT,
    mission_id TEXT,
    name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    kind TEXT NOT NULL,
    extraction_status TEXT NOT NULL DEFAULT 'pending',
    extraction_note TEXT,
    extracted_text TEXT,
    uploaded_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE knowledge (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    project_id TEXT,
    agent_id TEXT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'manual',
    source_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_knowledge_scope ON knowledge(scope, project_id, agent_id);
  CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT NOT NULL DEFAULT '{}',
    ip TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_audit_created ON audit_log(created_at);
  CREATE TABLE approvals (
    id TEXT PRIMARY KEY,
    mission_id TEXT,
    task_id TEXT,
    agent_id TEXT,
    action_type TEXT NOT NULL,
    description TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    decided_by TEXT,
    decision_note TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT
  );
  `,
];

export function migrate(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null };
  const current = row?.v ?? 0;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[i]);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(i + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
