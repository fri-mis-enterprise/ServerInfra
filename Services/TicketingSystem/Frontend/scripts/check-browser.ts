import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { eq } from 'drizzle-orm';
import { migrateDatabase } from '../src/lib/server/db/migrate';
import { attachments, csat, departments, messages, requestTypes, ticketComments, tickets, userRoles, users } from '../src/lib/server/db/schema';

// Browser actions must never reach an existing deployment or real application data.
const handoff = readFileSync('build/adapter-bun.js', 'utf8');
const configured = handoff.match(/export const origin = (.*);/)?.[1];
assert.ok(configured && configured !== 'undefined', 'Build with FRONTEND_URL=http://127.0.0.1:33001 before running browser checks');
const origin = new URL(JSON.parse(configured));
assert.ok(origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname) && !origin.username && !origin.password && origin.pathname === '/', 'Browser checks require a local HTTP build origin');
const prefix = JSON.parse(handoff.match(/export const base = (.*);/)![1]).replace(/\/$/, '');
const address = origin.origin;
const base = `${address}${prefix}/`;
const directory = mkdtempSync(join(tmpdir(), 'ticketing-browser-'));
const filename = join(directory, 'fixture.db');
const sqlite = new Database(filename, { create: true });
let server: ReturnType<typeof Bun.spawn> | undefined;
type View = InstanceType<typeof Bun.WebView>;
const exceptions: string[] = [], requests: string[] = [];
const checks: string[] = [];
const sessionCookies = new Map<View, string>();
let failNextUpload = false;
async function wait(view: View, expression: string) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await view.evaluate(expression)) return;
    await Bun.sleep(100);
  }
  throw new Error(`Timeout ${expression}: ${await view.evaluate('location.href + "\\n" + document.body.innerText.slice(0, 2500)')}\nExceptions: ${exceptions.join('\n')}`);
}
async function input(view: View, selector: string, value: string) {
  await wait(view, `(() => { const input = document.querySelector(${JSON.stringify(selector)}); if (!input || input.disabled) return false; input.value = ${JSON.stringify(value)}; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
}
async function clickText(view: View, text: string, scope = 'main') {
  const expression = `(() => { const button = [...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(button => button.textContent.trim() === ${JSON.stringify(text)} && !button.disabled); if (!button) return false; button.click(); return true; })()`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await view.evaluate(expression)) return;
    await Bun.sleep(100);
  }
  throw new Error(`Button ${text} not available: ${await view.evaluate('document.body.innerText.slice(0, 2500)')}`);
}
async function observe(view: View) {
  view.addEventListener('Runtime.exceptionThrown', event => { exceptions.push(JSON.stringify((event as unknown as MessageEvent).data)); });
  await view.navigate(base + 'login');
  await view.cdp('Network.enable');
  // Keep session interception on the page's network target rather than a shared service worker.
  await view.cdp('Network.setBypassServiceWorker', { bypass: true });
  await view.cdp('Network.setCacheDisabled', { cacheDisabled: true });
  view.addEventListener('Network.requestWillBeSent', event => { requests.push((event as unknown as MessageEvent<{ request: { url: string } }>).data.request.url); });
  view.addEventListener('Network.webSocketCreated', event => { requests.push((event as unknown as MessageEvent<{ url: string }>).data.url); });
}
async function login(view: View, username: string) {
  await input(view, '#login-username', username);
  await input(view, '#login-password', 'password123');
  await view.click('button[type="submit"]');
  await wait(view, "document.querySelector('main')?.innerText.includes('Recent tickets')");
  // Bun's Chrome tabs share cookies; CDP supplies a separate fixture session on each tab's API requests.
  const { cookies } = await view.cdp('Network.getCookies', { urls: [base] }) as { cookies: { name: string; value: string }[] };
  const cookie = cookies.find(cookie => cookie.name === 'auth_cookie');
  assert.ok(cookie);
  sessionCookies.set(view, `auth_cookie=${cookie.value}`);
  let continued = Promise.resolve<unknown>(undefined);
  view.addEventListener('Fetch.requestPaused', event => {
    const request = (event as unknown as MessageEvent<{ requestId: string; request: { url: string; headers: Record<string, string> } }>).data;
    continued = continued.then(() => {
      if (failNextUpload && request.request.url === `${address}${prefix}/api/attachments`) {
        failNextUpload = false;
        return view.cdp('Fetch.fulfillRequest', { requestId: request.requestId, responseCode: 503,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ message: 'Simulated upload failure' })).toString('base64') });
      }
      const headers = Object.entries(request.request.headers).filter(([name]) => name.toLowerCase() !== 'cookie').map(([name, value]) => ({ name, value }));
      const cookie = sessionCookies.get(view);
      if (cookie) headers.push({ name: 'Cookie', value: cookie });
      if (request.request.url.endsWith('/logout')) sessionCookies.delete(view);
      return view.cdp('Fetch.continueRequest', { requestId: request.requestId, headers });
    }).catch(error => { exceptions.push(String(error)); });
  });
  await view.cdp('Fetch.enable', { patterns: [{ urlPattern: `${address}${prefix}/_app/remote/*` }, { urlPattern: `${address}${prefix}/api/*` }] });
}
async function modal(view: View, value: string) {
  await input(view, '.modal input', value);
  await clickText(view, 'Confirm', '.modal');
  await wait(view, "!document.querySelector('.modal')");
}
try {
  migrateDatabase(sqlite);
  const db = drizzle(sqlite);
  const department = db.insert(departments).values({ name: 'IT' }).returning().get()!;
  db.insert(requestTypes).values({ name: 'Hardware Issue' }).run();
  const password = await Bun.password.hash('password123');
  const [admin, user] = db.insert(users).values(['admin', 'user'].map(username => ({ username, first_name: username === 'admin' ? 'Admin' : 'User', last_name: 'Browser', email: `${username}@example.com`, password, department_id: department.id }))).returning().all();
  db.insert(userRoles).values([{ user_id: admin.id, role: 'admin' }, { user_id: admin.id, role: 'mis' }, { user_id: user.id, role: 'user' }]).run();
  const serverEnvironment = { ...process.env, DATABASE_URL: `file:${filename}`, UPLOAD_DIR: directory, JWT_SECRET: crypto.randomUUID(), VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_CONTACT: '', HOST: origin.hostname === '[::1]' ? '::1' : origin.hostname, PORT: origin.port || '80' };
  async function startServer() {
    server = Bun.spawn([process.execPath, 'build/index.js'], { env: serverEnvironment, stdout: 'pipe', stderr: 'pipe' });
    await Promise.race([(server.stdout as ReadableStream<Uint8Array>).getReader().read(), server.exited.then(code => { throw new Error(`Browser test server exited (${code})`); })]);
  }
  await startServer();
  await using userView = new Bun.WebView({ width: 1440, height: 1000, backend: { type: 'chrome', url: false } });
  await using adminView = new Bun.WebView({ width: 1440, height: 1000, backend: { type: 'chrome', url: false } });
  await observe(userView); await observe(adminView);
  await login(userView, 'user'); await login(adminView, 'admin');
  assert.equal(await userView.evaluate(`!!document.querySelector('.app-sidebar a[href="${prefix}/admin/users"]')`), false);
  await userView.evaluate("localStorage.setItem('tour_ticket_create_seen', 'true')");
  await userView.navigate(base + 'tickets/new');
  await wait(userView, "!!document.querySelector('#title')");
  await userView.click('form button[type="submit"]');
  await wait(userView, "document.activeElement?.id === 'title' && !!document.querySelector('#description-error')");
  assert.equal(db.select().from(tickets).all().length, 0);
  await input(userView, '#title', 'A draft only for the requester');
  await userView.click('#requires_approval');
  await wait(userView, `JSON.parse(localStorage.getItem('ticket_draft:${user.id}') || '{}').requires_approval === true`);
  await adminView.navigate(base + 'tickets/new');
  await wait(adminView, "!!document.querySelector('#title')");
  assert.equal(await adminView.evaluate("document.querySelector('#title').value"), '');
  await userView.navigate(base + 'tickets/new');
  await wait(userView, "document.querySelector('#title')?.value === 'A draft only for the requester' && document.querySelector('#requires_approval')?.checked");
  await clickText(userView, 'Discard draft');
  await wait(userView, `!document.querySelector('#title').value && !localStorage.getItem('ticket_draft:${user.id}')`);
  await userView.evaluate("[...document.querySelectorAll('[role=combobox]')].find(el => el.getAttribute('aria-label').startsWith('Request type')).click()");
  await clickText(userView, 'Hardware Issue');
  await wait(userView, "!!document.querySelector('[role=combobox][aria-label=\"Hardware item (optional)\"]') && document.querySelector('#description-help')?.innerText.includes('device')");
  await input(userView, '#title', 'Browser workflow ticket');
  await wait(userView, "!!document.querySelector('.tiptap[contenteditable=true]')");
  await userView.click('.tiptap[contenteditable=true]');
  await userView.type('A sufficiently detailed description for the native ticket workflow.');
  const pasteScreenshot = `(() => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    const transfer = new DataTransfer(); transfer.items.add(new File([bytes], 'screenshot.png', { type: 'image/png' }));
    document.querySelector('.tiptap').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  })()`;
  await userView.evaluate(pasteScreenshot);
  await wait(userView, "!!document.querySelector('img[alt=\"Preview of screenshot.png\"]')");
  await userView.evaluate("document.querySelector('button[aria-label=\"Remove screenshot.png\"]').scrollIntoView({ block: 'center' })");
  await userView.click('button[aria-label="Remove screenshot.png"]');
  await wait(userView, "!document.querySelector('img[alt=\"Preview of screenshot.png\"]')");
  await userView.evaluate(`(() => {
    const transfer = new DataTransfer();
    for (let i = 0; i < 6; i++) transfer.items.add(new File(['log'], 'log-' + i + '.txt', { type: 'text/plain' }));
    const input = document.querySelector('#ticket-files'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(userView, "document.querySelector('[data-tour=ticket-attachments]')?.innerText.includes('Upload up to 5 files')");
  await userView.evaluate(`(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File(['log details'], 'error-log.txt', { type: 'text/plain' }));
    document.querySelector('[data-tour=ticket-attachments] button').dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  })()`);
  await wait(userView, "!!document.querySelector('button[aria-label=\"Remove error-log.txt\"]')");
  await userView.evaluate(pasteScreenshot);
  await userView.resize(390, 844);
  assert.ok(await userView.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Mobile creation form overflows');
  await userView.resize(1920, 1080);
  assert.ok(await userView.evaluate("document.querySelector('.ticket-create').getBoundingClientRect().width > 1500"), 'Creation form should use the full desktop workspace');
  failNextUpload = true;
  await userView.click('form button[type="submit"]');
  await wait(userView, "document.querySelector('main')?.innerText.includes('Simulated upload failure') && document.querySelector('main')?.innerText.includes('Retry attachments')");
  assert.equal(db.select().from(tickets).all().length, 1);
  assert.equal(db.select().from(attachments).all().length, 0);
  await userView.navigate(base + 'tickets/new');
  await wait(userView, "document.querySelector('main')?.innerText.includes('has been created') && !!document.querySelector('.tiptap')");
  assert.equal(await userView.evaluate("document.querySelector('#title').matches(':disabled')"), true);
  await userView.evaluate(pasteScreenshot);
  await clickText(userView, 'Retry attachments');
  await wait(userView, "location.pathname.includes('/tickets/') && !location.pathname.endsWith('/new') && !!document.querySelector('textarea[placeholder=" + JSON.stringify('Reply...') + "]')");
  assert.equal(db.select().from(tickets).all().length, 1, 'Attachment retry created a duplicate ticket');
  assert.equal(db.select().from(attachments).all().length, 1);
  assert.equal(await userView.evaluate(`localStorage.getItem('ticket_draft:${user.id}')`), null);
  await userView.resize(1440, 1000);
  checks.push('creation validation, per-user draft restoration/discard, request guidance, pasted screenshots/removal, full-width/mobile layout and upload retry after reload without duplicate tickets');
  const ticket = db.select().from(tickets).get()!;
  assert.equal(ticket.requester_id, user.id);
  checks.push('UI ticket creation and role navigation');
  await adminView.navigate(base + `tickets/${ticket.id}`);
  await wait(adminView, "!!document.querySelector('textarea[placeholder=" + JSON.stringify('Reply...') + "]')");
  await input(adminView, 'textarea[placeholder="Reply..."]', 'Public live reply');
  await clickText(adminView, 'Send');
  await wait(userView, "document.querySelector('main')?.innerText.includes('Public live reply')");
  await input(adminView, 'textarea[placeholder="Reply..."]', 'Private staff note');
  await adminView.click('input.checkbox-warning');
  await clickText(adminView, 'Send');
  await wait(adminView, "document.querySelector('main')?.innerText.includes('Private staff note')");
  await Bun.sleep(500);
  assert.equal(await userView.evaluate("document.querySelector('main')?.innerText.includes('Private staff note')"), false);
  assert.equal(db.select().from(ticketComments).all().length, 2);
  checks.push('live public comments and private internal notes');
  await clickText(adminView, 'Assign to Myself');
  await wait(adminView, "[...document.querySelectorAll('main button')].some(button => button.textContent.trim() === 'Resolve Ticket')");
  await clickText(adminView, 'Resolve Ticket');
  await modal(adminView, 'Resolved through browser workflow');
  await wait(userView, "!!document.querySelector('#csat-section')");
  await userView.evaluate("[...document.querySelectorAll('#csat-section .space-y-3 > div')].forEach(row => row.querySelectorAll('button')[4].click())");
  await clickText(userView, 'Submit Feedback');
  await wait(userView, "!document.querySelector('#csat-section')");
  assert.equal(db.select().from(csat).get()!.rating, 5);
  await clickText(userView, 'Reopen Ticket');
  await modal(userView, 'Reopened after checking the fix');
  await wait(userView, "document.querySelector('main')?.innerText.toLowerCase().includes('reopened')");
  assert.equal(db.select().from(tickets).get()!.status, 'open');
  assert.equal(db.select().from(csat).all().length, 0);
  checks.push('assignment, resolution, CSAT and requester reopen');
  console.log('Browser ticket creation, live comments, resolution, CSAT and reopening passed.');
  await userView.navigate(base + `messages/${admin.id}`);
  await adminView.navigate(base + `messages/${user.id}`);
  const messageInput = 'input[placeholder="Type your message... use # to reference tickets"]';
  await wait(adminView, `!!document.querySelector(${JSON.stringify(messageInput)})`);
  for (let attempt = 0; attempt < 3; attempt++) {
    await adminView.navigate(base);
    await wait(adminView, "document.querySelector('main')?.innerText.includes('Recent tickets')");
    await adminView.navigate(base + `messages/${user.id}`);
    await wait(adminView, `!!document.querySelector(${JSON.stringify(messageInput)})`);
  }
  await input(userView, messageInput, 'Browser realtime message');
  await userView.click('main form button[type="submit"]');
  await wait(adminView, "document.querySelector('main')?.innerText.includes('Browser realtime message')");
  await wait(userView, "document.querySelector('main')?.innerText.includes('Read')");
  server!.kill();
  await server!.exited;
  const previousLogs = await new Response(server!.stderr as ReadableStream).text();
  if (previousLogs) console.error(previousLogs);
  db.insert(messages).values({ sender_id: user.id, receiver_id: admin.id, content: 'Message sent during a disconnect' }).run();
  assert.equal(await adminView.evaluate("document.querySelector('main')?.innerText.includes('Message sent during a disconnect')"), false);
  await startServer();
  await wait(adminView, "document.querySelector('main')?.innerText.includes('Message sent during a disconnect')");
  await wait(userView, "document.querySelector('main')?.innerText.includes('Message sent during a disconnect')");
  await userView.click('input.toggle-primary');
  for (let attempt = 0; attempt < 100 && db.select().from(users).where(eq(users.id, user.id)).get()!.message_notifications; attempt++) await Bun.sleep(100);
  assert.equal(db.select().from(users).where(eq(users.id, user.id)).get()!.message_notifications, false);
  checks.push('two-user messaging, live read receipt, reconnect recovery and notification preference');
  console.log('Browser messaging, read receipt and preferences passed.');
  await adminView.navigate(base + 'admin/users');
  await clickText(adminView, 'Add User');
  for (const [selector, value] of Object.entries({ '#edit-fname': 'Created', '#edit-lname': 'Browser', '#edit-email': 'created@example.com', '#edit-user': 'created', '#edit-pass': 'password123' })) await input(adminView, selector, value);
  await adminView.click('.modal form button[type="submit"]');
  await wait(adminView, "!document.querySelector('#edit-user') && document.querySelector('tbody')?.innerText.includes('created')");
  await adminView.evaluate("[...document.querySelectorAll('tbody tr')].find(row => row.innerText.includes('created')).querySelector('td:last-child button').click()");
  await input(adminView, '#edit-fname', 'Edited');
  await adminView.click('.modal form button[type="submit"]');
  await wait(adminView, "!document.querySelector('#edit-user') && document.querySelector('tbody')?.innerText.includes('Edited')");
  checks.push('admin user creation and editing');
  await userView.resize(390, 844);
  await userView.navigate(base + 'my-tickets');
  await wait(userView, "document.querySelector('main')?.innerText.includes('Browser workflow ticket')");
  assert.ok(await userView.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Mobile layout overflows the viewport');
  await userView.evaluate("document.querySelector('nav details').open = true");
  await userView.click('nav details button');
  await wait(userView, "!!document.querySelector('#login-username')");
  sessionCookies.delete(userView);
  await userView.navigate(base + `tickets/${ticket.id}`);
  await wait(userView, "!!document.querySelector('#login-username')");
  checks.push('mobile layout, logout and protected redirect');
  assert.deepEqual(exceptions, []);
  assert.ok(requests.every(request => !request.startsWith('http') && !request.startsWith('ws') || new URL(request).origin === address), `External or legacy requests: ${requests.filter(request => /^(http|ws)/.test(request) && new URL(request).origin !== address).join(', ')}`);
  assert.ok(!requests.some(request => /^wss?:/.test(request)), 'Legacy WebSocket request remains');
  console.log(JSON.stringify({ checked: checks, browserExceptions: exceptions.length, externalRequests: 0 }));
} finally {
  if (server) { server.kill(); await server.exited; const logs = await new Response(server.stderr as ReadableStream).text(); if (logs) console.error(logs); }
  sqlite.close(); Bun.gc(true);
  for (const name of readdirSync(directory)) {
    for (let attempt = 0; ; attempt++) {
      try { unlinkSync(join(directory, name)); break; }
      catch (failure) { if (!['EBUSY', 'EPERM'].includes((failure as NodeJS.ErrnoException).code ?? '') || attempt === 20) throw failure; await Bun.sleep(50); }
    }
  }
  rmdirSync(directory);
}
