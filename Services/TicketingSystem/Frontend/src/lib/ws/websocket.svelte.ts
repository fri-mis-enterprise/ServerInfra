import { resolve } from '$app/paths';
import { pushNotification, fetchUnreadCount } from '../../stores/notifications.svelte';
import { fetchMessageUnreadCount } from '../../stores/messages.svelte';
import type { WSNotification, WSTicketUpdate, WSComment, WSMessage } from './types';

class TicketingEvents {
  status = $state<'connected' | 'disconnected' | 'connecting' | 'error'>('disconnected');
  #source: EventSource | null = null;
  #enabled = false;
  #onMessageCbs = new Set<(message: WSMessage) => void>();
  #onTicketUpdateCbs = new Map<number, Set<(update: WSTicketUpdate) => void>>();
  #onCommentCbs = new Map<number, Set<(comment: WSComment) => void>>();
  #onNotificationCbs = new Set<(notification: WSNotification) => void>();
  #onReadCbs = new Set<(data: { reader_id: number; ticket_id?: number }) => void>();
  #onReconnectCbs = new Set<() => void>();

  async connect() {
    this.#enabled = true;
    if (this.#source) return;
    this.#open();
  }
  #open() {
    this.#source?.close();
    if (!this.#enabled) return;
    const tickets = [...new Set([...this.#onTicketUpdateCbs.keys(), ...this.#onCommentCbs.keys()])];
    this.status = 'connecting';
    const source = this.#source = new EventSource(`${resolve('/')}api/events${tickets.length ? `?tickets=${tickets.join(',')}` : ''}`);
    let opened = false;
    source.onopen = () => {
      if (source !== this.#source) return;
      this.status = 'connected';
      fetchUnreadCount();
      fetchMessageUnreadCount();
      if (opened) {
        for (const [ticket_id, callbacks] of this.#onTicketUpdateCbs) callbacks.forEach(callback => callback({ ticket_id, field: 'reconnect, refresh', old_value: null, new_value: null, updated_by: '' }));
        this.#onReconnectCbs.forEach(callback => callback());
      }
      opened = true;
    };
    source.onerror = () => { if (source === this.#source) this.status = 'error'; };
    source.onmessage = event => {
      if (source !== this.#source) return;
      let envelope;
      try { envelope = JSON.parse(event.data); } catch { return; }
      const payload = envelope.payload;
      switch (envelope.type) {
        case 'notification':
          pushNotification(payload);
          this.#onNotificationCbs.forEach(callback => callback(payload));
          break;
        case 'ticket_updated': this.#onTicketUpdateCbs.get(payload.ticket_id)?.forEach(callback => callback(payload)); break;
        case 'comment_added': this.#onCommentCbs.get(payload.ticket_id)?.forEach(callback => callback(payload.comment)); break;
        case 'message_received':
          fetchMessageUnreadCount();
          this.#onMessageCbs.forEach(callback => callback(payload));
          break;
        case 'messages_read':
          fetchMessageUnreadCount();
          this.#onReadCbs.forEach(callback => callback(payload));
          break;
      }
    };
  }
  disconnect() {
    this.#enabled = false;
    this.#source?.close();
    this.#source = null;
    this.status = 'disconnected';
    this.#onTicketUpdateCbs.clear();
    this.#onCommentCbs.clear();
    this.#onMessageCbs.clear();
    this.#onNotificationCbs.clear();
    this.#onReadCbs.clear();
    this.#onReconnectCbs.clear();
  }
  onMessage(callback: (message: WSMessage) => void) { this.#onMessageCbs.add(callback); return () => this.#onMessageCbs.delete(callback); }
  onNotification(callback: (notification: WSNotification) => void) { this.#onNotificationCbs.add(callback); return () => this.#onNotificationCbs.delete(callback); }
  onRead(callback: (data: { reader_id: number; ticket_id?: number }) => void) { this.#onReadCbs.add(callback); return () => this.#onReadCbs.delete(callback); }
  onReconnect(callback: () => void) { this.#onReconnectCbs.add(callback); return () => this.#onReconnectCbs.delete(callback); }
  onTicketUpdate(ticket: number, callback: (update: WSTicketUpdate) => void) {
    if (!this.#onTicketUpdateCbs.has(ticket)) this.#onTicketUpdateCbs.set(ticket, new Set());
    this.#onTicketUpdateCbs.get(ticket)!.add(callback);
    this.#open();
    return () => {
      this.#onTicketUpdateCbs.get(ticket)?.delete(callback);
      if (!this.#onTicketUpdateCbs.get(ticket)?.size) { this.#onTicketUpdateCbs.delete(ticket); this.#open(); }
    };
  }
  onComment(ticket: number, callback: (comment: WSComment) => void) {
    if (!this.#onCommentCbs.has(ticket)) this.#onCommentCbs.set(ticket, new Set());
    this.#onCommentCbs.get(ticket)!.add(callback);
    this.#open();
    return () => {
      this.#onCommentCbs.get(ticket)?.delete(callback);
      if (!this.#onCommentCbs.get(ticket)?.size) { this.#onCommentCbs.delete(ticket); this.#open(); }
    };
  }
}

export const ws = new TicketingEvents();
