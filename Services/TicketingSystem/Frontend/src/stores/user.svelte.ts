// ============================================================
// User store — Svelte 5 runes
// ============================================================
import type { User, Role } from '../lib/types';

let currentUser: User | null = $state(null);

export function getCurrentUser(): User | null {
  return currentUser;
}

/** 
 * Set current user with defensive flattening for roles.
 * Some Prisma/API implementations return roles as [{ role: 'admin' }]
 * while we expect ['admin'].
 */
export function setCurrentUser(user: User | null) {
  if (user && user.roles) {
    // If it's an array of objects, extract the role strings
    if (typeof user.roles[0] === 'object' && (user.roles[0] as any).role) {
      user.roles = (user.roles as any).map((r: any) => r.role);
    }
  }
  currentUser = user;
}

/** Check if the current user has one of the given roles */
export function hasRole(...roles: Role[]): boolean {
  if (!currentUser || !currentUser.roles) return false;
  return roles.some((r) => currentUser!.roles.includes(r));
}

/** Check if user is staff (MIS, approver, or admin) */
export function isStaff(): boolean {
  return hasRole('mis', 'approver', 'admin');
}

/** Get display name with username fallback */
export function displayName(): string {
  if (!currentUser) return '';
  if (currentUser.first_name && currentUser.last_name) {
    return `${currentUser.first_name} ${currentUser.last_name}`;
  }
  return currentUser.username;
}

/** Get user initials for avatar placeholder */
export function userInitials(): string {
  if (!currentUser) return '?';
  const first = currentUser.first_name?.[0] || currentUser.username[0];
  const last = currentUser.last_name?.[0] || currentUser.username[1] || '';
  return `${first}${last}`.toUpperCase();
}
