import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { query } from './db.js';
import { HttpError } from './lib/http.js';
import { loadAdmin, requireAuth, requireCsrfHeader } from './middleware/auth.js';
import accessRequestRoutes from './routes/access-requests.js';
import analyticsRoutes from './routes/analytics.js';
import auditRoutes from './routes/audit.js';
import authRoutes from './routes/auth.js';
import categoryRoutes from './routes/categories.js';
import notificationRoutes from './routes/notifications.js';
import overviewRoutes from './routes/overview.js';
import settingsRoutes from './routes/settings.js';
import supportRoutes from './routes/support.js';
import userRoutes from './routes/users.js';

export function createApp() {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        // Would break plain-HTTP deployments on a LAN; HTTPS hosts get HSTS instead.
        upgradeInsecureRequests: null,
      },
    },
  }));
  app.use(cors({ origin: config.allowedOrigins, credentials: true }));
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  app.get('/healthz', async (_request, response) => {
    try {
      await query('SELECT 1');
      response.json({ ok: true, database: 'up' });
    } catch {
      response.status(503).json({ ok: false, database: 'down' });
    }
  });

  const api = express.Router();
  api.use(rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));
  api.use((_request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(requireCsrfHeader);
  api.use(loadAdmin);
  api.use('/auth', authRoutes);
  api.use(requireAuth);
  api.use('/overview', overviewRoutes);
  api.use('/users', userRoutes);
  api.use('/access-requests', accessRequestRoutes);
  api.use('/categories', categoryRoutes);
  api.use('/notifications', notificationRoutes);
  api.use('/analytics', analyticsRoutes);
  api.use('/support', supportRoutes);
  api.use('/audit', auditRoutes);
  api.use('/settings', settingsRoutes);
  api.use((_request, _response, next) => next(new HttpError(404, 'API route not found.')));
  app.use('/api', api);

  // In production the built React client is served by this same server.
  const indexFile = path.join(config.clientDist, 'index.html');
  if (existsSync(indexFile)) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_request, response) => response.sendFile(indexFile));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((error, _request, response, _next) => {
    if (error instanceof HttpError) {
      return response.status(error.status).json({ ok: false, message: error.message, issues: error.details });
    }
    if (error?.type === 'entity.parse.failed') {
      return response.status(400).json({ ok: false, message: 'Request body is not valid JSON.' });
    }
    if (error?.code === '23505') {
      return response.status(409).json({ ok: false, message: 'That value is already in use.' });
    }
    console.error('[error]', error);
    return response.status(500).json({ ok: false, message: 'Something went wrong on the server. Please try again.' });
  });

  return app;
}
