import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import auth from '../auth.svelte';
import { getCurrentUser, setCurrentUser } from '../stores/user.svelte';
import { startPolling } from '../stores/notifications.svelte';
import { startMessagePolling } from '../stores/messages.svelte';
import { fetchReferenceData } from '../stores/reference.svelte';
import { ws } from '../lib/ws';

// Keep browser-only editors and stores client-rendered while server workflows migrate.
export const ssr = false;

export async function load({ url }) {
  let user = getCurrentUser();
  if (!user) {
    user = await auth.check();
    if (user) {
      setCurrentUser(user);
      startPolling();
      startMessagePolling();
      void fetchReferenceData();
      void ws.connect();
    }
  }

  const publicPage = url.pathname === resolve('/login') || url.pathname === resolve('/register');
  if (!user && !publicPage) redirect(307, resolve('/login'));
  if (user && publicPage) redirect(307, resolve('/'));
}
