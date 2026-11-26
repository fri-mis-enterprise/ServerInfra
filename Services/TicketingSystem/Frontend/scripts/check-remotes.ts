import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { parse, stringify } from 'devalue';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { SignJWT } from 'jose';
import { migrateDatabase } from '../src/lib/server/db/migrate';
import { users, userRoles, departments, tickets, ticketApprovers, ticketComments, auditLogs, csat, resolutionAttempts, attachments } from '../src/lib/server/db/schema';

// Launch our own server against disposable data; never connect to an existing app or database.
const directory = mkdtempSync(join(tmpdir(), 'ticketing-remotes-'));
const filename = join(directory, 'fixture.db');
const sqlite = new Database(filename, { create: true });
let server: ReturnType<typeof Bun.spawn> | undefined;
try {
  migrateDatabase(sqlite);
  const db = drizzle(sqlite);
  const password = await Bun.password.hash('password123');
  const admin = db.insert(users).values({ username: 'admin', email: 'admin@example.com', first_name: 'Admin', last_name: 'Test', password }).returning().get()!;
  const user = db.insert(users).values({ username: 'user', email: 'user@example.com', first_name: 'User', last_name: 'Test', password }).returning().get()!;
  db.insert(userRoles).values([{ user_id: admin.id, role: 'admin' }, { user_id: user.id, role: 'user' }]).run();
  const secret = crypto.randomUUID();
  const key = new TextEncoder().encode(secret);
  const handoff = readFileSync('build/adapter-bun.js', 'utf8');
  const base = JSON.parse(handoff.match(/export const base = (.*);/)![1]).replace(/\/$/, '');
  const configuredOrigin = handoff.match(/export const origin = (.*);/)![1];
  const remoteId = (name: string) => {
    const source = readFileSync(`build/server/chunks/${name}.remote.js`, 'utf8');
    return source.match(new RegExp(`"src/lib/${name}\\.remote\\.ts",\\s*"([^"]+)"`))![1];
  };
  const ids = { auth: remoteId('auth'), reference: remoteId('reference'), tickets: remoteId('tickets'), reports: remoteId('reports'), users: remoteId('users'), audit: remoteId('audit'), actions: remoteId('ticket-actions'), admin: remoteId('admin'), csat: remoteId('csat'), messages: remoteId('messages'), notifications: remoteId('notifications') };
  server = Bun.spawn([process.execPath, 'build/index.js'], {
    env: { ...process.env, DATABASE_URL: `file:${filename}`, UPLOAD_DIR: directory, JWT_SECRET: secret, VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_CONTACT: '', HOST: '127.0.0.1', PORT: '0' },
    stdout: 'pipe', stderr: 'pipe',
  });
  const reader = (server.stdout as ReadableStream<Uint8Array>).getReader();
  const ready = await Promise.race([
    reader.read().then(({ value }) => new TextDecoder().decode(value)),
    server.exited.then(code => { throw new Error(`Test server exited (${code})`); }),
  ]);
  const address = ready.match(/Listening on (http:\/\/\S+)/)![1].replace(/\/$/, '');
  const origin = configuredOrigin === 'undefined' ? `https://${new URL(address).host}` : JSON.parse(configuredOrigin);

  async function rpc(module: keyof typeof ids, name: string, input?: unknown, cookie = '', method = 'POST', requestOrigin = origin) {
    const payload = input === undefined ? '' : Buffer.from(stringify(input)).toString('base64url');
    const response = await fetch(`${address}${base}/_app/remote/${ids[module]}/${name}${method === 'GET' && payload ? `?payload=${payload}` : ''}`, {
      method, headers: { Origin: requestOrigin, Cookie: cookie, 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify({ payload, refreshes: [] }),
    });
    const envelope = await response.json() as any;
    const data = envelope.data ? parse(envelope.data) : {};
    return { response, envelope, status: envelope.error?.status ?? response.status, value: data._ };
  }

  assert.equal((await rpc('auth', 'getSession', undefined, '', 'GET')).value, null);
  assert.equal((await rpc('auth', 'login', { username: 'admin', password: 'wrong' })).status, 401);
  const login = await rpc('auth', 'login', { username: 'admin', password: 'password123' });
  assert.equal(login.status, 200);
  assert.equal(login.value.user.id, admin.id);
  assert.ok(!('password' in login.value.user));
  const setCookie = login.response.headers.get('set-cookie')!;
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.split(';')[0];
  assert.equal((await rpc('auth', 'getSession', undefined, cookie, 'GET')).value.id, admin.id);

  const registration = { username: 'registered', email: 'registered@example.com', password: 'password123', first_name: 'Registered', last_name: 'Test', roles: ['admin'] };
  const registered = await rpc('auth', 'register', registration);
  assert.equal(registered.status, 200);
  assert.deepEqual(registered.value.user.roles, ['user']);
  assert.ok(!('password' in registered.value.user));
  assert.equal((await rpc('auth', 'register', registration)).status, 409);
  const races = await Promise.all([1, 2].map(() => rpc('auth', 'register', { ...registration, username: 'race', email: 'race@example.com' })));
  assert.deepEqual(races.map(result => result.status).sort(), [200, 409]);

  const item = { kind: 'departments', data: { name: 'New department', description: null, is_active: true } };
  assert.equal((await rpc('reference', 'createReferenceItem', item)).status, 401);
  const forgedRoles = await new SignJWT({ sub: String(user.id), roles: ['admin'] }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(key);
  assert.equal((await rpc('reference', 'createReferenceItem', item, `auth_cookie=${forgedRoles}`)).status, 403);

  const userCookie = `auth_cookie=${forgedRoles}`;
  const ownTicket = db.insert(tickets).values({ title: 'Private user ticket', description: 'User description', requester_id: user.id }).returning().get()!;
  const otherTicket = db.insert(tickets).values({ title: 'Private admin ticket', description: 'Admin description', requester_id: admin.id }).returning().get()!;
  db.insert(ticketComments).values([
    { ticket_id: ownTicket.id, user_id: admin.id, content: 'Visible reply' },
    { ticket_id: ownTicket.id, user_id: admin.id, content: 'Staff secret', is_internal: true },
  ]).run();
  db.insert(ticketApprovers).values({ ticket_id: ownTicket.id, approver_id: admin.id }).run();
  db.insert(auditLogs).values({ ticket_id: ownTicket.id, performed_by_id: admin.id, action: 'ticket_created' }).run();
  const read = (module: keyof typeof ids, name: string, input?: unknown, session = cookie) => rpc(module, name, input, session, 'GET');
  assert.equal((await read('tickets', 'getTickets', {}, '')).status, 401);
  const visible = await read('tickets', 'getTickets', {}, userCookie);
  assert.equal(visible.value.pagination.total, 1);
  assert.equal(visible.value.data[0].id, ownTicket.id);
  assert.equal((await read('tickets', 'getTickets', { requester_id: admin.id }, userCookie)).value.pagination.total, 0);
  assert.equal((await read('tickets', 'getTicket', otherTicket.id, userCookie)).status, 403);
  assert.equal((await read('tickets', 'getTicketPreview', otherTicket.id, userCookie)).status, 403);
  const detail = (await read('tickets', 'getTicket', ownTicket.id, userCookie)).value;
  assert.deepEqual(detail.comments.map((comment: any) => comment.content), ['Visible reply']);
  assert.equal(typeof detail.created_at, 'string');
  assert.ok(!JSON.stringify(detail).includes('password'));
  assert.equal((await read('tickets', 'getTicket', ownTicket.id)).value.comments.length, 2);
  assert.equal((await read('tickets', 'getPendingApprovals')).value.length, 1);
  const contacts = (await read('users', 'getUserDirectory', undefined, userCookie)).value;
  assert.ok(contacts.length >= 2);
  assert.ok(contacts.every((contact: any) => !('password' in contact) && !('email' in contact)));
  assert.equal((await read('audit', 'getTicketAudit', {}, userCookie)).status, 403);
  assert.equal((await read('audit', 'getTicketAudit', {})).value.pagination.total, 1);
  assert.equal((await read('reports', 'getTicketReport', {}, userCookie)).status, 403);
  assert.equal((await read('reports', 'getDashboardSummary', {}, '')).status, 401);
  assert.equal((await read('reports', 'getDashboardSummary', {}, userCookie)).status, 200);
  assert.equal((await read('reports', 'getTicketReport', {})).status, 200);
  assert.equal((await read('tickets', 'getTickets', { limit: 101 }, userCookie)).status, 400);
  const created = await rpc('reference', 'createReferenceItem', item, cookie);
  assert.equal(created.status, 200);
  assert.equal((await rpc('reference', 'createReferenceItem', item, cookie)).status, 409);
  const data = (await rpc('reference', 'getReferenceData', undefined, '', 'GET')).value;
  const department = data.departments.find((row: any) => row.name === item.data.name);
  assert.ok(department);
  assert.equal((await rpc('reference', 'updateReferenceItem', { ...item, id: department.id, data: { ...item.data, name: 'Updated department' } }, cookie)).status, 200);
  assert.equal((await rpc('reference', 'deleteReferenceItem', { kind: 'departments', id: department.id }, cookie)).status, 200);
  assert.equal(db.select().from(departments).where(eq(departments.id, department.id)).get()!.is_active, false);
  assert.ok(!(await rpc('reference', 'getReferenceData', undefined, '', 'GET')).value.departments.some((row: any) => row.id === department.id));

  const mutate = (module: keyof typeof ids, name: string, input?: unknown, session = cookie) => rpc(module, name, input, session);
  const expectOk = (result: Awaited<ReturnType<typeof rpc>>) => { assert.equal(result.status, 200, JSON.stringify(result.envelope)); return result.value; };
  assert.equal((await mutate('admin', 'createUser', { first_name: 'No', last_name: 'Access', username: 'denied', email: 'denied@example.com', password: 'password123' }, userCookie)).status, 403);
  const managed = expectOk(await mutate('admin', 'createUser', { first_name: 'Managed', last_name: 'Test', username: 'managed', email: 'managed@example.com', password: 'password123' }));
  assert.ok(!('password' in managed));
  expectOk(await mutate('admin', 'assignRole', { id: managed.id, role: 'mis' }));
  expectOk(await mutate('admin', 'removeRole', { id: managed.id, role: 'mis' }));
  expectOk(await mutate('admin', 'updateUser', { id: managed.id, data: { first_name: 'Edited' } }));
  expectOk(await mutate('admin', 'deactivateUser', managed.id));
  assert.equal((await mutate('admin', 'deactivateUser', admin.id)).status, 409);

  const createdTicket = expectOk(await mutate('actions', 'createTicket', { title: 'Native lifecycle ticket', description: '<p>A complete native lifecycle description</p>', requires_approval: false }, userCookie));
  const id = createdTicket.id;
  assert.equal((await mutate('actions', 'updateTicket', { id, data: { assignee_id: admin.id } }, userCookie)).status, 403);
  expectOk(await mutate('actions', 'updateTicket', { id, data: { assignee_id: admin.id, status: 'in_progress' } }));
  expectOk(await mutate('actions', 'updateTicket', { id, data: { status: 'resolved', resolution_notes: 'Fixed' } }));
  expectOk(await mutate('csat', 'submitCsat', { ticket_id: id, rating_speed: 5, rating_attitude: 4, rating_impact: 3 }, userCookie));
  assert.equal((await mutate('csat', 'submitCsat', { ticket_id: id, rating_speed: 5, rating_attitude: 4, rating_impact: 3 }, userCookie)).status, 409);
  assert.equal(expectOk(await read('csat', 'getCsatStats', {})).total_responses, 1);
  expectOk(await read('csat', 'getAgentReport', { agent_id: admin.id }));
  expectOk(await mutate('actions', 'updateTicket', { id, data: { status: 'open', reopen_reason: 'Needs more work' } }, userCookie));
  assert.equal(db.select().from(csat).where(eq(csat.ticket_id, id)).get(), undefined);
  assert.ok(db.select().from(resolutionAttempts).where(eq(resolutionAttempts.ticket_id, id)).get()!.reopened_at);
  const approvalTicket = expectOk(await mutate('actions', 'createTicket', { title: 'Native approval ticket', description: 'A complete native approval description', requires_approval: true }, userCookie));
  const approval = db.select().from(ticketApprovers).where(eq(ticketApprovers.ticket_id, approvalTicket.id)).get()!;
  assert.equal((await mutate('actions', 'decideApproval', { id: approval.id, ticket_id: approvalTicket.id, decision: 'approved' }, userCookie)).status, 403);
  expectOk(await mutate('actions', 'decideApproval', { id: approval.id, ticket_id: approvalTicket.id, decision: 'approved' }));
  assert.equal(db.select().from(tickets).where(eq(tickets.id, approvalTicket.id)).get()!.status, 'open');

  const streamAbort = new AbortController();
  const stream = await fetch(`${address}${base}/api/events?tickets=${id}`, { headers: { Cookie: userCookie }, signal: streamAbort.signal });
  assert.equal(stream.status, 200);
  const events = stream.body!.getReader();
  let buffer = '';
  async function nextEvent() {
    const timeout = setTimeout(() => streamAbort.abort(), 5_000);
    try {
      while (!buffer.includes('\n\n')) { const chunk = await events.read(); assert.ok(!chunk.done); buffer += new TextDecoder().decode(chunk.value); }
      const end = buffer.indexOf('\n\n'), block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
      return JSON.parse(block.replace(/^data: /, ''));
    } finally { clearTimeout(timeout); }
  }
  try {
    assert.equal((await nextEvent()).type, 'connected');
    expectOk(await mutate('actions', 'createComment', { ticket_id: id, content: 'Private internal note', is_internal: true }));
    const comment = expectOk(await mutate('actions', 'createComment', { ticket_id: id, content: 'Public native reply' }));
    let publicSeen = false;
    for (let i = 0; i < 10 && !publicSeen; i++) {
      const event = await nextEvent();
      assert.ok(!JSON.stringify(event).includes('Private internal note'));
      publicSeen = event.type === 'comment_added' && event.payload.comment.id === comment.id;
    }
    assert.ok(publicSeen, 'SSE must deliver the public comment after commit');
    expectOk(await mutate('actions', 'updateComment', { id: comment.id, data: { content: 'Edited native reply' } }));
    expectOk(await mutate('actions', 'deleteComment', comment.id));
  } finally { streamAbort.abort(); await events.cancel().catch(() => {}); }
  const ownDetail = expectOk(await read('tickets', 'getTicket', id, userCookie));
  assert.ok(!JSON.stringify(ownDetail).includes('Private internal note'));

  const sent = expectOk(await mutate('messages', 'sendMessage', { receiver_id: admin.id, content: 'Private native message', ticket_id: id }, userCookie));
  assert.equal(expectOk(await read('messages', 'getMessages', user.id))[0].id, sent.id);
  assert.equal(expectOk(await read('messages', 'getMessageUnreadCount')).count, 1);
  expectOk(await mutate('messages', 'markMessagesRead', user.id));
  assert.equal(expectOk(await read('messages', 'getMessageUnreadCount')).count, 0);
  assert.ok(expectOk(await read('messages', 'getConversations')).some((row: any) => row.id === user.id));
  const notificationList = expectOk(await read('notifications', 'getNotifications', {}));
  if (notificationList.data.length) {
    const notification = notificationList.data[0];
    assert.equal((await mutate('notifications', 'markNotificationRead', notification.id, userCookie)).status, 404);
    expectOk(await mutate('notifications', 'markNotificationRead', notification.id));
    expectOk(await mutate('notifications', 'deleteNotification', notification.id));
  }
  expectOk(await mutate('notifications', 'markAllNotificationsRead'));

  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
  const original = await new Bun.Image(pixel).resize(1200, 800).png({ compressionLevel: 0 }).blob();
  const form = new FormData(); form.set('ticket_id', String(id)); form.append('files', new File([original], 'screenshot.png', { type: 'image/png' }));
  const uploaded = await fetch(`${address}${base}/api/attachments`, { method: 'POST', headers: { Cookie: userCookie, Origin: origin }, body: form });
  assert.equal(uploaded.status, 201, await uploaded.clone().text());
  const attachment = await uploaded.json() as any;
  const downloadUrl = `${address}${base}${attachment.file_url}`;
  assert.equal((await fetch(downloadUrl)).status, 401);
  const downloaded = await fetch(downloadUrl, { headers: { Cookie: userCookie } });
  assert.deepEqual(await downloaded.bytes(), await original.bytes());
  const preview = await fetch(`${downloadUrl}?preview=1`, { headers: { Cookie: userCookie } });
  assert.equal(preview.headers.get('content-type'), 'image/webp');
  assert.ok((await preview.bytes()).length < original.size);
  const unauthorizedUpload = new FormData(); unauthorizedUpload.set('ticket_id', String(otherTicket.id)); unauthorizedUpload.append('files', new File(['x'], 'denied.txt'));
  assert.equal((await fetch(`${address}${base}/api/attachments`, { method: 'POST', headers: { Cookie: userCookie, Origin: origin }, body: unauthorizedUpload })).status, 403);
  assert.equal((await fetch(`${address}${base}/api/attachments/${attachment.id}`, { method: 'DELETE', headers: { Cookie: userCookie, Origin: origin } })).status, 403);
  assert.equal((await fetch(`${address}${base}/api/attachments/${attachment.id}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: origin } })).status, 204);
  assert.equal(db.select().from(attachments).where(eq(attachments.id, attachment.id)).get(), undefined);
  assert.equal(await Bun.file(join(directory, attachment.file_name)).exists(), false);
  assert.equal(await Bun.file(join(directory, `${attachment.file_name}.preview.webp`)).exists(), false);
  assert.equal((await fetch(`${address}${base}/health`)).status, 200);

  const profile = await rpc('auth', 'saveProfile', { first_name: 'Updated', roles: ['user'], message_notifications: false }, cookie);
  assert.equal(profile.value.first_name, 'Updated');
  assert.equal(profile.value.message_notifications, false);
  assert.deepEqual(profile.value.roles, ['admin']);
  assert.ok(!('password' in profile.value));
  const csrf = await rpc('auth', 'saveProfile', { first_name: 'CSRF attempt' }, cookie, 'POST', 'https://other.invalid');
  assert.equal(csrf.status, 403);
  assert.equal(db.select().from(users).where(eq(users.id, admin.id)).get()!.first_name, 'Updated');

  db.delete(userRoles).where(eq(userRoles.user_id, admin.id)).run();
  assert.equal((await rpc('reference', 'createReferenceItem', item, cookie)).status, 403);
  db.update(users).set({ is_active: false }).where(eq(users.id, admin.id)).run();
  assert.equal((await rpc('auth', 'getSession', undefined, cookie, 'GET')).value, null);
  assert.equal((await rpc('reference', 'createReferenceItem', item, cookie)).status, 403);
  const logout = await rpc('auth', 'logout', undefined, cookie);
  assert.match(logout.response.headers.get('set-cookie')!, /Max-Age=0/i);
  const expired = await new SignJWT({ sub: String(user.id) }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(1).sign(key);
  assert.equal((await rpc('auth', 'getSession', undefined, `auth_cookie=${expired}`, 'GET')).value, null);
  const bootstrapEnv = { ...process.env, DATABASE_URL: `file:${filename}`, ADMIN_USERNAME: 'bootstrap', ADMIN_EMAIL: 'bootstrap@example.com', ADMIN_PASSWORD: 'bootstrap-test-password' };
  for (const script of ['scripts/seed.ts', 'scripts/seed.ts', 'scripts/create-admin.ts']) {
    const child = Bun.spawn([process.execPath, script], { env: bootstrapEnv, stdout: 'pipe', stderr: 'pipe' });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    assert.equal(code, 0, stderr);
  }
  const bootstrapped = db.select().from(users).where(eq(users.username, 'bootstrap')).get()!;
  assert.ok(await Bun.password.verify(bootstrapEnv.ADMIN_PASSWORD, bootstrapped.password));
  assert.equal(db.select().from(userRoles).where(eq(userRoles.user_id, bootstrapped.id)).get()!.role, 'admin');
  console.log('Single-service integration passed: auth, lifecycle, approvals, comments/SSE privacy, CSAT, admin, messaging, notifications, originals/previews and access controls.');
} catch (error) {
  console.error('Remote integration check failed:', error);
  throw error;
} finally {
  if (server) {
    server.kill();
    await server.exited;
    const logs = await new Response(server.stderr as ReadableStream).text();
    if (logs) console.error(logs);
  }
  sqlite.close();
  Bun.gc(true);
  for (const name of readdirSync(directory)) {
    // Windows may release SQLite file handles shortly after the child exits.
    for (let attempt = 0; ; attempt++) {
      try { unlinkSync(join(directory, name)); break; }
      catch (error) {
        if (!['EBUSY', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '') || attempt === 20) throw error;
        await Bun.sleep(50);
      }
    }
  }
  rmdirSync(directory);
}
