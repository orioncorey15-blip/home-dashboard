# Home Dashboard

A wall-panel dashboard (clock, weather, calendar, photo slideshow, night mode, plus a Media page with
YouTube, Spotify and a Bluetooth button). It is hosted free on **Netlify**, and the tablet just opens the
site's https address in Fully Kiosk Browser.

API keys are **never** in the browser: small Netlify Functions (`netlify/functions/`) hold them as
environment variables and the page only calls `/api/weather`, `/api/calendar` and `/api/photos`.

## Files
- `index.html`, `style.css`, `app.js`: the dashboard. Plain ES5 JavaScript, so it works on old Android WebViews.
- `config.js`: public settings only (night-mode hours, slideshow speed, Spotify client ID, YouTube favourites…).
  **Never put a key in it**: everything in it is visible to anyone who opens the site.
- `sw.js`: service worker. Keeps a copy of the app and the last data, so the dashboard still opens if Wi-Fi
  is down when the tablet boots, then refreshes once the network is back.
- `netlify.toml`, `netlify/`: hosting settings and the functions that call OpenWeatherMap and Google.
- `photos/`: only used when `PHOTO_SOURCE: "local"`.
- `manifest.json`, `icon-*.png`: home-screen icon.

## 1. Netlify setup (one time)
In Netlify, open the site that deploys from `github.com/orioncorey15-blip/home-dashboard`
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

Then *Deploys → Trigger deploy* so the functions pick up the variables. Check `https://<your-site>.netlify.app/api/weather`
shows JSON.

Key hygiene:
- **Make new keys.** Older commits in this public repo contain the previous keys, so treat those as leaked:
  delete them in the Google Cloud console / OpenWeatherMap and use fresh ones only in Netlify.
- Google keys: *APIs & Services → Credentials → API restrictions*: only *Google Calendar API* / *Google Drive API*.
  No website restriction is needed (the key is used server-side).
- The calendar must still be readable by the key (a public calendar). The functions only return what the dashboard
  shows: event titles and times, and photo IDs. Anyone who knows the site address can see those, same as the dashboard.
- Responses are cached on Netlify's CDN (weather 10-30 min, calendar 5 min, photos 15 min), which keeps the free
  quotas safe.

## 2. Tablet setup (Fully Kiosk Browser)
1. **Update "Android System WebView"** (and Chrome) in the Play Store. Fully Kiosk renders pages with it.
2. **Install Fully Kiosk Browser** (free) from the Play Store. It needs Android 6 or newer.
   - Android 5.x: install the APK *Fully Kiosk Browser 1.59.2* from the download box on https://www.fully-kiosk.com.
   - Android 4.4: the last working version is APK 1.44.1.
3. In Fully (swipe in from the **left edge** → **Settings**):
   - *Web Content Settings → Start URL*: `https://<your-site>.netlify.app/`
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
Shows the song playing on any of your Spotify devices, with album art and progress, and gives
play/pause, next, previous and volume. Sign-in uses Spotify's PKCE flow, so there is **no secret** anywhere.

1. Go to https://developer.spotify.com/dashboard, log in, *Create app*.
   - Redirect URI: `https://<your-site>.netlify.app/spotify-callback` (exactly; https is required).
   - APIs used: *Web API*.
2. Copy the app's **Client ID** into `config.js` → `SPOTIFY_CLIENT_ID` and commit/deploy.
   (The client ID is public by design. Don't copy the client secret anywhere; it isn't used.)
3. In the app's *User Management*, add the name + email of each Spotify account that will connect
   (development-mode apps allow up to 5 users). Spotify currently requires the **app owner to have Premium**
   for a development-mode app to work.
4. On the tablet: Media → **Connect Spotify** → log in → you're sent back to the dashboard. The tablet stays signed in
   (the refresh token is kept in the browser's local storage; *Disconnect Spotify* removes it).

Controls (play/pause, skip, volume) need **Spotify Premium** on the account that's listening; on a free account the
dashboard still shows what's playing and says "Controls need Spotify Premium". Start music on a phone/speaker first:
the dashboard is a remote, not a player. It checks every ~5 s while the Media or Home page is visible, less often otherwise.

## 4. YouTube
Media → YouTube button: paste a link (youtu.be/…, youtube.com/watch?v=…, shorts, live) or a video ID, or tap a favourite
(`YOUTUBE_FAVORITES` in `config.js`). ⛶ makes it fullscreen, ✕ stops it. Some videos (e.g. many music videos and the
Lofi Girl live radio) are blocked from playing outside youtube.com by their owners; the dashboard says so.

## 5. Bluetooth button
A web page can't pair a speaker, but it can open Android's Bluetooth settings:
- **Fully Kiosk with *Open Other URL Schemes* ON (free):** set `BLUETOOTH_OPEN_VIA_INTENT_URL: true` in `config.js`.
  The button opens Bluetooth settings; press Back to return to the dashboard.
- **Fully Kiosk PLUS** (paid licence, about €8.90 / $10.99 per device, one-time) with
  *Advanced Web Settings → Enable JavaScript Interface* ON: the button uses `fully.startIntent(...)` automatically.
- Otherwise the button shows short instructions (swipe down → long-press Bluetooth) and a *Try* button.
The "Output" card shows the Spotify device name when Spotify is connected.

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
