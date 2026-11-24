import type { NextFunction, Request, Response } from 'express';
import type { Database } from '../db/database.js';
import { generateToken, hashPassword, hashToken, verifyPassword } from '../core/crypto.js';
import { HttpError, newId, nowIso } from '../core/util.js';

export interface AuthUser {
  id: string;
  username: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

export class AuthService {
  constructor(
    private db: Database,
    private ttlHours: number,
  ) {}

  hasUsers(): boolean {
    return !!this.db.get('SELECT id FROM users LIMIT 1');
  }

  /** First-run setup: creates the manager (CEO) account. Only allowed when no user exists. */
  setup(username: string, password: string): { token: string; user: AuthUser } {
    if (this.hasUsers()) throw new HttpError(409, 'Setup already completed', 'already_setup');
    validateCredentials(username, password);
    const id = newId('usr');
    this.db.run('INSERT INTO users (id, username, password_hash, created_at) VALUES (?,?,?,?)', [id, username, hashPassword(password), nowIso()]);
    return { token: this.createSession(id), user: { id, username } };
  }

  login(username: string, password: string): { token: string; user: AuthUser } {
    const row = this.db.get<any>('SELECT * FROM users WHERE username = ?', [username]);
    if (!row || !verifyPassword(password, row.password_hash)) throw new HttpError(401, 'Invalid username or password', 'invalid_credentials');
    return { token: this.createSession(row.id), user: { id: row.id, username: row.username } };
  }

  changePassword(userId: string, current: string, next: string): void {
    const row = this.db.get<any>('SELECT * FROM users WHERE id = ?', [userId]);
    if (!row || !verifyPassword(current, row.password_hash)) throw new HttpError(401, 'Current password is incorrect', 'invalid_credentials');
    validateCredentials(row.username, next);
    this.db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hashPassword(next), userId]);
    this.db.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
  }

  private createSession(userId: string): string {
    const token = generateToken();
    const now = new Date();
    const expires = new Date(now.getTime() + this.ttlHours * 3600_000);
    this.db.run('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?,?)', [
      newId('ses'),
      userId,
      hashToken(token),
      now.toISOString(),
      expires.toISOString(),
    ]);
    this.db.run('DELETE FROM sessions WHERE expires_at < ?', [now.toISOString()]);
    return token;
  }

  validate(token: string | undefined): AuthUser | null {
    if (!token) return null;
    const row = this.db.get<any>(
      'SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      [hashToken(token)],
    );
    if (!row || row.expires_at < nowIso()) return null;
    return { id: row.id, username: row.username };
  }

  logout(token: string): void {
    this.db.run('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  }

  middleware() {
    return (req: Request, _res: Response, next: NextFunction) => {
      const user = this.validate(extractToken(req));
      if (!user) return next(new HttpError(401, 'Authentication required', 'unauthenticated'));
      req.user = user;
      next();
    };
  }
}

export function extractToken(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return h.slice(7);
  // Allow ?token= only for file downloads opened in a new tab.
  const q = req.query?.token;
  return typeof q === 'string' && req.method === 'GET' ? q : undefined;
}

function validateCredentials(username: string, password: string) {
  if (!/^[\w.\-@]{3,64}$/.test(username)) throw new HttpError(400, 'Username must be 3–64 chars (letters, digits, . _ - @)');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
}

/** Sensitive operations require an explicit confirmation header set by the UI's confirm dialog. */
export function requireConfirmation(req: Request): void {
  if (req.headers['x-confirm-action'] !== 'true') {
    throw new HttpError(428, 'This action requires explicit confirmation', 'confirmation_required');
  }
}
