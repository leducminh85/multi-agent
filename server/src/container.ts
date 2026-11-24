import { AgentService } from './agents/service.js';
import { RoleService } from './agents/roles.js';
import { AuthService } from './auth/auth.js';
import { CommsService } from './comms/service.js';
import type { AppConfig } from './config.js';
import { ActivityService } from './core/activity.js';
import { AuditService } from './core/audit.js';
import { SecretBox, loadMasterKey } from './core/crypto.js';
import { EventBus } from './core/eventBus.js';
import { SettingsService } from './core/settings.js';
import { Database } from './db/database.js';
import { FileService } from './files/service.js';
import { KnowledgeService } from './knowledge/service.js';
import { ApprovalService } from './orchestrator/approvals.js';
import { ContextBuilder } from './orchestrator/context.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { AgentRuntime } from './orchestrator/runtime.js';
import { Store } from './orchestrator/store.js';
import { ProjectService } from './projects/service.js';
import { ProviderRegistry } from './providers/registry.js';
import { ProviderService } from './providers/service.js';
import type { ProviderAdapter } from './providers/types.js';
import { UsageService } from './usage/service.js';

export interface Services {
  config: AppConfig;
  db: Database;
  bus: EventBus;
  box: SecretBox;
  masterKeySource: string;
  registry: ProviderRegistry;
  settings: SettingsService;
  audit: AuditService;
  activity: ActivityService;
  auth: AuthService;
  providers: ProviderService;
  roles: RoleService;
  agents: AgentService;
  projects: ProjectService;
  usage: UsageService;
  comms: CommsService;
  knowledge: KnowledgeService;
  files: FileService;
  store: Store;
  approvals: ApprovalService;
  runtime: AgentRuntime;
  context: ContextBuilder;
  orchestrator: Orchestrator;
  dispose(): Promise<void>;
}

/** Composition root: wires every module together. Extra adapters can be injected (plugins, tests). */
export function createServices(config: AppConfig, opts: { adapters?: ProviderAdapter[]; extraAdapters?: ProviderAdapter[] } = {}): Services {
  const db = new Database(config.dbFile);
  const bus = new EventBus();
  const { key, source } = loadMasterKey(config.dataDir, config.masterKey);
  const box = new SecretBox(key);
  const registry = new ProviderRegistry(opts.adapters);
  for (const a of opts.extraAdapters ?? []) registry.register(a);

  const settings = new SettingsService(db, bus);
  const audit = new AuditService(db);
  const activity = new ActivityService(db, bus);
  const auth = new AuthService(db, config.sessionTtlHours);
  const providers = new ProviderService(db, box, bus, registry);
  const roles = new RoleService(db, bus);
  roles.seedBuiltins();
  const agents = new AgentService(db, bus, roles);
  const projects = new ProjectService(db, bus, config.workspacesDir);
  projects.ensureDefault();
  const usage = new UsageService(db, bus, settings, providers, activity);
  const comms = new CommsService(db, bus);
  const knowledge = new KnowledgeService(db, bus);
  const files = new FileService(db, bus, config.storageDir, settings, providers, usage, activity, config.ffmpegPath);
  const store = new Store(db, bus);
  const approvals = new ApprovalService(db, bus);
  const runtime = new AgentRuntime(agents, providers, usage, activity);
  const context = new ContextBuilder(store, agents, roles, knowledge, files, comms, settings);
  const orchestrator = new Orchestrator({
    store,
    agents,
    roles,
    providers,
    runtime,
    context,
    comms,
    knowledge,
    files,
    projects,
    approvals,
    settings,
    activity,
    audit,
    bus,
  });

  return {
    config,
    db,
    bus,
    box,
    masterKeySource: source,
    registry,
    settings,
    audit,
    activity,
    auth,
    providers,
    roles,
    agents,
    projects,
    usage,
    comms,
    knowledge,
    files,
    store,
    approvals,
    runtime,
    context,
    orchestrator,
    async dispose() {
      await orchestrator.stop();
      runtime.dispose();
      db.close();
    },
  };
}
