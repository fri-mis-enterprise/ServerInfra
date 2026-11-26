import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdtemp, readdir, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateDatabase } from "./db/migrate";
import type { getDb } from "./db";
import { attachments, auditLogs, tickets, users } from "./db/schema";
import {
  attachmentPath,
  listAttachments,
  readAttachmentByFilename,
  removeAttachment,
  uploadAttachments,
  validateAttachmentFiles,
} from "./attachments";
let sqlite: Database, db: ReturnType<typeof getDb>, directory: string;
const owner = { user: 1, roles: ["user"] },
  staff = { user: 2, roles: ["mis"] };
function status(run: () => unknown, code: number) {
  try {
    run();
    throw new Error("Expected rejection");
  } catch (err) {
    expect(err).toMatchObject({ status: code });
  }
}
beforeEach(async () => {
  sqlite = new Database(":memory:");
  migrateDatabase(sqlite);
  sqlite.exec("PRAGMA foreign_keys=ON");
  db = drizzle(sqlite);
  db.insert(users)
    .values(
      [1, 2, 3].map((id) => ({
        id,
        first_name: "User",
        last_name: "Test",
        email: `u${id}@example.com`,
        username: `user${id}`,
        password: "hash",
      })),
    )
    .run();
  db.insert(tickets)
    .values({
      id: 1,
      title: "Private",
      description: "Private ticket",
      requester_id: 1,
    })
    .run();
  directory = await mkdtemp(join(tmpdir(), "ticketing-attachment-"));
});
afterEach(async () => {
  sqlite.close();
  for (const file of await readdir(directory))
    await unlink(join(directory, file));
  await rmdir(directory);
});
test("attachments preserve original bytes, authorize downloads and remove metadata/audit/files together", async () => {
  const [row] = await uploadAttachments(
    db,
    owner,
    1,
    [new File(["original document"], "report.txt", { type: "text/plain" })],
    undefined,
    directory,
  );
  expect(await Bun.file(attachmentPath(row.file_name, directory)).text()).toBe(
    "original document",
  );
  expect(listAttachments(db, owner, 1)).toHaveLength(1);
  status(
    () =>
      readAttachmentByFilename(db, { user: 3, roles: ["user"] }, row.file_name),
    403,
  );
  await expect(
    removeAttachment(db, owner, row.id, directory),
  ).rejects.toMatchObject({ status: 403 });
  await removeAttachment(db, staff, row.id, directory);
  expect(db.select().from(attachments).all()).toHaveLength(0);
  expect(await readdir(directory)).toEqual([]);
  expect(db.select().from(auditLogs).all()).toHaveLength(2);
});
test("attachment bounds and paths reject before writing and DB failures clean the entire batch", async () => {
  status(() => attachmentPath("../outside.txt", directory), 400);
  status(() => attachmentPath("a/b.txt", directory), 400);
  status(() => validateAttachmentFiles([]), 400);
  status(
    () =>
      validateAttachmentFiles([
        new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.bin"),
      ]),
    400,
  );
  status(
    () =>
      validateAttachmentFiles(
        Array.from({ length: 6 }, () => new File(["x"], "x.txt")),
      ),
    400,
  );
  await expect(
    uploadAttachments(
      db,
      { user: 3, roles: ["user"] },
      1,
      [new File(["x"], "x.txt")],
      undefined,
      directory,
    ),
  ).rejects.toMatchObject({ status: 403 });
  sqlite.exec(
    "CREATE TRIGGER fail_attachment_audit BEFORE INSERT ON AuditLog WHEN NEW.action='attachment_uploaded' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  await expect(
    uploadAttachments(
      db,
      owner,
      1,
      [new File(["a"], "one.txt"), new File(["b"], "two.txt")],
      undefined,
      directory,
    ),
  ).rejects.toBeDefined();
  expect(db.select().from(attachments).all()).toHaveLength(0);
  expect(await readdir(directory)).toEqual([]);
});

test("failed attachment metadata deletion restores the original and preview", async () => {
  const [row] = await uploadAttachments(
    db,
    owner,
    1,
    [new File(["original"], "file.txt")],
    undefined,
    directory,
  );
  const path = attachmentPath(row.file_name, directory);
  await Bun.write(`${path}.preview.webp`, "preview");
  sqlite.exec(
    "CREATE TRIGGER fail_delete_audit BEFORE INSERT ON AuditLog WHEN NEW.action='attachment_deleted' BEGIN SELECT RAISE(ABORT,'fixture failure'); END",
  );
  await expect(
    removeAttachment(db, staff, row.id, directory),
  ).rejects.toBeDefined();
  expect(await Bun.file(path).text()).toBe("original");
  expect(await Bun.file(`${path}.preview.webp`).text()).toBe("preview");
  expect(db.select().from(attachments).all()).toHaveLength(1);
  expect((await readdir(directory)).sort()).toEqual(
    [row.file_name, `${row.file_name}.preview.webp`].sort(),
  );
});
