import { Database } from "bun:sqlite";
import { deflateSync, inflateSync } from "node:zlib";
import { layout, listView, detailView, errorsView } from "./views";

const db = new Database(process.env.AUDIT_DB ?? "/data/audit.db");
db.exec("PRAGMA busy_timeout=30000");
const base = (process.env.BASE_PATH ?? "").replace(/\/$/, "");
const unpack = (value: any) => value ? JSON.parse(inflateSync(value).toString()) : {};
const pack = (value: unknown) => deflateSync(JSON.stringify(value));
const field = (body: any, key: string) => typeof body?.[key] === "string" ? body[key].trim().slice(0, 128) : "";
function logError(source: string, error: unknown) {
  ensureErrorSchema();
  const message = error instanceof Error ? error.message : String(error);
  db.query("INSERT INTO error_logs(occurred_at,source,message,details) VALUES(?,?,?,?)").run(new Date().toISOString(), source, message, error instanceof Error ? error.stack ?? message : message);
}
function ensureErrorSchema() {
  db.exec("CREATE TABLE IF NOT EXISTS error_logs(id INTEGER PRIMARY KEY,occurred_at TEXT,source TEXT,message TEXT,details TEXT,resolved_at TEXT)");
  const columns = db.query("PRAGMA table_info(error_logs)").all() as any[];
  if (!columns.some(column => column.name === "resolved_at")) db.exec("ALTER TABLE error_logs ADD COLUMN resolved_at TEXT");
}
async function open(request: Request) {
  const text = await request.text();
  let body: any = null;
  try { body = request.headers.get("content-type")?.includes("application/json") ? JSON.parse(text || "null") : Object.fromEntries(new URLSearchParams(text)); } catch {}
  const username = field(body, "username"), computer = field(body, "computer"), station = field(body, "station");
  if (!username || !computer || !station) return new Response("username, computer, and station are required", { status: 400 });
  const loggedAt = new Date().toISOString();
  db.query("INSERT INTO events VALUES(NULL,?,?,?,?,?,?,?)").run(loggedAt, station, "SHORTCUT", `${username}@${computer}`, "OPEN", null, pack({ logged_at: loggedAt, username, computer, station }));
  return Response.json({ ok: true });
}
function list(url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim();
  const station = url.searchParams.get("station") ?? "";
  const table = url.searchParams.get("table") ?? "";
  const operation = url.searchParams.get("operation") ?? "";
  const dateFrom = validDate(url.searchParams.get("date_from"));
  const dateTo = validDate(url.searchParams.get("date_to"));
  const requestedPage = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = 25;
  const conditions = ["1=1"], params: Record<string, string> = {};
  if (station) { conditions.push("station = $station"); params.$station = station; }
  if (table) { conditions.push("table_name = $table"); params.$table = table; }
  if (operation) { conditions.push("operation = $operation"); params.$operation = operation; }
  if (dateFrom) { conditions.push("detected_at >= $dateFrom"); params.$dateFrom = `${dateFrom}T00:00:00.000Z`; }
  if (dateTo) { conditions.push("detected_at < $dateTo"); params.$dateTo = `${nextDate(dateTo)}T00:00:00.000Z`; }
  const candidates = db.query(`SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT 10000`).all(params) as any[];
  const needle = q.toLowerCase();
  const matches = candidates
    .map(row => ({ ...row, record: unpack(row.new_record) }))
    .filter(row => !needle || JSON.stringify(row).toLowerCase().includes(needle));
  const total = matches.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pages);

  return layout(listView({
    base, q, station, table, operation, dateFrom, dateTo,
    rows: matches.slice((page - 1) * pageSize, page * pageSize),
    page, pages, total,
  }), base);
}

function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toISOString().startsWith(value) ? value : "";
}

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function detail(id: number) {
  const row: any = db.query("SELECT * FROM events WHERE id = ?").get(id);
  return layout(row
    ? detailView({ base, row, oldRecord: unpack(row.old_record), newRecord: unpack(row.new_record) })
    : "<main><h1>Event not found</h1></main>", base);
}
function errors(url: URL) {
  ensureErrorSchema();
  const showResolved = url.searchParams.get("show_resolved") === "1";
  const rows = db.query(`SELECT * FROM error_logs ${showResolved ? "" : "WHERE resolved_at IS NULL"} ORDER BY id DESC LIMIT 500`).all();
  return layout(errorsView({ base, rows, showResolved }), base, "errors");
}
function resolveError(id: number) {
  ensureErrorSchema();
  db.query("UPDATE error_logs SET resolved_at = COALESCE(resolved_at, ?) WHERE id = ?").run(new Date().toISOString(), id);
  return new Response(null, { status: 303, headers: { location: `${base}/errors` } });
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.startsWith(base + "/")
      ? url.pathname.slice(base.length)
      : url.pathname;

    if (path === "/styles.css") {
      return new Response(Bun.file(new URL("./styles.css", import.meta.url)), {
        headers: { "content-type": "text/css" },
      });
    }

    if (path === "/open") return request.method === "POST" ? open(request) : new Response(null, { status: 405 });
    if (path.startsWith("/errors/") && path.endsWith("/resolve") && request.method === "POST") {
      return resolveError(Number(path.split("/")[2]));
    }

    const body = path === "/errors" && request.method === "GET"
      ? errors(url)
      : path.startsWith("/event/")
      ? detail(Number(path.split("/")[2]))
      : list(url);
    return new Response(body, {
      headers: { "content-type": "text/html;charset=utf-8" },
    });
  },
});

console.log("FAST Audit listening on port " + (process.env.PORT ?? 3000));

let scanning = false;
const scan = async () => {
  if (scanning) return;
  scanning = true;
  try {
    const child = Bun.spawn([
      "python3", "/app/scanner/audit_scan.py",
      process.env.FAST_ROOT ?? "/source", process.env.AUDIT_DB ?? "/data/audit.db",
    ], { stdout: "inherit", stderr: "inherit" });
    const code = await child.exited;
    if (code) { const message = `Audit scan failed with exit code ${code}`; console.error(message); logError("scanner", message); }
  } finally {
    scanning = false;
  }
};

Bun.cron("*/5 * * * *", () => {
  const now = new Date();
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (day >= 1 && day <= 6 && minutes >= 450 && minutes <= 1290) {
    scan();
  }
});
