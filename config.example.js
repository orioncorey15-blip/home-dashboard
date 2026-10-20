// ===== EDIT THESE =====
// Copy this file to config.js and fill in your own values.
// config.js is git-ignored so your keys never end up in the repository.
var CONFIG = {
  WEATHER_API_KEY: "YOUR_OPENWEATHERMAP_API_KEY",
  ZIP: "00000",

  CAL_API_KEY: "YOUR_GOOGLE_CALENDAR_API_KEY",
  CAL_ID: "you@gmail.com",

  // Photo slideshow source:
  //   "drive" = a Google Drive folder shared as "Anyone with the link" (needs the two values below)
  //   "local" = image files in the photos/ folder next to index.html (run make-photo-list after changes)
  PHOTO_SOURCE: "drive",

  DRIVE_API_KEY: "YOUR_GOOGLE_DRIVE_API_KEY",
  DRIVE_FOLDER_ID: "YOUR_DRIVE_FOLDER_ID",

  // Optional: change photo slideshow interval (ms)
  SLIDESHOW_INTERVAL: 8000,

  // Optional: turn night mode on/off automatically (hours 0-23). The Night Mode
  // button still works; the schedule takes over again at the next start/end time.
  // Set both to null to turn the schedule off.
  NIGHT_MODE_START: 22,
  NIGHT_MODE_END: 6,

  // Optional: reload the page once a day at this hour (0-23) to free memory.
  // Set to null to turn off.
  DAILY_RELOAD_HOUR: 3
};
