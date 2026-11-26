import { error, json } from "@sveltejs/kit";
import { requireAuth } from "../../../lib/server/auth";
import { getDb } from "../../../lib/server/db";
import {
  listAttachments,
  uploadAttachments,
} from "../../../lib/server/attachments";
import { broadcaster } from "../../../lib/server/realtime";
import type { RequestHandler } from "./$types";
const id = (value: unknown) => {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) error(400, "Invalid ticket ID");
  return result;
};
export const GET: RequestHandler = async ({ url }) =>
  json(
    listAttachments(
      getDb(),
      await requireAuth(),
      id(url.searchParams.get("ticket_id")),
    ),
  );
export const POST: RequestHandler = async ({ request, url }) => {
  const auth = await requireAuth();
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== url.origin
  )
    error(403, "Cross-site requests forbidden");
  if (Number(request.headers.get("content-length")) > 101 * 1024 * 1024)
    error(413, "Upload is too large");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    error(400, "Invalid multipart upload");
  }
  const type = form.get("type"),
    values = form.getAll("files");
  if (values.some((file) => !(file instanceof File)))
    error(400, "Invalid file");
  if (type !== null && typeof type !== "string")
    error(400, "Invalid attachment type");
  const ticketId = id(form.get("ticket_id"));
  const rows = await uploadAttachments(
    getDb(),
    auth,
    ticketId,
    values as File[],
    type ?? undefined,
  );
  broadcaster.ticketUpdated(ticketId, {
    field: "attachments",
    new_value: rows.length === 1 ? rows[0].file_name : `${rows.length} files`,
    updated_by: `User #${auth.user}`,
  });
  return json(rows.length === 1 ? rows[0] : rows, { status: 201 });
};
