import { error } from '@sveltejs/kit';
import { jwtVerify } from 'jose';
import { eq } from 'drizzle-orm';
import { requireAuth } from '../../../lib/server/auth';
import { getDb } from '../../../lib/server/db';
import { users } from '../../../lib/server/db/schema';
import { currentRoles, subscribeEvents } from '../../../lib/server/realtime';

export async function GET({ cookies, url, request }: import('@sveltejs/kit').RequestEvent) {
  const auth = await requireAuth();
  const token = cookies.get('auth_cookie')!;
  const { payload } = await jwtVerify(token, new TextEncoder().encode(process.env.JWT_SECRET), { algorithms: ['HS256'] });
  const ids = (url.searchParams.get('tickets') || '').split(',').filter(Boolean).map(Number);
  if (ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) error(400, 'Invalid ticket subscriptions');
  const db = getDb();
  const expiresAt = payload.exp! * 1000;
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const encoder = new TextEncoder();
      let interval: ReturnType<typeof setInterval>;
      let unsubscribe = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(interval);
        unsubscribe();
        request.signal.removeEventListener('abort', close);
        try { controller.close(); } catch { /* already cancelled */ }
      };
      cleanup = close;
      const send = (event: unknown) => {
        if (closed) return;
        if ((controller.desiredSize ?? 0) < -100) { close(); return; }
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); } catch { close(); }
      };
      unsubscribe = subscribeEvents({ db, user: auth.user, expiresAt, tickets: new Set(ids), send, close });
      interval = setInterval(() => {
        if (!currentRoles(db, auth.user, expiresAt)) { close(); return; }
        db.update(users).set({ last_active: new Date() }).where(eq(users.id, auth.user)).run();
        send({ type: 'heartbeat' });
      }, 15_000);
      request.signal.addEventListener('abort', close, { once: true });
      if (request.signal.aborted) close();
      else send({ type: 'connected', payload: { userId: auth.user } });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
}
