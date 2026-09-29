import { create } from 'zustand';
import type { AuthUser } from '@flil/shared';

const TOKEN_KEY = 'flil.token';
const USER_KEY = 'flil.user';

interface SessionState {
  token: string | null;
  user: AuthUser | null;
  libraryTz: string;
  setSession: (token: string, user: AuthUser) => void;
  setLibraryTz: (tz: string) => void;
  clear: () => void;
}

export const useSession = create<SessionState>((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  user: (() => {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  })(),
  libraryTz: 'Asia/Shanghai',
  setSession: (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },
  setLibraryTz: (tz) => set({ libraryTz: tz }),
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    set({ token: null, user: null });
  },
}));

export function authHeaders(): Record<string, string> {
  const token = useSession.getState().token;
  return token ? { authorization: `Bearer ${token}` } : {};
}
