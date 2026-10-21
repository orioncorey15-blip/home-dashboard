// GET /api/youtube-search?q=...  ->  up to 12 embeddable YouTube videos for the Media page.
// Uses the YouTube Data API v3 search endpoint with the server-side GOOGLE_API_KEY.
// Replies contain only { id, title, channel, thumb } per video; the key never leaves the server.
// Each search costs 100 quota units (about 100 searches/day on the free quota), so replies are
// cached for a while (in memory, in the browser and on Netlify's CDN).
import { env, json, fail, guard, upstreamJSON } from "../lib/util.mjs";
import { cleanQuery, trim } from "../lib/youtube.mjs";

const VARY = ["q"];
const TTL = 6 * 60 * 60; // 6 h: the same search reuses the cached answer instead of quota

export default async (req) => {
  const blocked = guard(req, VARY);
  if (blocked) return blocked;
  const raw = new URL(req.url).searchParams.get("q");
  if (raw != null && raw.length > 500) return fail(400, "Search is too long", VARY);
  const q = cleanQuery(raw);
  if (!q) return fail(400, "Type something to search for", VARY);
  if (raw !== q) {
    // send other spellings of the same search to its canonical URL, so the CDN caches it once
    return new Response(null, {
      status: 302,
      headers: {
        location: "/api/youtube-search?q=" + encodeURIComponent(q),
        "cache-control": "public, max-age=86400",
        "netlify-cdn-cache-control": "public, s-maxage=86400",
        "netlify-vary": "query=" + VARY.join("|"),
      },
    });
  }
  const key = env("GOOGLE_API_KEY");
  if (!key) return fail(503, "YouTube search not configured (set GOOGLE_API_KEY)", VARY);
  const url = "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoEmbeddable=true" +
    "&safeSearch=moderate&maxResults=12&regionCode=US&q=" + encodeURIComponent(q) + "&key=" + encodeURIComponent(key);
  try {
    const data = await upstreamJSON(url, TTL);
    return json(trim(data), { maxAge: TTL, vary: VARY });
  } catch (e) {
    const text = String((e && e.message) || "");
    if (e && e.name === "AbortError") return fail(504, "YouTube didn't answer in time", VARY);
    if (/quota/i.test(text)) return fail(429, "YouTube search limit reached for today. Try again tomorrow.", VARY);
    if (e && e.status === 403) return fail(502, "YouTube search isn't enabled for this key yet", VARY);
    if (e && e.status === 400) return fail(400, "YouTube couldn't search for that", VARY);
    return fail(502, "YouTube search failed", VARY);
  }
};

export const config = { path: "/api/youtube-search" };
