import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, get, onUnauthorized, post } from './api';
import type { Admin, Permission } from './types';

interface AuthContextValue {
  admin: Admin | null;
  checking: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
  expired: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [checking, setChecking] = useState(true);
  const [expired, setExpired] = useState(false);

  const loadMe = useCallback(async () => {
    try {
      const result = await get<{ admin: Admin }>('/auth/me');
      setAdmin(result.admin);
      setExpired(false);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) console.error(error);
      setAdmin(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const adminRef = useRef<Admin | null>(null);
  adminRef.current = admin;

  useEffect(() => onUnauthorized(() => {
    if (adminRef.current) setExpired(true);
    setAdmin(null);
  }), []);

  const login = useCallback(async (email: string, password: string) => {
    await post('/auth/login', { email, password });
    await loadMe();
  }, [loadMe]);

  const logout = useCallback(async () => {
    try {
      await post('/auth/logout');
    } finally {
      setAdmin(null);
      setExpired(false);
    }
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    admin,
    checking,
    login,
    logout,
    expired,
    can: (permission) => Boolean(admin?.permissions.includes(permission)),
  }), [admin, checking, login, logout, expired]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
