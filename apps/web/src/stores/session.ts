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
  /** 接受邀请后用换发的凭证原地切换活动库，不丢本地其他状态 */
  switchSession: (token: string, user: AuthUser) => void;
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
  switchSession: (token, user) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    set({ token, user });
  },
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
