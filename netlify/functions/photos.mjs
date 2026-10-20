// GET /api/photos  ->  { files: [{id, mimeType}] }  (image files in the shared Drive folder)
// Env: GOOGLE_DRIVE_FOLDER_ID, GOOGLE_API_KEY (or GOOGLE_DRIVE_API_KEY if you use a separate key)
// The browser then shows each photo from https://lh3.googleusercontent.com/d/<id> (no key needed).
import { env, json, fail, guard, upstreamJSON, upstreamError } from "../lib/util.mjs";

export default async (req) => {
  const blocked = guard(req);
  if (blocked) return blocked;
  const key = env("GOOGLE_DRIVE_API_KEY") || env("GOOGLE_API_KEY");
  const folder = env("GOOGLE_DRIVE_FOLDER_ID");
  if (!key || !folder) return fail(503, "Photos not configured (set GOOGLE_API_KEY and GOOGLE_DRIVE_FOLDER_ID)");
  const ttl = 900; // 15 min
  const q = `'${folder.replace(/'/g, "")}' in parents and trashed = false and mimeType contains 'image/'`;
  const files = [];
  let token = "";
  try {
    for (let page = 0; page < 10; page++) {
      const url = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) +
        "&key=" + encodeURIComponent(key) + "&pageSize=1000" +
        "&fields=" + encodeURIComponent("nextPageToken,files(id,mimeType)") +
        (token ? "&pageToken=" + encodeURIComponent(token) : "");
      const data = await upstreamJSON(url, ttl);
      for (const f of (data && data.files) || []) files.push({ id: f.id, mimeType: f.mimeType });
      token = data && data.nextPageToken;
      if (!token) break;
    }
    return json({ files }, { maxAge: ttl });
  } catch (e) {
    return upstreamError(e);
  }
};

export const config = { path: "/api/photos" };
