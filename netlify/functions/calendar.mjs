// GET /api/calendar?which=main|holiday&timeMin=YYYY-MM-DD&timeMax=YYYY-MM-DD
//   ->  { items: [{summary,start,end}] }
// Dates are whole UTC days; timeMax is exclusive. Other forms (full ISO times) are
// rounded out to whole days and redirected to that canonical URL, so arbitrary ranges
// can't create endless cache entries or upstream calls. Max span 62 days, start within
// 400 days of today.
// Env: GOOGLE_API_KEY (secret), GOOGLE_CALENDAR_ID (your calendar, kept out of the public repo),
//      optional GOOGLE_HOLIDAY_CALENDAR_ID (default US holidays)
// Only summary/start/end are returned (no descriptions, locations or guests).
import { env, json, fail, guard, upstreamJSON, upstreamError } from "../lib/util.mjs";

const DAY = 86400000;
const MAX_SPAN_DAYS = 62;
const WINDOW_DAYS = 400;
const VARY = ["which", "timeMin", "timeMax"];

const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
function parseDay(v) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return Date.parse(v + "T00:00:00Z");
  return Date.parse(v);
}

export default async (req) => {
  const blocked = guard(req, VARY);
  if (blocked) return blocked;
  const u = new URL(req.url);
  const q = u.searchParams;
  const which = q.get("which") || "main";
  if (which !== "main" && which !== "holiday") return fail(400, "which must be main or holiday", VARY);
  const rawMin = q.get("timeMin") || "", rawMax = q.get("timeMax") || "";
  let tMin = parseDay(rawMin), tMax = parseDay(rawMax);
  if (!isFinite(tMin) || !isFinite(tMax) || tMax <= tMin) {
    return fail(400, "timeMin/timeMax must be dates (YYYY-MM-DD), timeMin before timeMax", VARY);
  }
  // round out to whole UTC days, then clamp the span
  tMin = Math.floor(tMin / DAY) * DAY;
  tMax = Math.ceil(tMax / DAY) * DAY;
  if (tMax - tMin > MAX_SPAN_DAYS * DAY) tMax = tMin + MAX_SPAN_DAYS * DAY;
  const today = Math.floor(Date.now() / DAY) * DAY;
  if (Math.abs(tMin - today) > WINDOW_DAYS * DAY) {
    return fail(400, `timeMin must be within ${WINDOW_DAYS} days of today`, VARY);
  }
  const cMin = dayStr(tMin), cMax = dayStr(tMax);
  if (rawMin !== cMin || rawMax !== cMax || q.get("which") !== which) {
    const to = new URL(u.pathname, u);
    to.search = new URLSearchParams({ which, timeMin: cMin, timeMax: cMax }).toString();
    return new Response(null, {
      status: 302,
      headers: {
        location: to.pathname + to.search,
        "cache-control": "public, max-age=86400",
        "netlify-cdn-cache-control": "public, s-maxage=86400",
        "netlify-vary": "query=" + VARY.join("|"),
      },
    });
  }

  const key = env("GOOGLE_API_KEY");
  const calId = which === "main" ? env("GOOGLE_CALENDAR_ID")
    : env("GOOGLE_HOLIDAY_CALENDAR_ID", "en.usa#holiday@group.v.calendar.google.com");
  if (!key || !calId) return fail(503, "Calendar not configured (set GOOGLE_API_KEY and GOOGLE_CALENDAR_ID)", VARY);
  const ttl = which === "main" ? 300 : 43200; // 5 min / 12 h
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events` +
    `?key=${encodeURIComponent(key)}&timeMin=${encodeURIComponent(new Date(tMin).toISOString())}` +
    `&timeMax=${encodeURIComponent(new Date(tMax).toISOString())}&singleEvents=true&orderBy=startTime&maxResults=250` +
    `&fields=${encodeURIComponent("items(summary,start,end)")}`;
  try {
    const data = await upstreamJSON(url, ttl);
    // Map explicitly: don't rely on the fields= filter alone to keep private details out.
    const items = ((data && data.items) || []).map((e) => ({ summary: e.summary, start: e.start, end: e.end }));
    return json({ items }, { maxAge: ttl, vary: VARY });
  } catch (e) {
    return upstreamError(e, VARY);
  }
};

export const config = { path: "/api/calendar" };
