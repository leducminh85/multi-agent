import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { extractToken } from '../auth/auth.js';
import type { Services } from '../container.js';
import { ah } from './helpers.js';

const creds = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(200) });

export function authRoutes(s: Services): Router {
  const r = Router();
  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many login attempts, try again later' } });

  r.get(
    '/status',
    ah((req, res) => {
      const user = s.auth.validate(extractToken(req));
      res.json({ setupRequired: !s.auth.hasUsers(), user });
    }),
  );

  r.post(
    '/setup',
    loginLimiter,
    ah((req, res) => {
      const { username, password } = creds.parse(req.body);
      const out = s.auth.setup(username, password);
      s.audit.log(username, 'auth.setup', { type: 'user', id: out.user.id }, {}, req.ip);
      res.status(201).json(out);
    }),
  );

  r.post(
    '/login',
    loginLimiter,
    ah((req, res) => {
      const { username, password } = creds.parse(req.body);
      try {
        const out = s.auth.login(username, password);
        s.audit.log(username, 'auth.login', { type: 'user', id: out.user.id }, {}, req.ip);
        res.json(out);
      } catch (e) {
        s.audit.log(username, 'auth.login_failed', { type: 'user' }, {}, req.ip);
        throw e;
      }
    }),
  );

  r.post(
    '/logout',
    ah((req, res) => {
      const token = extractToken(req);
      if (token) s.auth.logout(token);
      res.json({ ok: true });
    }),
  );

  return r;
}

export function accountRoutes(s: Services): Router {
  const r = Router();
  r.post(
    '/password',
    ah((req, res) => {
      const { current, next } = z.object({ current: z.string(), next: z.string().min(8) }).parse(req.body);
      s.auth.changePassword(req.user!.id, current, next);
      s.audit.log(req.user!.username, 'auth.password_changed', { type: 'user', id: req.user!.id }, {}, req.ip);
      res.json({ ok: true });
    }),
  );
  return r;
}
