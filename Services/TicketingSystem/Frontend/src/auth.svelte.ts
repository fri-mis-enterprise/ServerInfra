// ============================================================
// Auth helpers — login / logout / session check
// ============================================================
import { getSession, login, logout, register } from './lib/auth.remote';
import { setCurrentUser } from './stores/user.svelte';
import { startPolling, stopPolling } from './stores/notifications.svelte';
import { startMessagePolling, stopMessagePolling } from './stores/messages.svelte';
import { fetchReferenceData } from './stores/reference.svelte';
import { navigate } from './router.svelte';
import { ws } from './lib/ws';
import type { User } from './lib/types';
import { initPushNotifications, stopPushNotifications } from './lib/pwa';
import { loginSchema, registerSchema } from './lib/validation/auth';

const auth = {
  /** Restore the session through SvelteKit's server query. */
  check: async (): Promise<User | null> => {
    try {
      await getSession().refresh();
      return await getSession();
    } catch {
      return null;
    }
  },

  /** Log in and bootstrap app state */
  login: async (username: string, password: string): Promise<string | void> => {
    const input = loginSchema.safeParse({ username, password });
    if (!input.success) return input.error.issues[0].message;
    try {
      const res = await login(input.data);
      if (res?.user) {
        setCurrentUser(res.user);
        await getSession().refresh();
        startPolling();
        fetchReferenceData();
        startMessagePolling();
        ws.connect();
        initPushNotifications(res.user).catch(console.error);
        await navigate('/');
      }
    } catch (e: any) {
      return e?.message ?? 'Login failed';
    }
  },

  /** Log out and clean up */
  logout: async (): Promise<string | void> => {
    try {
      await stopPushNotifications().catch(() => {});
      await logout();
      await getSession().refresh();
    } catch {
      // even if the request fails, clear local state
    }
    setCurrentUser(null);
    stopPolling();
    stopMessagePolling();
    ws.disconnect();
    await navigate('/login');
  },

  /** Register a new account */
  register: async (data: {
    username: string;
    password: string;
    email: string;
    first_name: string;
    last_name: string;
    position?: string;
    department_id?: number;
  }): Promise<string | void> => {
    const input = registerSchema.safeParse(data);
    if (!input.success) return input.error.issues[0].message;
    try {
      await register(input.data);
      await navigate('/login');
    } catch (e: any) {
      return e?.message ?? 'Registration failed';
    }
  },
};

export default auth;
