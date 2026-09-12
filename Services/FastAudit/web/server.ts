import { Database } from "bun:sqlite";
import { inflateSync } from "node:zlib";
import { layout, listView, detailView } from "./views";

const db = new Database(process.env.AUDIT_DB ?? "/data/audit.db", { readonly: true });
db.exec("PRAGMA busy_timeout=30000");
const base = (process.env.BASE_PATH ?? "").replace(/\/$/, "");
const unpack = (value: any) => value ? JSON.parse(inflateSync(value).toString()) : {};
function list(url: URL) {
  const q = (url.searchParams.get("q") ?? "").trim();
  const station = url.searchParams.get("station") ?? "";
  const table = url.searchParams.get("table") ?? "";
  const operation = url.searchParams.get("operation") ?? "";
  const requestedPage = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const pageSize = 25;
  const conditions = ["1=1"], params: Record<string, string> = {};
  if (station) { conditions.push("station = $station"); params.$station = station; }
  if (table) { conditions.push("table_name = $table"); params.$table = table; }
  if (operation) { conditions.push("operation = $operation"); params.$operation = operation; }
  const candidates = db.query(`SELECT * FROM events WHERE ${conditions.join(" AND ")} ORDER BY id DESC LIMIT 10000`).all(params) as any[];
  const needle = q.toLowerCase();
  const matches = candidates
    .map(row => ({ ...row, record: unpack(row.new_record) }))
    .filter(row => !needle || JSON.stringify(row).toLowerCase().includes(needle));
  const total = matches.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pages);

  return layout(listView({
    base, q, station, table, operation,
    rows: matches.slice((page - 1) * pageSize, page * pageSize),
    page, pages, total,
  }), base);
}

function detail(id: number) {
  const row: any = db.query("SELECT * FROM events WHERE id = ?").get(id);
  return layout(row
    ? detailView({ base, row, oldRecord: unpack(row.old_record), newRecord: unpack(row.new_record) })
    : "<main><h1>Event not found</h1></main>", base);
}

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.startsWith(base + "/")
      ? url.pathname.slice(base.length)
      : url.pathname;

    if (path === "/styles.css") {
      return new Response(Bun.file(new URL("./styles.css", import.meta.url)), {
        headers: { "content-type": "text/css" },
      });
    }

    const body = path.startsWith("/event/")
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
    const process = Bun.spawn([
      "python3", "/app/scanner/audit_scan.py",
      process.env.FAST_ROOT ?? "/source", process.env.AUDIT_DB ?? "/data/audit.db",
    ], { stdout: "inherit", stderr: "inherit" });
    const code = await process.exited;
    if (code) console.error(`Audit scan failed: ${code}`);
  } finally {
    scanning = false;
  }
};

Bun.cron("* * * * *", () => {
  const now = new Date();
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const interval = Number(process.env.SCAN_MINUTES ?? 10);
  if (day >= 1 && day <= 6 && now.getMinutes() % interval === 0 && minutes >= 450 && minutes <= 1290) {
    scan();
  }
});
