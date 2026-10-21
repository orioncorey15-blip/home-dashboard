// Helpers for the YouTube search function (kept separate so tests can import them).
export const MAX_Q = 80;

// Lowercase, collapse whitespace, drop control characters, cap the length. Done before the
// cache lookup and the API call, so "Fireplace " and "fireplace" share one cached answer
// (YouTube search isn't case-sensitive).
export function cleanQuery(raw) {
  return String(raw == null ? "" : raw)
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_Q)
    .trim();
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", "#34": '"' };
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (ENTITIES[k]) return ENTITIES[k];
    if (k[0] === "#") {
      const n = k[1] === "x" ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      if (n > 0 && n < 0x110000) return String.fromCodePoint(n);
    }
    return m;
  });
}

function thumbOf(t) {
  const pick = (t && (t.medium || t.high || t.default)) || {};
  const url = String(pick.url || "");
  return /^https:\/\/i\d?\.ytimg\.com\//.test(url) ? url : "";
}

export function trim(data) {
  const items = [];
  for (const it of (data && data.items) || []) {
    const id = it && it.id && it.id.videoId;
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{11}$/.test(id)) continue;
    const sn = it.snippet || {};
    // live streams that haven't started can't play yet
    if (sn.liveBroadcastContent === "upcoming") continue;
    items.push({
      id,
      title: decodeEntities(sn.title).slice(0, 200),
      channel: decodeEntities(sn.channelTitle).slice(0, 100),
      thumb: thumbOf(sn.thumbnails),
    });
  }
  return { items };
}

