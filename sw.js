/*
 * Service worker: lets the dashboard open even if Wi-Fi is down when the tablet boots.
 * - App shell (HTML/CSS/JS/icons): network first (so new deploys show up), cached copy if offline.
 * - Data (/api/...): network first; if offline, the last saved copy is returned with the
 *   header "X-Dashboard-Offline: 1" so the app knows to keep retrying.
 * - YouTube search and everything else (photos, map/radar tiles, YouTube, Spotify): not touched
 *   (normal browser caching).
 * Plain ES5 so it parses on old Chrome; only registered where service workers exist.
 */
var VERSION = "v2";
var SHELL_CACHE = "dash-shell-" + VERSION;
var DATA_CACHE = "dash-data-" + VERSION;
var SHELL = ["./", "index.html", "style.css", "app.js", "config.js", "weather-icons.js", "manifest.json", "icon-192.png", "icon-512.png",
  "vendor/leaflet/leaflet.js", "vendor/leaflet/leaflet.css",
  "fonts/inter-latin-300-normal.woff2", "fonts/inter-latin-400-normal.woff2", "fonts/inter-latin-500-normal.woff2",
  "fonts/inter-latin-600-normal.woff2", "fonts/inter-latin-700-normal.woff2"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // add one by one (cache.addAll is missing on some old Chrome versions)
      return Promise.all(SHELL.map(function (url) {
        return fetch(url, { cache: "no-cache" }).then(function (res) {
          if (res && res.ok) return cache.put(url, res);
        })["catch"](function () { /* ignore: will be cached on next visit */ });
      }));
    }).then(function () { return self.skipWaiting && self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== SHELL_CACHE && k !== DATA_CACHE) return caches["delete"](k);
      }));
    }).then(function () { return self.clients && self.clients.claim && self.clients.claim(); })
  );
});

function timeout(ms) {
  return new Promise(function (resolve, reject) { setTimeout(function () { reject(new Error("timeout")); }, ms); });
}

function networkFirst(request, cacheName, ms, cacheKey, markOffline) {
  return Promise.race([fetch(request), timeout(ms)]).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(cacheName).then(function (c) { return c.put(cacheKey || request, copy); })["catch"](function () {});
    }
    return res;
  })["catch"](function (err) {
    return caches.open(cacheName).then(function (c) {
      return c.match(cacheKey || request, { ignoreSearch: !markOffline });
    }).then(function (hit) {
      if (!hit) throw err;
      if (!markOffline) return hit;
      return hit.text().then(function (body) {
        var headers = new Headers();
        headers.set("Content-Type", hit.headers.get("Content-Type") || "application/json");
        headers.set("X-Dashboard-Offline", "1");
        return new Response(body, { status: 200, statusText: "OK (offline copy)", headers: headers });
      });
    });
  });
}

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  var scope = self.registration ? self.registration.scope : self.location.origin + "/";
  var path = url.href.indexOf(scope) === 0 ? url.href.slice(scope.length).split("?")[0] : null;
  if (path === null) return;

  // YouTube search: always live (an offline copy of old results isn't useful, and it would grow the cache)
  if (path.indexOf("api/youtube-search") === 0) return;
  if (path.indexOf("api/") === 0) {
    event.respondWith(networkFirst(req, DATA_CACHE, 10000, null, true));
    return;
  }
  if (req.mode === "navigate" || path === "" || path === "spotify-callback") {
    // Any page load: fresh index.html if possible, cached one if offline.
    event.respondWith(networkFirst(req, SHELL_CACHE, 5000, "index.html", false));
    return;
  }
  if (SHELL.indexOf(path) !== -1) {
    event.respondWith(networkFirst(req, SHELL_CACHE, 5000, path, false));
  }
});
