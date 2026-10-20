// GET /api/weather?kind=current|forecast  ->  OpenWeatherMap JSON (imperial units)
// Env: OWM_API_KEY (secret), OWM_ZIP (e.g. 44004), optional OWM_COUNTRY (default US)
import { env, json, fail, upstreamJSON, upstreamError } from "../lib/util.mjs";

export default async (req) => {
  const kind = new URL(req.url).searchParams.get("kind") || "current";
  if (kind !== "current" && kind !== "forecast") return fail(400, "kind must be current or forecast");
  const key = env("OWM_API_KEY");
  const zip = env("OWM_ZIP");
  if (!key || !zip) return fail(503, "Weather not configured (set OWM_API_KEY and OWM_ZIP)");
  const ttl = kind === "current" ? 600 : 1800; // 10 min / 30 min
  const url = `https://api.openweathermap.org/data/2.5/${kind === "current" ? "weather" : "forecast"}` +
    `?zip=${encodeURIComponent(zip)},${encodeURIComponent(env("OWM_COUNTRY", "US"))}&units=imperial&appid=${encodeURIComponent(key)}`;
  try {
    return json(await upstreamJSON(url, ttl), { maxAge: ttl });
  } catch (e) {
    return upstreamError(e);
  }
};

export const config = { path: "/api/weather" };
