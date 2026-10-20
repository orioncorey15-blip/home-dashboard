# Home Dashboard

A wall-panel dashboard (clock, weather, calendar, photo slideshow, night mode). It runs
**on the tablet itself**: one free kiosk app opens the files straight from the tablet's
storage. No web server and no hosting needed.

## Files
- `index.html`, `style.css`, `app.js`: the dashboard. Plain ES5 JavaScript, so it works on old Android WebViews.
- `config.example.js`: template for your settings. Copy it to **`config.js`** and fill in your keys.
  `config.js` is git-ignored, so keys never go into the repo.
- `photos/`: only used when `PHOTO_SOURCE: "local"` (see Photos below).
- `manifest.json`, `icon-*.png`: home-screen icon (only used when served over http).

## Tablet setup (one app)
1. **Update "Android System WebView"** (and Chrome) in the Play Store. Fully Kiosk renders pages with it.
2. **Install Fully Kiosk Browser** (free) from the Play Store. It needs Android 6 or newer.
   - Android 5.x: install the APK *Fully Kiosk Browser 1.59.2* from the download box on
     https://www.fully-kiosk.com (allow "Unknown sources" first).
   - Android 4.4: the last working version is APK 1.44.1.
3. **Copy the dashboard folder** to the tablet's internal storage, so you have
   `Internal storage/home-dashboard/index.html` (that's `/sdcard/home-dashboard/`).
   - Either: plug the tablet into a PC by USB and drag the folder over,
   - or: download the zip on the tablet, open it in *My Files* → Extract, and move the folder to Internal storage.
4. Open Fully Kiosk and allow storage access. Swipe in from the **left edge** to open the menu, then **Settings**:
   - *Web Content Settings → Start URL*: `file:///sdcard/home-dashboard/index.html` (three slashes).
   - *Device Management → Keep Screen On*: ON. *Launch on Boot*: ON. Set *Screen Brightness* if you like.
   - *Device Management → Unlock Screen* (skip the lock screen): ON.
   - *Toolbars and Appearance*: *Show Status Bar*, *Show Navigation Bar* and *Show Address Bar*: all OFF (that gives true fullscreen).
   - *Web Browsing Settings*: *Enable Pull to refresh*: ON (a handy manual reload). *Wait for Network Connection*: OFF
     (the page is local, so it should show even without Wi-Fi).
5. Android settings: *Lock screen → None*. *Battery → Fully Kiosk → Don't optimize* (or remove it from "sleeping apps").
   Keep the tablet on its charger.
6. Restart the tablet once to check it boots straight into the dashboard.

The dashboard reloads itself every night at `DAILY_RELOAD_HOUR` (default 3 AM) to free memory.
Weather refreshes every 10 min and the calendar every 15 min. Everything retries on its own after Wi-Fi drops.

## Photos
`PHOTO_SOURCE` in `config.js`:
- **`"drive"` (default):** a Google Drive folder shared as *Anyone with the link → Viewer*.
  Add or remove photos from the Google Drive app on your phone; the tablet picks them up within an hour.
  Google resizes the images for the tablet, and the last photo list is remembered so the slideshow
  still starts without Wi-Fi.
- **`"local"`:** photos stored on the tablet in `home-dashboard/photos/`. Fully private and works offline,
  but you have to copy files over. After adding or removing photos, run `photos/make-photo-list.bat` (Windows)
  or `photos/make-photo-list.sh` (Mac/Linux) to rebuild `photos/photos.js`, then copy the `photos` folder
  to the tablet. Use phone-sized images (~1920px); full camera-resolution files are heavy for an old tablet.

## Updating later
- **Code:** on GitHub choose *Code → Download ZIP*, unzip it, and copy the files over the tablet's
  `home-dashboard` folder. Copy over the old files rather than deleting the folder, so your `config.js` (and photos) stay.
  Then pull down to refresh in Fully (or wait for the 3 AM reload).
- **Settings/keys:** edit `config.js` on the tablet (or on the PC and copy it over), then reload.

## API keys
The keys live only in `config.js` on the tablet. In the Google Cloud console, under *APIs & Services → Credentials*,
set each Google key's **API restrictions** to just *Google Calendar API* or *Google Drive API*.
Don't use "Websites" (HTTP referrer) restrictions: a page opened from a `file://` path sends no referrer, so
requests would be blocked. The OpenWeatherMap key can't be restricted; keep it on the free plan.
