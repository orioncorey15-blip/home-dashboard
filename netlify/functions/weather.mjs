// GET /api/weather?kind=current|forecast  ->  OpenWeatherMap data (imperial units),
// trimmed to the fields the dashboard shows (no coordinates, city id/name, etc.).
// Env: OWM_API_KEY (secret), OWM_ZIP (e.g. 44004), optional OWM_COUNTRY (default US)
import { env, json, fail, guard, upstreamJSON, upstreamError } from "../lib/util.mjs";

const VARY = ["kind"];
const num = (v) => (typeof v === "number" && isFinite(v) ? v : undefined);

function trimCurrent(d) {
  const main = d.main || {}, wind = d.wind || {}, sys = d.sys || {};
  const w = (d.weather && d.weather[0]) || {};
  return {
    dt: num(d.dt),
    weather: [{ main: w.main, description: w.description, icon: w.icon }],
    main: {
      temp: num(main.temp), feels_like: num(main.feels_like), humidity: num(main.humidity),
      temp_min: num(main.temp_min), temp_max: num(main.temp_max), pressure: num(main.pressure),
    },
    wind: { speed: num(wind.speed), deg: num(wind.deg), gust: num(wind.gust) },
    clouds: { all: num((d.clouds || {}).all) },
    visibility: num(d.visibility),
    sys: { sunrise: num(sys.sunrise), sunset: num(sys.sunset) },
  };
}

function trimForecast(d) {
  return {
    list: ((d && d.list) || []).map((f) => {
      const w = (f.weather && f.weather[0]) || {};
      const out = {
        dt: num(f.dt), pop: num(f.pop),
        main: { temp: num((f.main || {}).temp), feels_like: num((f.main || {}).feels_like) },
        weather: [{ main: w.main, description: w.description, icon: w.icon }],
        wind: { speed: num((f.wind || {}).speed) },
      };
      if (f.rain && num(f.rain["3h"]) !== undefined) out.rain = { "3h": f.rain["3h"] };
      if (f.snow && num(f.snow["3h"]) !== undefined) out.snow = { "3h": f.snow["3h"] };
      return out;
    }),
  };
}

export default async (req) => {
  const blocked = guard(req, VARY);
  if (blocked) return blocked;
  const kind = new URL(req.url).searchParams.get("kind") || "current";
  if (kind !== "current" && kind !== "forecast") return fail(400, "kind must be current or forecast", VARY);
  const key = env("OWM_API_KEY");
  const zip = env("OWM_ZIP");
  if (!key || !zip) return fail(503, "Weather not configured (set OWM_API_KEY and OWM_ZIP)", VARY);
  const ttl = kind === "current" ? 600 : 1800; // 10 min / 30 min
  const url = `https://api.openweathermap.org/data/2.5/${kind === "current" ? "weather" : "forecast"}` +
    `?zip=${encodeURIComponent(zip)},${encodeURIComponent(env("OWM_COUNTRY", "US"))}&units=imperial&appid=${encodeURIComponent(key)}`;
  try {
    const data = await upstreamJSON(url, ttl);
    return json(kind === "current" ? trimCurrent(data) : trimForecast(data), { maxAge: ttl, vary: VARY });
  } catch (e) {
    return upstreamError(e, VARY);
  }
};

export const config = { path: "/api/weather" };
