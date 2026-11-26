import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import { page } from '$app/state';

export const route = {
  get pathname() {
    return page.url.pathname.slice(resolve('/').replace(/\/$/, '').length) || '/';
  },
  get params() { return page.params; },
};

export function isActive(path: string) {
  return route.pathname === path;
}

export function navigate(path: string | number, options?: { params: Record<string, string> }) {
  if (typeof path === 'number') {
    window.history.go(path);
    return Promise.resolve();
  }
  const target = path.replace(/:([A-Za-z]+)/g, (_, name) => encodeURIComponent(options?.params[name] ?? ''));
  return goto(resolve('/').slice(0, -1) + target);
}
