# Home Dashboard

A wall-panel dashboard (clock, weather, calendar, photo slideshow, night mode, plus a Media page with
YouTube, Spotify and a Bluetooth button). It is hosted free on **Netlify**, and the tablet just opens the
site's https address in Fully Kiosk Browser.

API keys are **never** in the browser: small Netlify Functions (`netlify/functions/`) hold them as
environment variables and the page only calls `/api/weather`, `/api/calendar`, `/api/photos` and `/api/youtube-search`.

## Files
- `index.html`, `style.css`, `app.js`: the dashboard. Plain ES5 JavaScript, so it works on old Android WebViews.
  `style.css` starts with the design tokens (colours, type scale, spacing, card style) used by every page.
- `weather-icons.js`: the animated SVG weather icons (bundled, no icon CDN).
- `vendor/leaflet/` (Leaflet 1.9.4, BSD-2) and `fonts/` (Inter for text and Newsreader for headings, both SIL OFL):
  bundled so nothing depends on a CDN.
- `config.js`: public settings only (night-mode hours, slideshow speed, Spotify client ID, YouTube favourites…).
  **Never put a key in it**: everything in it is visible to anyone who opens the site.
- `sw.js`: service worker. Keeps a copy of the app and the last data, so the dashboard still opens if Wi-Fi
  is down when the tablet boots, then refreshes once the network is back.
- `netlify.toml`, `netlify/`: hosting settings and the functions that call OpenWeatherMap and Google.
- `photos/`: only used when `PHOTO_SOURCE: "local"`.
- `manifest.json`, `icon-*.png`: home-screen icon.

## 1. Netlify setup (one time)
In Netlify, open the site **`homedashboard8080`** (it deploys from `github.com/orioncorey15-blip/home-dashboard`;
production address `https://homedashboard8080.netlify.app`, check it under *Site overview*)
(*Site configuration → Build & deploy*: no build command, publish directory `.`; `netlify.toml` already says this).

*Site configuration → Environment variables → Add a variable* (scope: Functions or All; same value for all deploy contexts):

| Variable | Value |
| --- | --- |
| `OWM_API_KEY` | OpenWeatherMap API key |
| `OWM_ZIP` | your ZIP code, e.g. `12345` |
| `OWM_COUNTRY` | optional, default `US` |
| `GOOGLE_API_KEY` | Google API key with *Google Calendar API* (and *Google Drive API*) enabled |
| `GOOGLE_DRIVE_API_KEY` | optional: separate key for Drive; otherwise `GOOGLE_API_KEY` is used |
| `GOOGLE_CALENDAR_ID` | the calendar's ID (Google Calendar → Settings → *Integrate calendar*) |
| `GOOGLE_HOLIDAY_CALENDAR_ID` | optional, default US holidays |
| `GOOGLE_DRIVE_FOLDER_ID` | the shared photo folder's ID (the part after `/folders/` in its link) |

Then *Deploys → Trigger deploy* so the functions pick up the variables. Check `https://homedashboard8080.netlify.app/api/weather`
shows JSON.

Key hygiene:
- **Make new keys.** Older commits in this public repo contain the previous keys, so treat those as leaked:
  delete them in the Google Cloud console / OpenWeatherMap and use fresh ones only in Netlify.
- Google keys: *APIs & Services → Credentials → API restrictions*: only *Google Calendar API* / *Google Drive API*.
  No website restriction is needed (the key is used server-side).
- The calendar must still be readable by the key (a public calendar). The functions only return what the dashboard
  shows: event titles and times, and photo IDs. Anyone who knows the site address can see those, same as the dashboard.
- The functions are a **soft barrier, not a login**: they send no CORS headers (other websites' scripts can't read
  the answers) and refuse requests whose `Origin`/`Referer` is another site (or that a browser marks `Sec-Fetch-Site: cross-site`). The site's own addresses come from
  Netlify's `URL` / `DEPLOY_URL` / `DEPLOY_PRIME_URL` variables (plus localhost under `netlify dev`). A request with no
  Origin/Referer (e.g. `curl`) is still answered, so treat what they return as public.
- They only return what the dashboard uses: weather is trimmed (no coordinates, city name/ID), calendar items are
  just title/start/end, photos just file IDs. `/api/calendar` takes whole days only
  (`timeMin=YYYY-MM-DD&timeMax=YYYY-MM-DD`, at most 62 days, start within 400 days of today); other ranges are rounded
  and redirected, so random ranges can't fill the cache or use up the Google quota.
- Responses are cached on Netlify's CDN (weather 10-30 min, calendar 5 min, photos 15 min), which keeps the free
  quotas safe.

## 2. Tablet setup (Fully Kiosk Browser)
1. **Update "Android System WebView"** (and Chrome) in the Play Store. Fully Kiosk renders pages with it.
2. **Install Fully Kiosk Browser** (free) from the Play Store. It needs Android 6 or newer.
   - Android 5.x: install the APK *Fully Kiosk Browser 1.59.2* from the download box on https://www.fully-kiosk.com.
   - Android 4.4: the last working version is APK 1.44.1.
3. In Fully (swipe in from the **left edge** → **Settings**):
   - *Web Content Settings → Start URL*: `https://homedashboard8080.netlify.app/`
   - *Web Content Settings → Open Other URL Schemes*: ON (free; lets the Bluetooth button open Bluetooth settings, see below).
   - *Web Content Settings → Autoplay Videos / Enable Fullscreen Videos*: ON (for YouTube).
   - *Device Management → Keep Screen On*: ON. *Launch on Boot*: ON. *Unlock Screen*: ON.
   - *Toolbars and Appearance*: *Show Status Bar*, *Show Navigation Bar*, *Show Address Bar*: all OFF.
   - *Web Browsing Settings*: *Enable Pull to refresh*: ON. *Wait for Network Connection*: OFF
     (the service worker shows the saved copy when offline).
4. Android settings: *Lock screen → None*. *Battery → Fully Kiosk → Don't optimize*. Keep the tablet on its charger.
5. Restart the tablet once to check it boots straight into the dashboard.

Night mode dims the screen on the schedule in `config.js` (`NIGHT_MODE_START` / `NIGHT_MODE_END`, default 22 and 6;
`null` turns the schedule off). The page reloads itself every night at `DAILY_RELOAD_HOUR` (default 3 AM).

## 3. Spotify (optional)
Media → Spotify becomes an Android Auto-style browser once connected: your **Playlists**, **Liked Songs**, **Recent**,
saved **Albums** and **Podcasts** as big cover grids/rows (more load as you scroll), playlist/album/podcast pages with
**Play** and **Shuffle**, **Search** (songs, artists, albums, playlists, podcasts), **Up next** (the queue) and a
**device picker**. A compact mini player sits under the browser; ⛶ (or tapping the song title) opens a full-screen
player with big art, progress, controls, shuffle/repeat and volume (✕, tapping the art, or Esc closes it).
Sign-in uses Spotify's PKCE flow, so there is **no secret** anywhere.

1. Go to https://developer.spotify.com/dashboard, log in, *Create app*.
   - Redirect URIs (exactly, https, no trailing slash):
     `https://homedashboard8080.netlify.app/spotify-callback` and
     `https://ui-revamp--homedashboard8080.netlify.app/spotify-callback` (the draft site).
   - APIs used: *Web API*.
2. Copy the app's **Client ID** into `config.js` → `SPOTIFY_CLIENT_ID` and commit/deploy (done:
   `5f41fa0dba664f37bbd82df44be3f87a`). Leave `SPOTIFY_REDIRECT_URI` empty; the dashboard uses its own address +
   `/spotify-callback`. The client ID is public by design; the client secret isn't used anywhere.
3. In the app's *User Management*, add the name + email of each Spotify account that will connect
   (development-mode apps allow up to 5 users). Spotify requires the **app owner to have Premium**
   for a development-mode app to work.
4. On the tablet: Media → **Connect Spotify** → log in → you're sent back to the dashboard. The tablet stays signed in
   (the refresh token is kept in the browser's local storage; ⋯ → *Disconnect Spotify* removes it).
   Permissions asked for: read your library, playlists (incl. collaborative) and recently played; see and control playback.

**Where it plays.** Spotify plays through its own apps; the dashboard is the remote. Install the Spotify app on the
tablet: when nothing is playing, tapping a song starts it on the tablet's Spotify app (or the device named in
`SPOTIFY_DEVICE_NAME`). If no Spotify device is awake, the device picker explains it and offers **Open Spotify app**
(Fully Kiosk opens `com.spotify.music`; elsewhere an `intent:` link with an open.spotify.com fallback).
Video podcasts can't be shown in a web page, so they get an **Open in Spotify app to watch** button.

Limits (Spotify's, not the dashboard's): playback control needs **Premium**; a free account shows what's playing and
"Controls need Spotify Premium". Spotify no longer gives new apps editorial/"made for you" playlists, recommendations,
new releases or artist top tracks, so the browser shows only your own library + search. Since Feb 2026 Spotify only lists
the songs of playlists you own or collaborate on (others still play with **Play**), and search returns up to 10 of each type.
Rate limits (429) are retried after Spotify's Retry-After; an expired sign-in is refreshed automatically.

## 4. YouTube
Media → YouTube button: paste a link (youtu.be/…, youtube.com/watch?v=…, shorts, live) or a video ID, or tap a favourite
(`YOUTUBE_FAVORITES` in `config.js`). ⛶ makes it fullscreen, ✕ stops it. Some videos (e.g. many music videos and the
Lofi Girl live radio) are blocked from playing outside youtube.com by their owners; the dashboard says so.

**Search**: type in the search box and tap Search (or Enter). Results come from `/api/youtube-search`, which calls the
YouTube Data API v3 with the server-side `GOOGLE_API_KEY` (the key needs "YouTube Data API v3" enabled in Google Cloud).
Only embeddable videos are returned (safe search: moderate). Each search costs 100 of the 10,000 free daily quota
units, so about 100 searches a day; repeated searches are cached for 6 hours. When the quota runs out the panel says
so and favourites/links keep working.

## Weather radar
The Weather page shows an animated radar loop (last 55 minutes, 5-minute steps) centred on `RADAR_LAT`/`RADAR_LON`
in `config.js`; a small live preview sits on the Home weather card (tap it to open the big one). Sources, all free and
key-less: NWS NEXRAD composite tiles from the Iowa Environmental Mesonet (falls back to RainViewer automatically),
on Esri's Dark Gray Canvas base map (falls back to OpenStreetMap). The map library (Leaflet) is bundled.

Zoom: the map fits roughly the home county and its neighbours (about ±0.3° latitude, ±0.8° longitude, e.g. Erie PA to
Cleveland) into whatever size it has, capped at `RADAR_ZOOM` (default 9); the Home preview may use up to one level less.
The recenter button goes back to that home view. *View Full Radar* makes the radar fill the Weather page (*Close* returns).

Old or low-memory tablets (2 GB RAM or less, or a screen of 1024 px or less, like the 1024x600 one) load only the newest
radar frame and don't animate, so the Play button and frame bar are hidden. `RADAR_ANIMATE: true` / `false` in
`config.js` forces animation on / off. In night mode the loop stops on the newest frame and restarts in the morning.

`LOCATION_NAME` in `config.js` is the place name shown on the Weather page and Home card. It is only a label in the
browser; the weather function still uses `OWM_ZIP` and returns no coordinates or city name.

## Calendar
The Calendar page opens on the current month. ‹ / › go back or forward up to 12 months (other months are fetched when
you open them), *Today* jumps back, and it returns to the current month by itself after 3 minutes. Holidays are green,
other events blue; tap a day for its full list. On Home, *Today's events* gets a small icon guessed from each title
(work, kids, health, social, travel…); *View Calendar* opens the page.

## 5. Bluetooth button
A web page can't pair a speaker, but it can open Android's Bluetooth settings:
- **Fully Kiosk with *Open Other URL Schemes* ON (free):** set `BLUETOOTH_OPEN_VIA_INTENT_URL: true` in `config.js`.
  The button opens Bluetooth settings; press Back to return to the dashboard.
- **Fully Kiosk PLUS** (paid licence, about €8.90 / $10.99 per device, one-time) with
  *Advanced Web Settings → Enable JavaScript Interface* ON: the button uses `fully.startIntent(...)` automatically.
- Otherwise the button shows short instructions (swipe down → long-press Bluetooth) and a *Try* button.
The "Source" bar at the bottom of Media switches between Spotify, YouTube (opens the player with search) and
Bluetooth (the button above); it also shows the Spotify device name when Spotify is connected. *Repeat* cycles
Off / All / One (Spotify Premium).

## 6. Local Music (Navidrome)
Media → **Local Music** plays the home Navidrome library (Subsonic API) in the tablet's own `<audio>` player.
- Servers are listed in `config.js` → `NAVIDROME_URLS`, tried in order with `ping.view` (4 s each); the first that
  answers is used for the session. Default: `https://corey.tail3ebea9.ts.net` (Tailscale Serve), then
  `http://192.168.254.70:4533` (home Wi-Fi). The server field in the sign-in form can be edited.
- **No credentials are in the repo.** Sign in on the tablet with your Navidrome username and password. Only the
  username and a Subsonic token (`md5(password + random salt)`) are kept in localStorage, never the password.
  *Sign out* (the person icon) forgets them.
- **Tailscale (recommended):** install the Tailscale app on the tablet, sign in, and keep it connected. The https
  address then works at home and away.
- **LAN address (`http://…:4533`):** the dashboard is https, so Fully Kiosk must allow mixed content:
  *Settings → Advanced Web Settings → Mixed Content Mode → Always Allow Mixed Content* (Fully 1.43+). Fully's docs
  warn that Android WebView 111+ may still block some mixed content (local IPs especially), so prefer Tailscale.
- Streams use `format=mp3&maxBitRate=NAVIDROME_MAX_BITRATE` (192), falling back to the original file. Plays are
  scrobbled to Navidrome (now playing at the start, played after half the song).

## Photos
`PHOTO_SOURCE` in `config.js`:
- **`"drive"` (default):** a Google Drive folder shared as *Anyone with the link → Viewer* (ID in `GOOGLE_DRIVE_FOLDER_ID`).
  Add or remove photos from the Drive app; the dashboard picks them up within the hour. Images load straight from
  Google without a key.
- **`"local"`:** photos in `photos/` deployed with the site (run `photos/make-photo-list.sh` / `.bat` to rebuild
  `photos/photos.js`). Note the repo is public, so so are those photos; Drive is usually the better choice.

## Testing locally
`netlify dev` (from netlify-cli) serves the site and the functions together at http://localhost:8888.
Put the variables above in a `.env` file next to `netlify.toml` (git-ignored) or export them in the shell.
Opening `index.html` straight from disk (file://) no longer loads weather/calendar, because those now come from the functions.
