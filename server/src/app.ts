import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { Services } from './container.js';
import { HttpError } from './core/util.js';
import { agentRoutes } from './routes/agents.js';
import { accountRoutes, authRoutes } from './routes/auth.js';
import { dataRoutes } from './routes/data.js';
import { errorHandler } from './routes/helpers.js';
import { providerRoutes } from './routes/providers.js';
import { systemRoutes } from './routes/system.js';
import { workRoutes } from './routes/work.js';

export function createApp(s: Services): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Agents may embed images/videos from the web in their answers (shown inline in chat and results).
          'img-src': ["'self'", 'data:', 'blob:', 'https:'],
          'media-src': ["'self'", 'blob:', 'https:'],
          'frame-src': ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'style-src': ["'self'", "'unsafe-inline'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  if (s.config.corsOrigin) {
    app.use((req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', s.config.corsOrigin!);
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Confirm-Action');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }
  app.use(express.json({ limit: '5mb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: s.config.rateLimitPerMin, standardHeaders: true, legacyHeaders: false }));

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
  app.use('/api/auth', authRoutes(s));

  const api = express.Router();
  api.use(s.auth.middleware());
  api.use('/account', accountRoutes(s));
  api.use(providerRoutes(s));
  api.use(agentRoutes(s));
  api.use(workRoutes(s));
  api.use(dataRoutes(s));
  api.use(systemRoutes(s));
  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'API route not found', 'not_found')));

  // Serve the built web app (production).
  if (fs.existsSync(path.join(s.config.webDist, 'index.html'))) {
    app.use(express.static(s.config.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(s.config.webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
