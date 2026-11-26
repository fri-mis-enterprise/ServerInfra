import { error } from "@sveltejs/kit";
import { and, desc, eq } from "drizzle-orm";
import { rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { AuthContext } from "./auth";
import type { getDb } from "./db";
import { attachments, auditLogs, ticketApprovers, tickets } from "./db/schema";
import { sqliteDateMillis } from "./db/date";
import { deleteFile, saveFile } from "./files";
type Db = ReturnType<typeof getDb>;
type Reader = Pick<Db, "select">;
export const uploadDirectory = () => process.env.UPLOAD_DIR || "./uploads";
const filenamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
export function attachmentPath(
  filename: string,
  directory = uploadDirectory(),
) {
  if (!filenamePattern.test(filename)) error(400, "Invalid filename");
  const root = resolve(directory),
    path = resolve(root, filename);
  if (path !== join(root, filename)) error(400, "Invalid filename");
  return path;
}
export function checkAttachmentTicketAccess(
  db: Reader,
  auth: AuthContext,
  ticketId: number,
) {
  const ticket = db
    .select()
    .from(tickets)
    .where(eq(tickets.id, ticketId))
    .get();
  if (!ticket) error(404, "Ticket not found");
  const approver = db
    .select({ id: ticketApprovers.id })
    .from(ticketApprovers)
    .where(
      and(
        eq(ticketApprovers.ticket_id, ticketId),
        eq(ticketApprovers.approver_id, auth.user),
      ),
    )
    .get();
  if (
    !auth.roles.some((role) => role === "admin" || role === "mis") &&
    ticket.requester_id !== auth.user &&
    ticket.assignee_id !== auth.user &&
    !approver
  )
    error(403, "Access denied");
  return ticket;
}
const dto = (row: typeof attachments.$inferSelect) => ({
  ...row,
  uploaded_at: row.uploaded_at.toISOString(),
});
export function listAttachments(db: Db, auth: AuthContext, ticketId: number) {
  checkAttachmentTicketAccess(db, auth, ticketId);
  return db
    .select()
    .from(attachments)
    .where(eq(attachments.ticket_id, ticketId))
    .orderBy(
      desc(sqliteDateMillis(attachments.uploaded_at)),
      desc(attachments.id),
    )
    .all()
    .map(dto);
}
export function readAttachment(db: Reader, auth: AuthContext, id: number) {
  const row = db.select().from(attachments).where(eq(attachments.id, id)).get();
  if (!row) error(404, "Attachment not found");
  checkAttachmentTicketAccess(db, auth, row.ticket_id);
  return dto(row);
}
export function readAttachmentByFilename(
  db: Db,
  auth: AuthContext,
  filename: string,
) {
  attachmentPath(filename);
  const row = db
    .select()
    .from(attachments)
    .where(eq(attachments.file_name, filename))
    .get();
  if (!row) error(404, "Attachment not found");
  checkAttachmentTicketAccess(db, auth, row.ticket_id);
  return dto(row);
}
export function validateAttachmentFiles(files: File[]) {
  if (files.length < 1 || files.length > 5)
    error(400, "Upload between 1 and 5 files at a time");
  if (
    files.some(
      (file) => !(file instanceof File) || file.size > 20 * 1024 * 1024,
    )
  )
    error(400, "Each attachment must be 20 MB or smaller");
}
function inferredType(mime: string) {
  return mime.startsWith("image/")
    ? "image"
    : mime.startsWith("video/")
      ? "video"
      : mime === "application/pdf" ||
          mime.includes("msword") ||
          mime.includes("officedocument") ||
          mime.startsWith("text/")
        ? "document"
        : "other";
}
export async function uploadAttachments(
  db: Db,
  auth: AuthContext,
  ticketId: number,
  files: File[],
  type?: string,
  directory = uploadDirectory(),
) {
  validateAttachmentFiles(files);
  checkAttachmentTicketAccess(db, auth, ticketId);
  if (
    type !== undefined &&
    ![
      "approval_form",
      "screenshot",
      "document",
      "other",
      "image",
      "video",
    ].includes(type)
  )
    error(400, "Invalid attachment type");
  const saved: Awaited<ReturnType<typeof saveFile>>[] = [];
  try {
    for (const file of files) saved.push(await saveFile(file, directory));
    return db.transaction((tx) => {
      checkAttachmentTicketAccess(tx, auth, ticketId);
      return saved.map((file, index) => {
        const row = tx
          .insert(attachments)
          .values({
            ticket_id: ticketId,
            file_name: file.fileName,
            file_url: `/uploads/${file.fileName}`,
            file_size: file.fileSize,
            mime_type: file.mimeType,
            type: type ?? inferredType(file.mimeType),
          })
          .returning()
          .get()!;
        tx.insert(auditLogs)
          .values({
            ticket_id: ticketId,
            performed_by_id: auth.user,
            action: "attachment_uploaded",
            new_value: files[index].name,
          })
          .run();
        return dto(row);
      });
    });
  } catch (err) {
    await Promise.all(saved.map((file) => deleteFile(file.filePath)));
    throw err;
  }
}
export async function removeAttachment(
  db: Db,
  auth: AuthContext,
  id: number,
  directory = uploadDirectory(),
) {
  if (!auth.roles.some((role) => role === "admin" || role === "mis"))
    error(403, "Only admin/MIS can delete attachments");
  const row = readAttachment(db, auth, id),
    path = attachmentPath(row.file_name, directory),
    staged: [string, string][] = [];
  try {
    for (const original of [path, `${path}.preview.webp`]) {
      const temporary = `${original}.deleting-${crypto.randomUUID()}`;
      try {
        await rename(original, temporary);
        staged.push([original, temporary]);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
    }
    db.transaction((tx) => {
      const removed = tx
        .delete(attachments)
        .where(eq(attachments.id, id))
        .returning()
        .get();
      if (!removed) error(404, "Attachment not found");
      tx.insert(auditLogs)
        .values({
          ticket_id: row.ticket_id,
          performed_by_id: auth.user,
          action: "attachment_deleted",
          old_value: row.file_name,
        })
        .run();
    });
  } catch (err) {
    await Promise.all(
      staged.map(([original, temporary]) => rename(temporary, original)),
    );
    throw err;
  }
  // The database no longer references these files; cleanup failures must not undo a committed deletion.
  for (const [, temporary] of staged)
    await unlink(temporary).catch((err) =>
      console.warn("Attachment cleanup failed:", temporary, err),
    );
  return { success: true };
}
