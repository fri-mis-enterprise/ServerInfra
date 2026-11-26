import { error, json } from "@sveltejs/kit";
import { requireAuth } from "../../../../lib/server/auth";
import { getDb } from "../../../../lib/server/db";
import {
  readAttachment,
  removeAttachment,
} from "../../../../lib/server/attachments";
import { broadcaster } from "../../../../lib/server/realtime";
import type { RequestHandler } from "./$types";
const id = (value: string) => {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0)
    error(400, "Invalid attachment ID");
  return result;
};
export const GET: RequestHandler = async ({ params }) =>
  json(readAttachment(getDb(), await requireAuth(), id(params.id)));
export const DELETE: RequestHandler = async ({ params, request, url }) => {
  const auth = await requireAuth();
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== url.origin
  )
    error(403, "Cross-site requests forbidden");
  const attachment = readAttachment(getDb(), auth, id(params.id));
  await removeAttachment(getDb(), auth, attachment.id);
  broadcaster.ticketUpdated(attachment.ticket_id, {
    field: "attachments",
    updated_by: `User #${auth.user}`,
  });
  return new Response(null, { status: 204 });
};
