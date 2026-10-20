// Shared helpers for the dashboard's Netlify Functions (server side only).
// API keys come from Netlify environment variables and never reach the browser.

const memo = new Map(); // small per-instance cache (functions stay warm for a while)

export function env(name, fallback = "") {
  const v = (globalThis.Netlify && Netlify.env && Netlify.env.get(name)) || process.env[name];
  return v == null || v === "" ? fallback : String(v);
}

const SECRET_ENV = ["OWM_API_KEY", "GOOGLE_API_KEY", "GOOGLE_DRIVE_API_KEY", "GOOGLE_CALENDAR_ID", "GOOGLE_DRIVE_FOLDER_ID", "OWM_ZIP"];

// Remove anything that looks like a key from text we pass back to the browser.
function scrub(text) {
  let out = String(text || "");
  // Exact configured values first (keys of any shape, private calendar/folder ids).
  for (const name of SECRET_ENV) {
    const v = env(name);
    if (v.length < 4) continue;
    for (const form of [v, encodeURIComponent(v)]) out = out.split(form).join("[" + name.toLowerCase() + "]");
  }
  return out
    .replace(/AIza[0-9A-Za-z_-]{35}/g, "[key]")
    .replace(/\b[0-9a-f]{32}\b/g, "[key]")
    .replace(/(key|appid)=[^&\s"]+/gi, "$1=[key]")
    .slice(0, 300);
}

/**
 * JSON response with caching headers.
 * maxAge: seconds the browser may reuse it; Netlify's CDN also caches it so many
 * page loads cost only one upstream API call.
 * vary: the query parameters that change the answer (all others are ignored in
 * the CDN cache key, so junk parameters can't create new cache entries).
 * No CORS headers: the dashboard calls these from the same site, so other
 * websites' scripts can't read the responses.
 */
export function json(body, { status = 200, maxAge = 0, vary = [] } = {}) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    // same value on every response for a URL (Netlify requires it to be consistent)
    // (an unused dummy name when nothing varies, so junk query strings share one entry)
    "netlify-vary": "query=" + (vary.length ? vary.join("|") : "_"),
  };
  if (status === 200 && maxAge > 0) {
    headers["cache-control"] = `public, max-age=${maxAge}`;
    headers["netlify-cdn-cache-control"] = `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 6}`;
  } else {
    headers["cache-control"] = "no-store";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

/*
 * Soft origin check. Browsers send Origin (cross-origin or non-GET) and/or Referer
 * with requests; if either is present it must be this site: Netlify's URL,
 * DEPLOY_URL or DEPLOY_PRIME_URL, the host the request came in on, or localhost
 * (netlify dev). Requests with neither header (curl, some privacy settings) are
 * allowed, so this only stops other websites from using the endpoints through
 * visitors' browsers; it is NOT authentication. Responses carry no CORS headers,
 * so other sites can't read them anyway.
 */
function originOf(value) {
  try { return new URL(value).origin; } catch { return null; }
}
export function allowedOrigins(req) {
  const set = new Set();
  for (const name of ["URL", "DEPLOY_URL", "DEPLOY_PRIME_URL", "SITE_URL"]) {
    const o = originOf(env(name));
    if (o) set.add(o);
  }
  const self = originOf(req.url);
  if (self) set.add(self);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (host) { set.add("https://" + host); set.add("http://" + host); }
  return set;
}
// localhost pages only count while running `netlify dev`
function isLocal(origin) {
  const dev = env("NETLIFY_DEV") === "true" || env("CONTEXT") === "dev";
  return dev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
export function guard(req, vary = [], methods = ["GET", "HEAD"]) {
  if (!methods.includes(req.method)) return fail(405, "Method not allowed", vary);
  // Browsers always send Sec-Fetch-Site (pages can't drop it the way they can drop
  // Referer); "cross-site" means another website's page made the request.
  // Missing (curl, older WebViews) is allowed like a missing Origin.
  if (req.headers.get("sec-fetch-site") === "cross-site") return fail(403, "Not allowed from this site", vary);
  const ok = allowedOrigins(req);
  for (const h of ["origin", "referer"]) {
    const v = req.headers.get(h);
    if (!v) continue;
    const o = originOf(v);
    if (!o || !(ok.has(o) || isLocal(o))) return fail(403, "Not allowed from this site", vary);
  }
  return null;
}

export function fail(status, message, vary = []) {
  return json({ error: { message: scrub(message) } }, { status, vary });
}

/** Fetch JSON upstream with a timeout and a short in-memory cache. */
export async function upstreamJSON(url, ttlSeconds) {
  const hit = memo.get(url);
  if (hit && hit.expires > Date.now()) return hit.value;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    let data = null;
    try { data = await res.json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const msg = (data && data.error && (data.error.message || data.error)) || (data && data.message) || res.statusText;
      const err = new Error(`Upstream HTTP ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
      err.status = res.status;
      throw err;
    }
    if (memo.size > 50) memo.clear();
    memo.set(url, { value: data, expires: Date.now() + ttlSeconds * 1000 });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export function upstreamError(e, vary = []) {
  const status = e && e.name === "AbortError" ? 504 : 502;
  return fail(status, e && e.message ? e.message : "Upstream request failed", vary);
}
