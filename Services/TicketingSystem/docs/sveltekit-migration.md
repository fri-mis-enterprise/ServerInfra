# SvelteKit consolidation

[Linear project](https://linear.app/ibs-msap/project/sveltekit-consolidation-3e6a3b910b1f)

The implementation now runs as one SvelteKit 3/Svelte 5 application on Bun 1.4.4 with Zod and Drizzle. Elysia, Eden, Prisma, the old REST tests and the historical Render/PostgreSQL blueprint are removed. Old SQLite SQL migrations survive as test fixtures only.

## Completed implementation

- Native page routing, Bun adapter, PWA worker/update prompt, root and subpath support.
- All 16 existing SQLite tables, compatible UTC/ISO/epoch dates, guarded baseline adoption and versioned migrations.
- Native auth, registration, profile, reference management, ticket reads/mutations, assignments, SLA, escalation, approvals, comments and audit history.
- Admin user/role management, last-active-admin protection, CSAT submissions, analytics and reports.
- Multipart attachments with originals/previews, authenticated downloads, bounds/path checks and rollback cleanup.
- Native messages, conversations, read receipts, notifications and web-push subscriptions/delivery.
- Authenticated SSE with reconnect, ticket/user/role channels, private notes and fresh access/expiry checks.
- One Compose service with the same SQLite/uploads volume keys and JWT/VAPID settings; documented Caddy/backup/upgrade procedure.

Writes keep audit/state/notification records transactional; realtime and web push occur after commit. Rejected tickets with existing approvers require fresh decisions after reopening. Completed-ticket reopening retains prior authorization, clears assignment/completion and resets CSAT. Input validation rejects arbitrary decisions/statuses and privilege fields. Rich-text descriptions/comments are sanitized on writes and historic reads. Historical internal-comment audit text is redacted for requesters.

## Data and deployment boundary

No real database was read, changed or deployed during this work. The retired local Backend directory may still contain ignored user data; it is not part of the application or Docker build. Keep deployed volume/project names and existing secrets, and rehearse using a restored backup before production cutover.

Drizzle compares all model columns/defaults, indexes and foreign keys before recording a baseline. It leaves compatible existing rows and `_prisma_migrations` intact. Never reset the database, apply initial create-table SQL over existing tables or use schema push. New inserts use ISO UTC defaults and runtime update timestamps; reads compare historic date encodings chronologically.

Caddy now forwards the entire `/ticketing/*` prefix to `ticketing-web:3000`. Remove the old separate API handler. Build with the actual browser origin for remote-function CSRF checks. Run one Bun instance; multiple instances need a shared realtime broker.

## Validation

Run `bun run check`, `bun test`, `bun run build`, `bun run test:server` in Frontend. Compiled integration checks cover auth, ticket lifecycle, approvals, comments/SSE privacy, CSAT, admin, messaging, notifications and file originals/previews with disposable fixtures. Browser checks use `bun run test:browser` after a build with local HTTP origin and require Chrome.

Verified: 65 tests/901 assertions; zero type-check errors/warnings; root and `/ticketing/` builds; compiled-server integration and browser workflows in both configurations. Browser checks include repeated conversation deep links, a real disposable-server restart with missed-message recovery, live receipts, admin edits, mobile layout and logout. The browser harness isolates fixture cookies per tab and bypasses the shared service worker during session interception. Local and Caddy Compose models validate with one service and unchanged volume keys.

Docker execution, live Caddy and actual provider push delivery are deployment-host checks. Production cutover remains operational work; implementation completion does not imply it has been deployed.
