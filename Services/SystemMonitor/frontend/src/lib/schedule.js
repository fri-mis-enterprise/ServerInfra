/**
 * Human-readable helpers for backup job labels and systemd OnCalendar schedules.
 */

export const JOB_LABELS = {
  fast: "FAST System",
  system3: "System3",
  sql: "SQL Backups",
  ibs: "IBS Databases",
};

export function jobLabel(job) {
  return JOB_LABELS[job] || job;
}

export const DAYS = [
  { key: "Mon", label: "Mon" },
  { key: "Tue", label: "Tue" },
  { key: "Wed", label: "Wed" },
  { key: "Thu", label: "Thu" },
  { key: "Fri", label: "Fri" },
  { key: "Sat", label: "Sat" },
  { key: "Sun", label: "Sun" },
];

const DAY_INDEX = Object.fromEntries(DAYS.map((d, i) => [d.key, i]));

export function formatTime12h(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "").trim());
  if (!m) return hhmm;
  const h24 = Number(m[1]);
  const min = m[2];
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${min} ${suffix}`;
}

export function formatDaysHuman(days) {
  const ordered = DAYS.map((d) => d.key).filter((k) => days.includes(k));
  if (ordered.length === 0) return "No days selected";
  if (ordered.length === 7) return "Daily";
  const sig = ordered.join(",");
  if (sig === "Mon,Tue,Wed,Thu,Fri,Sat") return "Mon–Sat";
  if (sig === "Mon,Tue,Wed,Thu,Fri") return "Mon–Fri";
  if (sig === "Sat,Sun") return "Weekends";
  return ordered.join(", ");
}

function daysToSystemd(days) {
  const ordered = DAYS.map((d) => d.key).filter((k) => days.includes(k));
  if (ordered.length === 7 || ordered.length === 0) return "*-*-*";
  // Check if contiguous range of 3+ days (e.g. Mon..Sat, Mon..Fri)
  const idxs = ordered.map((d) => DAY_INDEX[d]);
  const contiguous = idxs.length >= 3 && idxs.every((val, i) => i === 0 || val === idxs[i - 1] + 1);
  if (contiguous) return `${ordered[0]}..${ordered[ordered.length - 1]}`;
  return ordered.join(",");
}

/**
 * Parse a systemd OnCalendar string into { supported, days, times, timezone }.
 * Handles common patterns like:
 *   "Mon..Sat 08,13,17:00:00"
 *   "Mon..Sat 10:00:00"
 *   "*-*-* 00:00:00 Asia/Manila"
 *   "Mon,Wed,Fri 09:30:00"
 *   "Sun *-*-* 02:00:00"
 */
export function parseOnCalendar(expr) {
  const raw = String(expr || "").trim();
  if (!raw || raw === "-") {
    return { supported: true, days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], times: ["08:00"], timezone: "" };
  }

  const tokens = raw.split(/\s+/);
  let timezone = "";
  let rest = tokens.slice();
  if (rest.length >= 2 && rest[rest.length - 1].includes("/")) {
    timezone = rest.pop();
  }

  let daySpec = "";
  let timeSpec = "";

  if (rest.length === 2) {
    [daySpec, timeSpec] = rest;
  } else if (rest.length === 3 && rest[1] === "*-*-*") {
    daySpec = rest[0];
    timeSpec = rest[2];
  } else {
    return { supported: false, days: [], times: [], timezone: "" };
  }

  // Parse daySpec
  let days = [];
  if (daySpec === "*-*-*" || daySpec === "*") {
    days = DAYS.map((d) => d.key);
  } else {
    for (const part of daySpec.split(",")) {
      if (part.includes("..")) {
        const [start, end] = part.split("..");
        const si = DAY_INDEX[start];
        const ei = DAY_INDEX[end];
        if (si === undefined || ei === undefined || si > ei) {
          return { supported: false, days: [], times: [], timezone: "" };
        }
        for (let i = si; i <= ei; i++) days.push(DAYS[i].key);
      } else if (DAY_INDEX[part] !== undefined) {
        days.push(part);
      } else {
        return { supported: false, days: [], times: [], timezone: "" };
      }
    }
    days = DAYS.map((d) => d.key).filter((k) => days.includes(k));
  }

  // Parse timeSpec like "08,13,17:00:00" or "10:30:00" or "08:00"
  const tm = /^([0-9,]+):(\d{1,2})(?::(\d{1,2}))?$/.exec(timeSpec);
  if (!tm) {
    return { supported: false, days: [], times: [], timezone: "" };
  }
  const min = tm[2].padStart(2, "0");
  const hours = tm[1].split(",").map((h) => Number(h));
  if (hours.some((h) => Number.isNaN(h) || h < 0 || h > 23) || Number(min) > 59) {
    return { supported: false, days: [], times: [], timezone: "" };
  }
  const times = Array.from(new Set(hours.map((h) => `${String(h).padStart(2, "0")}:${min}`))).sort();
  return { supported: true, days, times, timezone };
}

/**
 * Build a systemd OnCalendar string from { days, times, timezone }.
 * Note: systemd single-line OnCalendar requires all listed hours to share the same minute.
 */
export function buildOnCalendar(days, times, timezone = "") {
  const cleanTimes = Array.from(new Set(times.filter((t) => /^\d{2}:\d{2}$/.test(t)))).sort();
  if (!days.length || !cleanTimes.length) return "";
  const dayPart = daysToSystemd(days);
  const minutes = cleanTimes[0].slice(3, 5);
  const hours = cleanTimes.map((t) => t.slice(0, 2));
  const timePart = `${hours.join(",")}:${minutes}:00`;
  return timezone ? `${dayPart} ${timePart} ${timezone}` : `${dayPart} ${timePart}`;
}

export function formatScheduleHuman(expr) {
  const raw = String(expr || "").trim();
  if (!raw || raw === "-") return "No schedule";
  const parsed = parseOnCalendar(raw);
  if (!parsed.supported || !parsed.times.length) return raw;
  const daysStr = formatDaysHuman(parsed.days);
  const timesStr = parsed.times.map(formatTime12h).join(", ");
  const tzNote = parsed.timezone === "Asia/Manila" ? " (Manila)" : parsed.timezone ? ` (${parsed.timezone})` : "";
  return `${daysStr} · ${timesStr}${tzNote}`;
}
