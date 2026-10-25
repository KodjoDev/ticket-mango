import { useQueryClient } from '@tanstack/react-query';
import { hasPermission, type Permission } from '@ticketing/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, setUnauthorizedHandler } from '../api/client';
import type { User } from '../api/types';

interface AuthState {
  /** `undefined` pendant la vérification de session, `null` si déconnecté. */
  user: User | null | undefined;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 401)) console.error(err);
        setUser(null);
      });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      queryClient.clear();
    });
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const { user } = await api.login(email, password);
    setUser(user);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    queryClient.clear();
    setUser(null);
  }, [queryClient]);

  const can = useCallback((permission: Permission) => !!user && hasPermission(user.role, permission), [user]);

  const value = useMemo(() => ({ user, login, logout, can }), [user, login, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}

/** Variante pour les pages protégées, où l'utilisateur est garanti. */
export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error('Utilisateur non connecté');
  return user;
}
