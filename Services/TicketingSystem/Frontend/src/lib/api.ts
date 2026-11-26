import { resolve } from '$app/paths';
import { triggerAlert } from '../stores/ui.svelte';
import { setCurrentUser } from '../stores/user.svelte';

export const API_BASE = resolve('/').replace(/\/$/, '');

async function attachmentRequest(path: string, options: RequestInit) {
  const response = await fetch(`${API_BASE}/api/attachments${path}`, { ...options, credentials: 'same-origin' });
  if (response.status === 401) setCurrentUser(null);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    const message = data?.message || 'Attachment request failed';
    triggerAlert(message, 'error');
    throw new Error(message);
  }
  return response.status === 204 ? undefined : response.json();
}

export const api = {
  validateUploads(files: FileList | File[]) {
    if (files.length > 5) throw new Error('Upload up to 5 files at a time.');
    if (Array.from(files).some(file => file.size > 20 * 1024 * 1024)) throw new Error('Each attachment must be 20 MB or smaller.');
  },
  upload(ticketId: number, files: FileList | File[], type?: string) {
    api.validateUploads(files);
    const body = new FormData();
    body.append('ticket_id', String(ticketId));
    for (const file of files) body.append('files', file);
    if (type) body.append('type', type);
    return attachmentRequest('', { method: 'POST', body });
  },
  deleteAttachment: (id: number) => attachmentRequest(`/${id}`, { method: 'DELETE' }),
};
