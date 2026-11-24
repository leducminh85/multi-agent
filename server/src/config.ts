import path from 'node:path';
import fs from 'node:fs';

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  dbFile: string;
  storageDir: string;
  workspacesDir: string;
  backupsDir: string;
  masterKey?: string;
  sessionTtlHours: number;
  maxUploadMb: number;
  corsOrigin?: string;
  webDist: string;
  ffmpegPath: string;
  rateLimitPerMin: number;
}

/** Load `.env` from the repo root or the server dir (without overriding real env vars). */
export function loadEnvFiles(): void {
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '..', '.env')];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        process.loadEnvFile(file);
      } catch {
        /* malformed env file: ignore, real env still applies */
      }
    }
  }
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const env = process.env;
  const dataDir = path.resolve(overrides.dataDir ?? env.MAO_DATA_DIR ?? path.join(process.cwd(), 'data'));
  const cfg: AppConfig = {
    host: env.MAO_HOST || '127.0.0.1',
    port: Number(env.MAO_PORT || 4317),
    dataDir,
    dbFile: path.join(dataDir, 'office.db'),
    storageDir: path.join(dataDir, 'storage'),
    workspacesDir: path.join(dataDir, 'workspaces'),
    backupsDir: path.join(dataDir, 'backups'),
    masterKey: env.MAO_MASTER_KEY || undefined,
    sessionTtlHours: Number(env.MAO_SESSION_TTL_HOURS || 168),
    maxUploadMb: Number(env.MAO_MAX_UPLOAD_MB || 200),
    corsOrigin: env.MAO_CORS_ORIGIN || undefined,
    webDist: path.resolve(env.MAO_WEB_DIST || path.join(process.cwd(), '..', 'web', 'dist')),
    ffmpegPath: env.MAO_FFMPEG_PATH || 'ffmpeg',
    rateLimitPerMin: Number(env.MAO_RATE_LIMIT_PER_MIN || 600),
    ...overrides,
  };
  if (overrides.dataDir && !overrides.dbFile) cfg.dbFile = path.join(dataDir, 'office.db');
  for (const dir of [cfg.dataDir, cfg.storageDir, cfg.workspacesDir, cfg.backupsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return cfg;
}
