import { getSession, type SessionUser } from '@/authentication';

export async function isAuthenticated() {
  return Boolean(await getSession());
}

export function canAccessProtectedRoute(session: SessionUser | null) {
  return Boolean(session && session.email && session.fullName);
}

export function requireAuthentication(session: SessionUser | null) {
  if (!canAccessProtectedRoute(session)) {
    return { ok: false, message: 'Please log in to continue.' };
  }

  return { ok: true, session };
}
