// ===== DASHBOARD SETTINGS =====
// This file is public (it's in the GitHub repo and served by Netlify).
// Do NOT put API keys here. Keys and private IDs live in Netlify environment
// variables (see README → "Netlify setup") and are used only by the
// functions in netlify/functions/.
var CONFIG = {
  // Where the data functions live. "/api/" works on Netlify and with `netlify dev`.
  // If you ever open the dashboard from a local file, set the full URL instead,
  // e.g. "https://your-site.netlify.app/api/".
  API_BASE: "/api/",

  // Photo slideshow source:
  //   "drive" = the Google Drive folder set in Netlify (GOOGLE_DRIVE_FOLDER_ID)
  //   "local" = image files in the photos/ folder (note: on Netlify these would be public)
  PHOTO_SOURCE: "drive",

  // Optional: change photo slideshow interval (ms)
  SLIDESHOW_INTERVAL: 8000,

  // Optional: turn night mode on/off automatically (hours 0-23). The Night Mode
  // button still works; the schedule takes over again at the next start/end time.
  // Set both to null to turn the schedule off.
  NIGHT_MODE_START: 22,
  NIGHT_MODE_END: 6,

  // Optional: reload the page once a day at this hour (0-23) to free memory.
  // Set to null to turn off.
  DAILY_RELOAD_HOUR: 3,

  // Spotify: the Client ID of your Spotify developer app (not a secret).
  // Leave empty to keep the demo media controls. See README → "Spotify".
  SPOTIFY_CLIENT_ID: "",
  // Redirect URI: leave empty to use this site's address + /spotify-callback.
  // On the production site that is https://homedashboard8080.netlify.app/spotify-callback,
  // which must be the Redirect URI registered in the Spotify developer app.
  // Only set this if the dashboard is opened from a different address (e.g. a custom domain).
  SPOTIFY_REDIRECT_URI: "",

  // YouTube favourites shown as quick buttons on the Media page.
  // id = the video ID (the part after "v=" in a YouTube link) or a full link.
  YOUTUBE_FAVORITES: [
    // (checked Oct 2026 to allow embedding; some channels, e.g. the Lofi Girl live radio, refuse)
    { title: "Lofi study", id: "lTRiuFIWV54" },
    { title: "Fireplace", id: "L_LUpnjgPso" },
    { title: "Rain", id: "mPZkdNFkNps" }
  ],

  // Weather radar: map centre (roughly the middle of the county - not the
  // house itself) and zoom (6 = several states, 7 = region, 8 = county).
  RADAR_LAT: 41.86,
  RADAR_LON: -80.79,
  RADAR_ZOOM: 7,
  // Radar animation: leave unset for automatic (old/low-memory tablets show just the newest
  // frame), or set true / false to always / never animate.
  // RADAR_ANIMATE: true,

  // Bluetooth button: set to true after turning on Fully Kiosk →
  // Settings → Web Content Settings → "Open Other URL Schemes" (free).
  // Then the button opens Android's Bluetooth settings directly.
  BLUETOOTH_OPEN_VIA_INTENT_URL: false
};
