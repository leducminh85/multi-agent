import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Credential vault: AES-256-GCM with a 32-byte master key.
 * Format: v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('Master key must be exactly 32 bytes');
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const [version, ivB64, tagB64, ctB64] = payload.split(':');
    if (version !== 'v1' || !ivB64 || !tagB64 || ctB64 === undefined) throw new Error('Unsupported secret format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
  }

  encryptJson(obj: unknown): string {
    return this.encrypt(JSON.stringify(obj));
  }

  decryptJson<T>(payload: string | null | undefined, fallback: T): T {
    if (!payload) return fallback;
    return JSON.parse(this.decrypt(payload)) as T;
  }
}

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  const b = Buffer.from(trimmed, 'base64');
  if (b.length === 32) return b;
  // Derive a key from an arbitrary passphrase (documented as less ideal than a random key).
  return crypto.createHash('sha256').update(trimmed).digest();
}

/** Resolve the master key from env, or create/load `<dataDir>/master.key`. */
export function loadMasterKey(dataDir: string, envKey?: string): { key: Buffer; source: 'env' | 'file' | 'generated' } {
  if (envKey) return { key: parseKey(envKey), source: 'env' };
  const file = path.join(dataDir, 'master.key');
  if (fs.existsSync(file)) return { key: parseKey(fs.readFileSync(file, 'utf8')), source: 'file' };
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  return { key, source: 'generated' };
}

// ---------- password hashing (scrypt) ----------
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

export const generateToken = (): string => crypto.randomBytes(32).toString('base64url');
export const hashToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
