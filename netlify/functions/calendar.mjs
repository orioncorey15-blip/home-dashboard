// GET /api/calendar?which=main|holiday&timeMin=ISO&timeMax=ISO  ->  { items: [{summary,start,end}] }
// Env: GOOGLE_API_KEY (secret), GOOGLE_CALENDAR_ID (your calendar, kept out of the public repo),
//      optional GOOGLE_HOLIDAY_CALENDAR_ID (default US holidays)
// Only summary/start/end are returned (no descriptions, locations or guests).
import { env, json, fail, upstreamJSON, upstreamError } from "../lib/util.mjs";

const DAY = 86400000;

export default async (req) => {
  const q = new URL(req.url).searchParams;
  const which = q.get("which") || "main";
  const timeMin = q.get("timeMin") || "";
  const timeMax = q.get("timeMax") || "";
  const tMin = Date.parse(timeMin), tMax = Date.parse(timeMax);
  if (which !== "main" && which !== "holiday") return fail(400, "which must be main or holiday");
  if (!isFinite(tMin) || !isFinite(tMax) || tMax <= tMin || tMax - tMin > 45 * DAY ||
      Math.abs(tMin - Date.now()) > 400 * DAY) {
    return fail(400, "timeMin/timeMax must be ISO dates up to 45 days apart");
  }
  const key = env("GOOGLE_API_KEY");
  const calId = which === "main" ? env("GOOGLE_CALENDAR_ID")
    : env("GOOGLE_HOLIDAY_CALENDAR_ID", "en.usa#holiday@group.v.calendar.google.com");
  if (!key || !calId) return fail(503, "Calendar not configured (set GOOGLE_API_KEY and GOOGLE_CALENDAR_ID)");
  const ttl = which === "main" ? 300 : 43200; // 5 min / 12 h
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events` +
    `?key=${encodeURIComponent(key)}&timeMin=${encodeURIComponent(new Date(tMin).toISOString())}` +
    `&timeMax=${encodeURIComponent(new Date(tMax).toISOString())}&singleEvents=true&orderBy=startTime&maxResults=250` +
    `&fields=${encodeURIComponent("items(summary,start,end)")}`;
  try {
    const data = await upstreamJSON(url, ttl);
    return json({ items: (data && data.items) || [] }, { maxAge: ttl });
  } catch (e) {
    return upstreamError(e);
  }
};

export const config = { path: "/api/calendar" };
