export type AgentActivity = 'idle' | 'working' | 'thinking' | 'reading' | 'writing' | 'coding' | 'discussing' | 'waiting' | 'error' | 'completed';
export type TaskStatus = 'pending' | 'planning' | 'assigned' | 'running' | 'waiting' | 'reviewing' | 'completed' | 'failed' | 'cancelled';

export interface AgentPermissions {
  knowledgeScopes: ('global' | 'project' | 'agent')[];
  fileAccess: 'none' | 'project' | 'all';
  allowCommandExecution: boolean;
  allowFileWrite: boolean;
  allowNetwork: boolean;
  canDelegate: boolean;
  canMessageAgents: boolean;
  requireApprovalForSensitiveActions: boolean;
}

export interface AgentLimits {
  maxConcurrentTasks: number;
  maxOutputTokens: number;
  timeoutMs: number;
  dailyTokenBudget: number | null;
}

export interface Agent {
  id: string;
  name: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  providerId: string | null;
  providerName: string | null;
  providerType: string | null;
  model: string | null;
  systemPrompt: string;
  specialties: string;
  department: string;
  enabled: boolean;
  paused: boolean;
  activity: AgentActivity;
  activityDetail: string | null;
  currentTaskId: string | null;
  permissions: AgentPermissions;
  limits: AgentLimits;
  appearance: { color?: string; hair?: number };
  lastActiveAt: string | null;
  createdAt: string;
  unavailableReason?: string | null;
  tokensToday?: number;
}

export interface AgentDetail extends Agent {
  currentTask: Task | null;
  recentTasks: Task[];
  activity: AgentActivity;
  activityLog?: Activity[];
  memory: Knowledge[];
}

export interface Role {
  id: string;
  key: string;
  name: string;
  description: string;
  department: string;
  systemPrompt: string;
  workActivity: string;
  builtin: boolean;
}

export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select';
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: string[];
  default?: string | number | boolean;
}

export interface ProviderDescriptor {
  type: string;
  displayName: string;
  vendor: string;
  integration: 'api' | 'cli' | 'local-server' | 'tracking-only';
  description: string;
  configFields: FieldDef[];
  credentialFields: FieldDef[];
  capabilities: {
    streaming: boolean;
    vision: boolean;
    transcription: boolean;
    video: boolean;
    agenticTools: boolean;
    usageReporting: 'tokens' | 'tokens+cost' | 'none';
    billingApi: boolean;
    rateLimitHeaders: boolean;
    subscriptionQuotaApi: boolean;
  };
  suggestedModels: string[];
  limitations: string[];
  canExecute: boolean;
}

export interface RateLimitInfo {
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsReset?: string;
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensReset?: string;
  capturedAt: string;
}

export interface Provider {
  id: string;
  type: string;
  name: string;
  config: Record<string, any>;
  enabled: boolean;
  status: 'unknown' | 'connected' | 'error' | 'disabled';
  /** Out of quota until this time (the office uses another AI meanwhile). */
  cooldownUntil?: string | null;
  statusMessage: string | null;
  lastCheckedAt: string | null;
  rateLimit: RateLimitInfo | null;
  maxConcurrency: number;
  accountLabel: string | null;
  planName: string | null;
  credentialHints: Record<string, string>;
  integration: string;
  canExecute: boolean;
  vendor: string;
  displayName: string;
}

export interface TaskStep {
  id: string;
  taskId: string;
  label: string;
  status: 'running' | 'done' | 'failed' | 'info';
  detail: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface Task {
  id: string;
  missionId: string | null;
  projectId: string | null;
  parentTaskId: string | null;
  key: string | null;
  title: string;
  description: string;
  kind: 'work' | 'help' | 'review' | 'synthesis' | 'direct';
  roleKey: string | null;
  agentId: string | null;
  agentName: string | null;
  providerId: string | null;
  providerName: string | null;
  status: TaskStatus;
  progress: number | null;
  dependsOn: string[];
  output: string | null;
  errorLog: string;
  attempts: number;
  maxAttempts: number;
  waitingReason: string | null;
  pinned: boolean;
  depth: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
  steps?: TaskStep[];
}

export interface TaskDetail extends Task {
  isRunning: boolean;
  subtasks: Task[];
  dependencies: Task[];
  messages: Message[];
  usage: any[];
  approvals: Approval[];
}

export interface Mission {
  id: string;
  projectId: string;
  title: string;
  requestText: string;
  attachments: string[];
  status: 'planning' | 'running' | 'completed' | 'failed' | 'cancelled';
  intent: string | null;
  plan: { summary?: string; fallbackReason?: string | null; tasks?: any[] } | null;
  result: string | null;
  error: string | null;
  plannerAgentId: string | null;
  options: { mode?: 'auto' | 'direct'; agentId?: string };
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  taskCounts?: Record<string, number>;
  progress?: { completed: number; total: number };
  tasks?: Task[];
}

export interface Message {
  id: string;
  missionId: string | null;
  taskId: string | null;
  channel: 'global' | 'agents';
  kind: string;
  fromType: 'user' | 'agent' | 'system';
  fromId: string | null;
  fromName: string | null;
  toType: string | null;
  toId: string | null;
  toName: string | null;
  content: string;
  attachments: { fileId: string; name: string }[];
  createdAt: string;
}

export interface Activity {
  id: string;
  type: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  missionId: string | null;
  taskId: string | null;
  agentId: string | null;
  providerId: string | null;
  createdAt: string;
}

export interface Knowledge {
  id: string;
  scope: 'global' | 'project' | 'agent';
  projectId: string | null;
  agentId: string | null;
  title: string;
  content: string;
  tags: string;
  sourceType: string;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredFile {
  id: string;
  scope: string;
  projectId: string | null;
  agentId: string | null;
  missionId: string | null;
  name: string;
  mime: string;
  size: number;
  kind: string;
  extractionStatus: 'pending' | 'processing' | 'done' | 'failed' | 'unsupported' | 'stored';
  extractionNote: string | null;
  hasText: boolean;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'archived';
  createdAt: string;
  stats?: { missions: number; tasks: number; runningTasks: number; files: number; knowledge: number };
}

export interface QuotaEntry {
  id: string;
  providerId: string;
  metric: string;
  label: string;
  used: number | null;
  limitValue: number | null;
  unit: string;
  resetsAt: string | null;
  confidence: 'actual' | 'estimated' | 'unknown';
  source: 'manual' | 'provider_api' | 'cli' | 'computed';
  note: string | null;
  capturedAt: string;
  percentUsed: number | null;
  stale: boolean;
}

export interface Alert {
  id: string;
  providerId: string | null;
  level: 'info' | 'warning' | 'critical';
  kind: string;
  message: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface Approval {
  id: string;
  missionId: string | null;
  taskId: string | null;
  agentId: string | null;
  actionType: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  decisionNote: string | null;
  createdAt: string;
}

export interface Settings {
  runtime: {
    maxConcurrentTasks: number;
    defaultMaxAttempts: number;
    retryBaseDelayMs: number;
    maxDelegationDepth: number;
    autoSynthesis: boolean;
    autoReview: boolean;
    maxContextChars: number;
  };
  usage: { warnPercent: number; criticalPercent: number; billingSyncMinutes: number; healthCheckMinutes: number };
  media: { transcriptionProviderId: string | null; visionProviderId: string | null };
  orchestrator: { plannerAgentId: string | null; coordinatorAgentId: string | null };
  pricing: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }>;
}
