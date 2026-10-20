// Shared helpers for the dashboard's Netlify Functions (server side only).
// API keys come from Netlify environment variables and never reach the browser.

const memo = new Map(); // small per-instance cache (functions stay warm for a while)

export function env(name, fallback = "") {
  const v = (globalThis.Netlify && Netlify.env && Netlify.env.get(name)) || process.env[name];
  return v == null || v === "" ? fallback : String(v);
}

const SECRET_ENV = ["OWM_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CALENDAR_ID", "GOOGLE_DRIVE_FOLDER_ID", "OWM_ZIP"];

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
 * maxAge: seconds the browser may reuse it; Netlify's CDN also caches it
 * (per full URL incl. query) so many page loads cost only one upstream API call.
 */
export function json(body, { status = 200, maxAge = 0 } = {}) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
  };
  if (status === 200 && maxAge > 0) {
    headers["cache-control"] = `public, max-age=${maxAge}`;
    headers["netlify-cdn-cache-control"] = `public, s-maxage=${maxAge}, stale-while-revalidate=${maxAge * 6}`;
    headers["netlify-vary"] = "query";
  } else {
    headers["cache-control"] = "no-store";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function fail(status, message) {
  return json({ error: { message: scrub(message) } }, { status });
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

export function upstreamError(e) {
  const status = e && e.name === "AbortError" ? 504 : 502;
  return fail(status, e && e.message ? e.message : "Upstream request failed");
}
