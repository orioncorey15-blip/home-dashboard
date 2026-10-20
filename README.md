# Home Dashboard

Personal tablet wall panel dashboard.

## Setup
1. Edit `config.js` with your API keys, ZIP, Calendar ID, and Drive folder ID.
2. Serve the folder over HTTP (required for Google APIs and PWA):
   ```bash
   python3 -m http.server 8000
   ```
   Or use any static server. Open `http://localhost:8000` (or your tablet's LAN IP).

## Notes
- Weather uses OpenWeatherMap (imperial). Refreshes every 10 min.
- Calendar and Drive require the respective Google API keys and public/shared access.
  Calendar refreshes every 15 min and at midnight; the photo list refreshes hourly.
- If a request fails it retries automatically (30s, 1m, 2m … up to the normal interval),
  and everything refreshes when Wi-Fi comes back or the screen wakes up.
- The page reloads itself once a day at `DAILY_RELOAD_HOUR` (default 3 AM), only if the
  site is reachable. This frees memory on old tablets and picks up new Netlify deploys.
- Media controls are local UI state only (no real Spotify/YouTube control without a backend).
- Night mode is a dimming overlay.
- Add to home screen on tablet for fullscreen/kiosk use (manifest + PNG icons included).
- JavaScript is plain ES5 so it runs on old Android Chrome / Samsung Internet.

## Securing the API keys (important)
Everything in `config.js` is public once deployed. Lock the keys down:
- **Google keys** (console.cloud.google.com → APIs & Services → Credentials): set
  *Application restrictions → Websites* to your Netlify URL (e.g. `https://your-site.netlify.app/*`),
  and *API restrictions* to only Google Calendar API / Google Drive API.
- **OpenWeatherMap**: no referrer locking is available; keep it on the free tier so misuse can't cost money,
  and regenerate it if it gets abused.

## Files
- `index.html` — main page
- `style.css` — dark tablet-optimized styles
- `app.js` — all logic
- `config.js` — your keys and settings
- `manifest.json`, `icon-192.png`, `icon-512.png` — PWA
