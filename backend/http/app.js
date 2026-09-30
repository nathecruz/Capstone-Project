import cors from 'cors';
import express from 'express';
import { config } from '../config/index.js';
import registerAiRoutes from '../routes/ai.js';
import registerAppStateRoutes from '../routes/app-state.js';
import registerAuthRoutes from '../routes/auth.js';
import registerGamificationRoutes from '../routes/gamification.js';
import registerHabitRoutes from '../routes/habits.js';
import registerHealthRoutes from '../routes/health.js';
import registerNotificationRoutes from '../routes/notifications.js';
import registerPasswordResetRoutes from '../routes/password-reset.js';
import registerSupportRoutes from '../routes/support.js';
import { apiLimiter } from './rate-limits.js';

/** Expo dev servers on this machine or the LAN (never in production). */
function isLocalDevelopmentOrigin(origin) {
  if (config.isProduction) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const isPrivateAddress = /^10\./.test(hostname) || /^192\.168\./.test(hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
    const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    return url.protocol === 'http:' && ['8081', '8082', '19006', '19080'].includes(url.port) && (isPrivateAddress || isLocalHost);
  } catch {
    return false;
  }
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // maxAge lets browsers cache the CORS preflight instead of sending OPTIONS before every poll.
  app.use(cors({ origin: (origin, callback) => callback(null, !origin || config.allowedOrigins.has(origin) || isLocalDevelopmentOrigin(origin)), maxAge: 600 }));
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', apiLimiter);

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerPasswordResetRoutes(app);
  registerAppStateRoutes(app);
  registerHabitRoutes(app);
  registerNotificationRoutes(app);
  registerSupportRoutes(app);
  registerGamificationRoutes(app);
  registerAiRoutes(app);

  app.use('/api', (_request, response) => response.status(404).json({ ok: false, message: 'API route not found.' }));

  // Express 5 forwards rejected promises here: answer with JSON, never with a stack trace.
  // eslint-disable-next-line no-unused-vars
  app.use((error, request, response, _next) => {
    if (error?.type === 'entity.parse.failed') return response.status(400).json({ ok: false, message: 'Request body is not valid JSON.' });
    if (error?.type === 'entity.too.large') return response.status(413).json({ ok: false, message: 'Request body is too large.' });
    console.error(`[api] ${request.method} ${request.path} failed:`, error);
    if (response.headersSent) return undefined;
    return response.status(500).json({ ok: false, message: 'Something went wrong on the server. Please try again.' });
  });

  return app;
}
