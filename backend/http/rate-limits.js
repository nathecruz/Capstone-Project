import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { authToken, hashToken, normalizeEmail } from '../lib/http.js';

const WINDOW = 15 * 60 * 1000;

// Students on the campus network share one public IP, so signed-in traffic is
// limited per session token and sign-in attempts per IP + email, not per IP alone.
const clientKey = (request) => {
  const token = authToken(request);
  return token ? `token:${hashToken(token).slice(0, 32)}` : `ip:${ipKeyGenerator(request.ip)}`;
};
const emailKey = (request) => `${ipKeyGenerator(request.ip)}:${normalizeEmail(request.body?.email ?? '')}`;

function limiter({ limit, keyGenerator = clientKey, message }) {
  return rateLimit({
    windowMs: WINDOW,
    limit,
    keyGenerator,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { ok: false, message },
  });
}

export const apiLimiter = limiter({ limit: 900, message: 'Too many requests. Please slow down and try again shortly.' });
export const loginLimiter = limiter({ limit: 10, keyGenerator: emailKey, message: 'Too many sign-in attempts for this account. Please wait 15 minutes and try again.' });
export const registerLimiter = limiter({ limit: 20, keyGenerator: (request) => `ip:${ipKeyGenerator(request.ip)}`, message: 'Too many sign-up attempts from this network. Please try again later.' });
export const resetRequestLimiter = limiter({ limit: 5, keyGenerator: emailKey, message: 'Too many password reset requests. Please try again later.' });
export const resetVerificationLimiter = limiter({ limit: 15, keyGenerator: emailKey, message: 'Too many verification attempts. Please try again later.' });
export const resendVerificationLimiter = limiter({ limit: 20, message: 'Too many verification requests. Please try again later.' });
export const aiLimiter = limiter({ limit: 30, message: 'You have reached the AI request limit. Please try again in a few minutes.' });
export const predictionLimiter = limiter({ limit: 120, message: 'Too many prediction requests. Please try again shortly.' });
