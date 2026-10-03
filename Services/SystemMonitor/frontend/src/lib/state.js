import { writable, get } from 'svelte/store';
import { base } from '$app/paths';
import { goto } from '$app/navigation';
export const auth = writable({ user: null, csrf: '', writes: false, fast_writes: false, server_time: '' });
export const notices = writable([]);
let noticeId = 0;
export function notice(text, kind = 'success') { notices.update(items => [...items, { id: ++noticeId, text, kind }]); }
export async function api(path, data) {
  const options = { credentials: 'same-origin', headers: { Accept: 'application/json' } };
  if (data !== undefined) {
    options.method = 'POST';
    options.headers['Content-Type'] = 'application/json';
    options.headers['X-CSRF-Token'] = get(auth).csrf;
    options.body = JSON.stringify(data);
  }
  const response = await fetch(`${base}/api${path}`, options);
  let result;
  try { result = await response.json(); } catch { throw new Error('The server is unavailable. Please try again.'); }
  if (!response.ok) {
    if (response.status === 401 && path !== '/login') {
      auth.update(value => ({ ...value, user: null }));
      goto(`${base}/login`);
    }
    throw new Error(result.error || 'The request could not be completed.');
  }
  return result;
}
export const months = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function time(value, seconds = false) {
  if (!value) return 'Never';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hour12: true }).format(new Date(value));
}
