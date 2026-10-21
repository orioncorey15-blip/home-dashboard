/*
 * Home Dashboard - Local Music: plays Orion's own music from a Navidrome server through the Subsonic API
 * (https://www.subsonic.org/pages/api.jsp, v1.16.1, f=json). Plain ES5 like app.js (no arrow functions,
 * let/const, template strings, fetch, optional chaining) so it runs on old Android WebViews.
 *
 * Sign-in: the tablet keeps only the username and a Subsonic token, t = md5(password + s) with a random salt s
 * (Subsonic "token authentication", API 1.13.0+). The password itself is never stored.
 * app.js creates the module with window.createLocalMusic(bridge) and talks to it through the returned object.
 */
(function () {
  "use strict";

  /* ===== MD5 (RFC 1321) of a string's UTF-8 bytes, as lowercase hex. Old WebViews have no crypto.subtle
     (and it has no MD5 anyway). ===== */
  var md5 = (function () {
    var S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21], K = [], i;
    for (i = 0; i < 64; i++) K[i] = (Math.abs(Math.sin(i + 1)) * 4294967296) | 0;
    function add(x, y) { var l = (x & 0xffff) + (y & 0xffff); return (((x >> 16) + (y >> 16) + (l >> 16)) << 16) | (l & 0xffff); }
    function rol(n, c) { return (n << c) | (n >>> (32 - c)); }
    function hex(n) { var s = "", j, b; for (j = 0; j < 4; j++) { b = (n >>> (j * 8)) & 255; s += (b < 16 ? "0" : "") + b.toString(16); } return s; }
    return function (str) {
      var bytes = unescape(encodeURIComponent(String(str))), n = bytes.length, words = [], j;
      for (j = 0; j < n; j++) words[j >> 2] |= bytes.charCodeAt(j) << ((j % 4) * 8);
      words[n >> 2] |= 0x80 << ((n % 4) * 8);
      var total = (((n + 8) >> 6) + 1) * 16;
      for (j = 0; j < total; j++) if (!words[j]) words[j] = 0;
      words[total - 2] = (n * 8) | 0;
      words[total - 1] = Math.floor(n / 536870912);
      var a0 = 0x67452301, b0 = 0xefcdab89 | 0, c0 = 0x98badcfe | 0, d0 = 0x10325476;
      for (var off = 0; off < total; off += 16) {
        var a = a0, b = b0, c = c0, d = d0, f, g, t;
        for (j = 0; j < 64; j++) {
          if (j < 16) { f = (b & c) | (~b & d); g = j; }
          else if (j < 32) { f = (d & b) | (~d & c); g = (5 * j + 1) % 16; }
          else if (j < 48) { f = b ^ c ^ d; g = (3 * j + 5) % 16; }
          else { f = c ^ (b | ~d); g = (7 * j) % 16; }
          t = d; d = c; c = b;
          b = add(b, rol(add(add(a, f), add(K[j], words[off + g])), S[(j >> 4) * 4 + (j % 4)]));
          a = t;
        }
        a0 = add(a0, a); b0 = add(b0, b); c0 = add(c0, c); d0 = add(d0, d);
      }
      return hex(a0) + hex(b0) + hex(c0) + hex(d0);
    };
  })();

  window.createLocalMusic = function (bridge) {
    var CFG = bridge.CFG || {};
    var API_VERSION = "1.16.1", CLIENT = "homedashboard", AUTH_KEY = "lmAuth";
    var MAX_BITRATE = Number(CFG.NAVIDROME_MAX_BITRATE) > 0 ? Number(CFG.NAVIDROME_MAX_BITRATE) : 192;
    var PAGE = 40, CHUNK = 120, TIMEOUT_MS = 15000;
    var store = bridge.store, fmt = bridge.fmtDuration;

    function $(id) { return document.getElementById(id); }
    function each(list, fn) { Array.prototype.forEach.call(list || [], fn); }
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; }
    function setText(id, t) { var e = $(id); if (e && e.textContent !== t) e.textContent = t; }
    function toggleClass(e, cls, on) { if (!e) return; if (on) e.classList.add(cls); else e.classList.remove(cls); }
    function list(x) { return !x ? [] : (Object.prototype.toString.call(x) === "[object Array]" ? x : [x]); }
    function now() { return new Date().getTime(); }

    /* ---------- sign-in: { url (only if it differs from config.js), u, t, s } ---------- */
    var auth = null;
    try { auth = JSON.parse(store.get(AUTH_KEY) || "null"); } catch (e) { auth = null; }
    if (!auth || !auth.u || !auth.t || !auth.s) auth = null;
    function trimUrl(u) { return String(u || "").replace(/^\s+|\s+$/g, "").replace(/\/+$/, ""); }
    /* Servers, tried in order (config.js NAVIDROME_URLS, e.g. the Tailscale https address, then the LAN one;
       a server typed into the setup form that isn't in that list goes first). The first that answers ping.view
       wins and is remembered for the session; if it stops answering, the list is tried again. */
    function configUrls() {
      var out = [];
      each(list(CFG.NAVIDROME_URLS).concat(list(CFG.NAVIDROME_URL)), function (u) { u = trimUrl(u); if (u && out.indexOf(u) === -1) out.push(u); });
      return out;
    }
    function candidates() {
      var out = configUrls(), mine = auth && trimUrl(auth.url);
      if (mine) { var k = out.indexOf(mine); if (k !== -1) out.splice(k, 1); out.unshift(mine); }
      return out;
    }
    var SESSION_KEY = "lmServer", winner = null;
    try { winner = window.sessionStorage.getItem(SESSION_KEY) || null; } catch (e0) { winner = null; }
    if (winner && candidates().indexOf(winner) === -1) winner = null;
    function remember(u) { winner = u; try { if (u) window.sessionStorage.setItem(SESSION_KEY, u); else window.sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }
    function serverUrl() { return winner || candidates()[0] || ""; }
    function signedIn() { return !!auth; }
    function salt() {
      var s = "", i, b = null;
      try { if (window.crypto && window.crypto.getRandomValues) { b = new Uint8Array(8); window.crypto.getRandomValues(b); } } catch (e) { b = null; }
      for (i = 0; i < 8; i++) { var v = b ? b[i] : Math.floor(Math.random() * 256); s += (v < 16 ? "0" : "") + v.toString(16); }
      return s;
    }
    function tokenFor(password, s) { return md5(String(password) + s); }

    /* ---------- Subsonic requests ---------- */
    function qs(params) {
      var out = [];
      for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined && params[k] !== null && params[k] !== "") {
        out.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
      }
      return out.join("&");
    }
    function restUrl(method, params, a, base) {
      a = a || auth || {};
      var p = { u: a.u, t: a.t, s: a.s, v: API_VERSION, c: CLIENT, f: "json" };
      var q = qs(p), extra = qs(params || {});
      return (base || serverUrl()) + "/rest/" + method + ".view?" + q + (extra ? "&" + extra : "");
    }
    // an https page asking an http server: the WebView blocks that as mixed content unless Fully allows it
    function mixedRisk(base) { return window.location.protocol === "https:" && /^http:/i.test(base || serverUrl()); }
    // Fully Kiosk's Mixed Content Mode, when its JavaScript Interface can tell us (Android's
    // MIXED_CONTENT_ALWAYS_ALLOW is 0). null = unknown.
    function fullyMixedAllowed() {
      try {
        var f = typeof fully !== "undefined" ? fully : null; // eslint-disable-line no-undef
        if (f && typeof f.getStringSetting === "function") {
          var v = String(f.getStringSetting("mixedContentMode"));
          if (v === "0") return true;
          if (v === "1" || v === "2") return false;
        }
      } catch (e) { /* ignore */ }
      return null;
    }
    /* Why a request never got an answer (the browser only reports "network error", so this goes by what was
       asked and how fast it failed):
       - mixed: https page -> http server, refused at once without touching the network (Mixed Content Mode off)
       - pna: https page -> http LAN address that did go out but was refused within a moment: Chrome's Private
         Network Access check (its preflight wants Access-Control-Allow-Private-Network, which Navidrome
         doesn't send), or the server refused the connection
       - unreachable: timed out / no route (not on the home Wi-Fi, or not on Tailscale for a ts.net address) */
    function classify(base, elapsed, timedOut, pageProto) {
      pageProto = pageProto || window.location.protocol;
      if (timedOut) return "unreachable";
      if (pageProto === "https:" && /^http:/i.test(base)) {
        var allowed = fullyMixedAllowed();
        if (allowed !== true && elapsed < 30) return "mixed";
        if (elapsed < 3000) return "pna";
      }
      return "unreachable";
    }
    // one request to one server; cb(err, response) once; err.kind: auth | mixed | pna | unreachable | api | bad
    function rawCall(method, params, cb, a, base, timeoutMs) {
      var done = false, started = now(), xhr;
      function finish(err, data) { if (done) return; done = true; if (err && !err.url) err.url = base; cb(err, data); }
      if (!base) { finish({ kind: "nourl" }); return; }
      try {
        xhr = new XMLHttpRequest();
        xhr.open("GET", restUrl(method, params, a, base), true);
        xhr.timeout = timeoutMs || TIMEOUT_MS;
        xhr.onload = function () {
          var data = null;
          try { data = JSON.parse(xhr.responseText); } catch (e) { data = null; }
          var r = data && data["subsonic-response"];
          if (!r) { finish({ kind: xhr.status === 401 || xhr.status === 403 ? "auth" : "bad", status: xhr.status }); return; }
          if (r.status !== "ok") {
            var er = r.error || {}, code = Number(er.code);
            finish({ kind: code === 40 || code === 41 || code === 44 ? "auth" : "api", code: code, message: er.message || "" });
            return;
          }
          finish(null, r);
        };
        xhr.onerror = function () { finish({ kind: classify(base, now() - started, false) }); };
        xhr.ontimeout = function () { finish({ kind: "unreachable" }); };
        xhr.send();
      } catch (e) {
        finish({ kind: mixedRisk(base) ? "mixed" : "unreachable" }); // blocked before it even went out
      }
    }
    function isNet(err) { return !!err && (err.kind === "mixed" || err.kind === "pna" || err.kind === "unreachable" || err.kind === "multi"); }
    // find the first server that answers ping.view (short timeout each); waiters share one search
    var PROBE_MS = 4000, probing = null;
    function findServer(cb, a, urls) {
      if (probing && !urls) { probing.push(cb); return; }
      var waiters = [cb], parts = [], k = 0;
      urls = urls || candidates();
      if (!urls.length) { cb({ kind: "nourl" }); return; }
      probing = waiters;
      function done(err) { if (probing === waiters) probing = null; each(waiters, function (w) { w(err); }); }
      (function tryNext() {
        if (k >= urls.length) { done(parts.length === 1 ? parts[0] : { kind: "multi", parts: parts }); return; }
        var u = urls[k++];
        rawCall("ping", {}, function (err) {
          if (!err) { remember(u); done(null); return; }
          if (!isNet(err)) { remember(u); done(err); return; } // it answered (e.g. wrong login): that's the server
          parts.push(err);
          tryNext();
        }, a, u, PROBE_MS);
      })();
    }
    function call(method, params, cb, a) {
      function go(again) {
        if (!winner) { findServer(function (err) { if (err) cb(err); else go(true); }, a); return; }
        rawCall(method, params, function (err, r) {
          // the remembered server stopped answering (e.g. Tailscale went off): look again once
          if (isNet(err) && !again) { remember(null); go(true); return; }
          cb(err, r);
        }, a, winner);
      }
      go(false);
    }
    var MIXED_TEXT = "The tablet blocked the connection to the music server (an http address on an https page). " +
      "In Fully Kiosk turn on Settings > Advanced Web Settings > Mixed Content Mode: Always Allow Mixed Content.";
    function host(u) { return String(u || "").replace(/^https?:\/\//i, ""); }
    function partText(err) {
      if (err.kind === "mixed") return host(err.url) + ": blocked as mixed content (http on an https page). In Fully Kiosk turn on Settings > Advanced Web Settings > Mixed Content Mode: Always Allow Mixed Content.";
      if (err.kind === "pna") return host(err.url) + ": the tablet's browser refused the local-network request (Private Network Access), or the server is off. Use the Tailscale address instead.";
      if (/\.ts\.net$/i.test(host(err.url).split(":")[0])) return host(err.url) + ": not reachable. Is the Tailscale app on and connected?";
      return host(err.url) + ": not reachable. It only works on the home Wi-Fi.";
    }
    function errorText(err) {
      if (!err) return "";
      if (err.kind === "multi") return "Can't reach the music server. " + err.parts.map(partText).join(" ");
      if (err.kind === "pna" || (err.url && (err.kind === "mixed" || err.kind === "unreachable") && configUrls().length > 1)) return partText(err);
      if (err.kind === "auth") return err.code === 41 ? "This server doesn't accept token sign-in for that user." : "Wrong username or password.";
      if (err.kind === "mixed") return MIXED_TEXT + " If it's already on, check the tablet is on the home Wi-Fi.";
      if (err.kind === "unreachable") return "Can't reach the music server. Local Music only works on the home Wi-Fi.";
      if (err.kind === "nourl") return "Enter the music server's address.";
      if (err.kind === "api") return "The music server said: " + (err.message || ("error " + err.code));
      return "The music server sent something unexpected.";
    }
    function coverUrl(id, size) { return id ? restUrl("getCoverArt", { id: id, size: size || 300 }) : ""; }
    function streamUrl(song, raw) {
      return raw ? restUrl("stream", { id: song.id, format: "raw" }) : restUrl("stream", { id: song.id, maxBitRate: MAX_BITRATE, format: "mp3" });
    }

    /* ---------- items ---------- */
    function songItem(x) {
      return { kind: "song", id: x.id, name: x.title || x.name || "", artist: x.artist || "", album: x.album || "", albumId: x.albumId,
        cover: x.coverArt || x.albumId || "", dur: (Number(x.duration) || 0) * 1000, track: x.track };
    }
    function albumItem(x) {
      return { kind: "album", id: x.id, name: x.name || x.title || x.album || "", sub: [x.artist, x.year].filter(Boolean).join(" · "), artist: x.artist || "", cover: x.coverArt || x.id };
    }
    function artistItem(x) { return { kind: "artist", id: x.id, name: x.name || "", sub: x.albumCount ? x.albumCount + (x.albumCount === 1 ? " album" : " albums") : "Artist", cover: x.coverArt || "" }; }
    function playlistItem(x) { return { kind: "playlist", id: x.id, name: x.name || "", sub: (x.songCount || 0) + " songs" + (x.owner ? " · " + x.owner : ""), cover: x.coverArt || "" }; }

    /* ---------- player state ---------- */
    var audio = null, queue = [], order = [], pos = -1, shuffle = false, repeat = "off";
    var triedRaw = false, scrobbled = false, startedAt = 0, playingNow = false, failedInRow = 0;
    // A transcoded stream often can't seek (no byte ranges): then the stream is reopened with timeOffset and
    // seekBase is where that new stream starts in the song.
    var seekBase = 0, rawNow = false;
    function songDur() { var x = current(); if (!x) return 0; if (x.dur > 0) return x.dur / 1000; return audio && isFinite(audio.duration) ? audio.duration + seekBase : 0; }
    function songPos() { return audio ? seekBase + (audio.currentTime || 0) : 0; }
    function current() { return pos >= 0 && pos < order.length ? queue[order[pos]] : null; }
    function ensureAudio() {
      if (audio) return audio;
      audio = document.createElement("audio");
      audio.id = "lm-audio";
      audio.preload = "auto";
      audio.style.display = "none";
      document.body.appendChild(audio);
      audio.addEventListener("playing", function () { playingNow = true; failedInRow = 0; setMessage(""); paint(); });
      audio.addEventListener("play", function () { playingNow = true; paint(); });
      audio.addEventListener("pause", function () { playingNow = false; paint(); });
      audio.addEventListener("timeupdate", onTime);
      audio.addEventListener("loadedmetadata", paintProgress);
      audio.addEventListener("ended", function () { playingNow = false; next(true); });
      audio.addEventListener("error", onAudioError);
      setVolume(bridge.volume());
      return audio;
    }
    function onAudioError() {
      var s = current();
      if (!s || !audio.getAttribute("src")) return;
      if (!triedRaw) { triedRaw = true; load(s, true, seekBase); return; } // the transcoded stream failed: try the original file
      playingNow = false;
      if (mixedRisk()) { setMessage(MIXED_TEXT, true); paint(); return; }
      // skip a song that won't play (but don't spin through a whole broken queue: stop after 2 in a row)
      failedInRow++;
      if (failedInRow >= 2) { setMessage("Couldn't play “" + s.name + "”.", true); paint(); return; }
      setMessage("Couldn't play “" + s.name + "”, skipping it.", true);
      if (!advance(false)) paint();
    }
    function load(s, raw, offset) {
      ensureAudio();
      rawNow = !!raw; seekBase = offset || 0;
      var url = streamUrl(s, raw);
      if (offset) url += "&timeOffset=" + Math.floor(offset);
      audio.setAttribute("src", url);
      try { audio.load(); } catch (e) { /* old WebViews */ }
      var p = null;
      try { p = audio.play(); } catch (e2) { p = null; }
      if (p && p["catch"]) p["catch"](function (e) {
        if (e && e.name === "NotAllowedError") { setMessage("Tap Play to start.", true); playingNow = false; paint(); }
      });
    }
    function start() {
      var s = current();
      if (!s) return;
      bridge.stopOthers(); // Spotify / YouTube stop when Local Music starts
      triedRaw = false; scrobbled = false; startedAt = now();
      setMessage("");
      load(s, false);
      call("scrobble", { id: s.id, submission: "false" }, function () {});
      mediaSession(s);
      paint();
      markPlaying();
    }
    function onTime() {
      var s = current();
      if (!s || !audio) return;
      var dur = songDur();
      if (!scrobbled && dur > 0 && songPos() >= dur / 2) {
        scrobbled = true;
        call("scrobble", { id: s.id, submission: "true", time: startedAt }, function () {});
      }
      paintProgress();
    }
    function shuffled(n, first) {
      var a = [], i, j, t;
      for (i = 0; i < n; i++) if (i !== first) a.push(i);
      for (i = a.length - 1; i > 0; i--) { j = Math.floor(Math.random() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; }
      if (first >= 0) a.unshift(first);
      return a;
    }
    function identity(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }
    // play a list of songs from index i (shuffle: i first if given, then the rest in random order)
    function playList(songs, i, shuf) {
      songs = songs || [];
      if (!songs.length) { setMessage("Nothing to play here.", true); return; }
      queue = songs.slice(0, 2000);
      shuffle = !!shuf;
      if (shuffle) { order = shuffled(queue.length, i >= 0 ? i : Math.floor(Math.random() * queue.length)); pos = 0; }
      else { order = identity(queue.length); pos = Math.max(0, Math.min(queue.length - 1, i || 0)); }
      failedInRow = 0;
      start();
    }
    function advance(fromEnd) {
      if (!order.length) return false;
      if (fromEnd && repeat === "one") { start(); return true; }
      if (pos + 1 < order.length) { pos++; start(); return true; }
      if (repeat === "all") { if (shuffle) order = shuffled(queue.length, -1); pos = 0; start(); return true; }
      return false;
    }
    function next(fromEnd) {
      if (!advance(!!fromEnd)) { // end of the queue
        if (audio) { try { audio.pause(); } catch (e) { /* ignore */ } }
        playingNow = false;
        if (fromEnd && audio && seekBase === 0) audio.currentTime = 0;
        paint();
      }
    }
    function prev() {
      if (!order.length) return;
      if (audio && songPos() > 3) { if (seekBase) load(current(), rawNow, 0); else audio.currentTime = 0; return; }
      if (pos > 0) pos--; else if (repeat === "all") pos = order.length - 1;
      start();
    }
    function toggle() {
      if (!current()) return;
      ensureAudio();
      if (!audio.getAttribute("src")) { start(); return; }
      if (audio.paused) {
        bridge.stopOthers();
        var p = null; try { p = audio.play(); } catch (e) { p = null; }
        if (p && p["catch"]) p["catch"](function () { /* error event handles it */ });
      } else audio.pause();
    }
    function pause() { if (audio && !audio.paused) { try { audio.pause(); } catch (e) { /* ignore */ } } }
    function setShuffle(on) {
      var cur = pos >= 0 ? order[pos] : -1;
      shuffle = !!on;
      if (queue.length) {
        if (shuffle) { order = shuffled(queue.length, cur); pos = cur >= 0 ? 0 : -1; }
        else { order = identity(queue.length); pos = cur; }
      }
      paint();
    }
    function cycleRepeat() { repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off"; paint(); }
    function seekTo(frac) {
      if (!audio || !current()) return;
      var dur = songDur();
      if (!(dur > 0)) return;
      var target = Math.max(0, Math.min(dur - 0.5, frac * dur)), local = target - seekBase, ok = false, r = audio.seekable, i;
      for (i = 0; r && i < r.length; i++) if (local >= 0 && r.start(i) <= local && local <= r.end(i)) ok = true;
      if (ok) audio.currentTime = local;
      else load(current(), rawNow, target); // the stream can't seek there: reopen it from that point
      paintProgress();
    }
    function setVolume(v) { if (audio) { audio.volume = Math.max(0, Math.min(1, (Number(v) || 0) / 100)); audio.muted = false; } }

    function mediaSession(s) {
      var ms = navigator.mediaSession;
      if (!ms) return;
      try {
        if (window.MediaMetadata) ms.metadata = new window.MediaMetadata({ title: s.name, artist: s.artist, album: s.album,
          artwork: s.cover ? [{ src: coverUrl(s.cover, 512), sizes: "512x512" }] : [] });
        var h = { play: toggle, pause: pause, previoustrack: prev, nexttrack: function () { next(false); } };
        for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) { try { ms.setActionHandler(k, h[k]); } catch (e) { /* unsupported action */ } }
      } catch (e2) { /* ignore */ }
    }

    /* ---------- player UI (same look as the Spotify mini player / full screen) ---------- */
    var msgSticky = false;
    function setMessage(t, sticky) { msgSticky = !!(t && sticky); setText("lm-message", t || ""); toggleClass($("lm-message"), "sticky", msgSticky); }
    function paintProgress() {
      var s = current();
      var dur = s ? songDur() * 1000 : 0;
      var p = s ? songPos() * 1000 : 0;
      var bar = $("lm-progress-bar");
      if (bar) bar.style.width = (dur ? Math.min(100, p / dur * 100) : 0).toFixed(2) + "%";
      setText("lm-pos", fmt(p)); setText("lm-dur", fmt(dur));
      if (bridge.onProgress) bridge.onProgress();
    }
    function paint() {
      var s = current();
      setText("lm-title", s ? s.name : "Not Playing");
      setText("lm-sub", s ? [s.artist, s.album].filter(Boolean).join(" · ") : "Pick something above to play");
      toggleClass($("lm-play"), "paused", playingNow);
      var art = $("lm-art"), src = s && s.cover ? coverUrl(s.cover, 600) : "";
      if (art) {
        if (src) { if (art.getAttribute("src") !== src) art.setAttribute("src", src); art.style.display = "block"; }
        else { art.removeAttribute("src"); art.style.display = "none"; }
        toggleClass(art.parentNode, "has-art", !!src);
      }
      var sb = $("lm-shuffle");
      toggleClass(sb, "on", shuffle);
      if (sb) { sb.setAttribute("aria-pressed", shuffle ? "true" : "false"); sb.setAttribute("aria-label", "Shuffle: " + (shuffle ? "on" : "off")); }
      setText("lm-repeat-state", repeat === "off" ? "Off" : repeat === "all" ? "All" : "One");
      toggleClass($("lm-repeat"), "on", repeat !== "off");
      if ($("lm-repeat")) $("lm-repeat").setAttribute("aria-label", "Repeat: " + repeat);
      try { if (navigator.mediaSession) navigator.mediaSession.playbackState = s ? (playingNow ? "playing" : "paused") : "none"; } catch (e) { /* ignore */ }
      paintProgress();
      markPlaying();
      if (sheet === "queue") paintQueue();
      bridge.onChange();
    }
    function setFull(on) {
      toggleClass(document.body, "lm-full", !!on);
      if ($("lm-full-btn")) $("lm-full-btn").setAttribute("aria-pressed", on ? "true" : "false");
      bridge.paintVolume();
    }

    /* ---------- browse ---------- */
    var tab = "albums", albumType = store.get("lmAlbumType") || "newest", view = null, stack = [], seq = 0, searchTimer = null;
    var ALBUM_TYPES = [["newest", "Newest"], ["recent", "Recently played"], ["random", "Random"], ["alphabeticalByName", "A–Z"]];
    function body() { return $("lm-body"); }
    function cover(o, round) {
      var c = el("div", "spb-cover" + (round ? " round" : ""));
      if (o.cover) {
        var img = document.createElement("img");
        img.alt = ""; img.setAttribute("loading", "lazy");
        img.src = coverUrl(o.cover, round ? 160 : 300);
        img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
        c.appendChild(img);
      }
      c.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24"><path d="M9 17.5V5.5l11-2v12"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="15.5" r="2.5"/></svg>');
      return c;
    }
    function card(o) {
      var b = el("button", "spb-card");
      b.setAttribute("data-id", o.id || "");
      b.appendChild(cover(o, o.kind === "artist"));
      b.appendChild(el("div", "spb-name", o.name));
      b.appendChild(el("div", "spb-sub", o.sub || ""));
      b.addEventListener("click", function () { openItem(o); });
      return b;
    }
    function row(o, i, onTap, showCover) {
      var b = el("button", "spb-row");
      b.setAttribute("data-id", o.id || "");
      b.setAttribute("data-index", String(i));
      if (o.kind !== "song" || showCover) b.appendChild(cover(o, o.kind === "artist")); else b.appendChild(el("div", "spb-num", String(o.track || i + 1)));
      var t = el("div", "spb-row-text");
      t.appendChild(el("div", "spb-name", o.name));
      t.appendChild(el("div", "spb-sub", o.kind === "song" ? [o.artist, showCover ? o.album : ""].filter(Boolean).join(" · ") : (o.sub || "")));
      b.appendChild(t);
      b.appendChild(el("div", "spb-dur", o.dur ? fmt(o.dur) : ""));
      b.addEventListener("click", function () { onTap(o, i); });
      return b;
    }
    function markPlaying() {
      var s = current(), b = body();
      if (!b) return;
      each(b.querySelectorAll(".spb-row"), function (r) { toggleClass(r, "playing", !!s && r.getAttribute("data-id") === s.id); });
    }
    function msgBox(text, sub, retry) {
      var box = el("div", "spb-empty");
      box.appendChild(el("div", "spb-empty-title", text));
      if (sub) box.appendChild(el("div", "spb-empty-sub", sub));
      if (retry) { var r = el("button", "pill-btn ghost spb-retry", "Try again"); r.addEventListener("click", retry); box.appendChild(r); }
      return box;
    }
    function errBox(err, retry) {
      if (err.kind === "auth") { showSetup(errorText(err) + " Sign in again."); return el("div"); }
      return msgBox(err.kind === "unreachable" || err.kind === "multi" ? "Can't reach the music server" : err.kind === "mixed" || err.kind === "pna" ? "Connection blocked" : "Something went wrong", errorText(err), retry);
    }

    function paintHead() {
      var head = $("lm-head");
      if (!head) return;
      head.innerHTML = "";
      if (!view || !view.title) { head.style.display = "none"; return; }
      head.style.display = "";
      if (stack.length) {
        var back = el("button", "spb-back");
        back.setAttribute("aria-label", "Back");
        back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14.5 5.5 8 12l6.5 6.5"/></svg>';
        back.addEventListener("click", goBack);
        head.appendChild(back);
      }
      if (view.cover !== undefined) head.appendChild(cover({ cover: view.cover }, view.round));
      var t = el("div", "spb-head-text");
      t.appendChild(el("div", "spb-head-title", view.title));
      if (view.sub) t.appendChild(el("div", "spb-sub", view.sub));
      head.appendChild(t);
      if (view.playAll) {
        var v = view;
        var p = el("button", "spb-play");
        p.id = "lm-play-all";
        p.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z"/></svg><span>Play</span>';
        p.addEventListener("click", function () { v.playAll(false); });
        head.appendChild(p);
        var sh = el("button", "spb-shuffle");
        sh.id = "lm-shuffle-all";
        sh.setAttribute("aria-label", "Shuffle play");
        sh.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3.5 7h3.2c1.6 0 3 .8 3.9 2.1l3.8 5.8c.9 1.3 2.3 2.1 3.9 2.1h2.2M3.5 17h3.2c1.6 0 3-.8 3.9-2.1M14.4 9.1c.9-1.3 2.3-2.1 3.9-2.1h2.2M18 4.5 20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5"/></svg>';
        sh.addEventListener("click", function () { v.playAll(true); });
        head.appendChild(sh);
      }
    }
    function chips() {
      var box = el("div", "lm-chips");
      each(ALBUM_TYPES, function (t) {
        var b = el("button", "lm-chip" + (t[0] === albumType ? " active" : ""), t[1]);
        b.setAttribute("data-type", t[0]);
        b.addEventListener("click", function () { albumType = t[0]; store.set("lmAlbumType", albumType); setTab("albums"); });
        box.appendChild(b);
      });
      return box;
    }
    function itemNode(o, i) { return view.layout === "grid" ? card(o) : row(o, i, view.tap || function (x) { openItem(x); }, view.covers); }
    function paint2() {
      var b = body();
      if (!b || !view) return;
      paintHead();
      b.innerHTML = "";
      b.className = "spb-body " + (view.layout === "grid" ? "is-grid" : view.layout === "search" ? "is-search" : "is-rows");
      b.scrollTop = 0;
      if (view.chips) b.appendChild(chips());
      if (view.error) { b.appendChild(view.error); return; }
      if (view.layout === "search") { paintSearch(); return; }
      if (!view.items.length) { b.appendChild(view.loading ? el("div", "spb-loading", "Loading…") : msgBox(view.empty || "Nothing here.")); return; }
      view.shown = 0;
      showMore();
    }
    // add the next chunk of already-loaded items (long lists like Artists render bit by bit)
    function showMore() {
      var b = body(), frag = document.createDocumentFragment(), end = Math.min(view.items.length, view.shown + CHUNK);
      var spin = b.querySelector(".spb-loading");
      if (spin) b.removeChild(spin);
      for (var i = view.shown; i < end; i++) frag.appendChild(itemNode(view.items[i], i));
      view.shown = end;
      b.appendChild(frag);
      if (view.loading) b.appendChild(el("div", "spb-loading", "Loading…"));
      markPlaying();
    }
    function onScroll() {
      var b = body();
      if (!b || !view || view.layout === "search") return;
      if (b.scrollTop + b.clientHeight < b.scrollHeight - 400) return;
      if (view.shown < view.items.length) { showMore(); return; }
      if (view.more && !view.loading && !view.done) view.more();
    }
    function setView(v, push) {
      if (push && view) stack.push(view); else if (!push) stack = [];
      view = v;
      seq++;
      paint2();
    }
    function goBack() { if (!stack.length) return; view = stack.pop(); seq++; paint2(); }
    function paged(method, params, key, mapper) {
      // returns a loader for views that page with size/offset (getAlbumList2)
      return function load() {
        var v = view, my = seq;
        v.loading = true;
        if (v.items.length) { var b = body(); if (b && !b.querySelector(".spb-loading")) b.appendChild(el("div", "spb-loading", "Loading…")); }
        else paint2();
        var p = {}; for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) p[k] = params[k];
        p.size = PAGE; p.offset = v.items.length;
        call(method, p, function (err, r) {
          if (my !== seq || v !== view) return;
          v.loading = false;
          if (err) { v.error = errBox(err, function () { v.error = null; load(); }); paint2(); return; }
          var got = list(key(r)).map(mapper);
          if (got.length < PAGE) v.done = true;
          var first = !v.items.length;
          each(got, function (o) { v.items.push(o); });
          if (first) paint2(); else showMore();
        });
      };
    }
    function setTab(t) {
      tab = t;
      each($("lm-tabs") ? $("lm-tabs").querySelectorAll(".spb-tab") : [], function (b) {
        var on = b.getAttribute("data-tab") === t;
        toggleClass(b, "active", on); b.setAttribute("aria-selected", on ? "true" : "false");
      });
      if ($("lm-search")) $("lm-search").value = "";
      var v = { kind: "tab", items: [], layout: "grid", loading: true };
      if (t === "albums") {
        v.chips = true;
        v.more = paged("getAlbumList2", { type: albumType }, function (r) { return r.albumList2 && r.albumList2.album; }, albumItem);
        v.empty = "No albums found.";
        setView(v, false);
        v.more();
        return;
      }
      setView(v, false);
      var my = seq;
      if (t === "artists") {
        v.layout = "rows";
        call("getArtists", {}, function (err, r) {
          if (my !== seq) return;
          v.loading = false;
          if (err) { v.error = errBox(err, function () { setTab("artists"); }); paint2(); return; }
          each(list(r.artists && r.artists.index), function (ix) { each(list(ix.artist), function (a) { v.items.push(artistItem(a)); }); });
          v.empty = "No artists found.";
          paint2();
        });
      } else {
        call("getPlaylists", {}, function (err, r) {
          if (my !== seq) return;
          v.loading = false;
          if (err) { v.error = errBox(err, function () { setTab("playlists"); }); paint2(); return; }
          each(list(r.playlists && r.playlists.playlist), function (p) { v.items.push(playlistItem(p)); });
          v.empty = "No playlists yet.";
          paint2();
        });
      }
    }
    function songsView(title, sub, coverId, songs) {
      var v = { kind: "detail", title: title, sub: sub, cover: coverId || "", items: songs, layout: "rows" };
      v.tap = function (o, i) { playList(v.items, i, false); };
      v.playAll = function (shuf) { playList(v.items, shuf ? -1 : 0, shuf); };
      return v;
    }
    function openItem(o) {
      if (o.kind === "song") { playList([o], 0, false); return; }
      var v = { kind: "detail", title: o.name, sub: o.sub, cover: o.cover || "", round: o.kind === "artist", items: [], layout: o.kind === "artist" ? "grid" : "rows", loading: true };
      setView(v, true);
      var my = seq;
      function failed(err) { if (my !== seq) return; v.loading = false; v.error = errBox(err, function () { goBack(); openItem(o); }); paint2(); }
      if (o.kind === "album") {
        call("getAlbum", { id: o.id }, function (err, r) {
          if (my !== seq) return;
          if (err) { failed(err); return; }
          var a = r.album || {};
          var nv = songsView(a.name || o.name, [a.artist, a.year, a.songCount ? a.songCount + " songs" : ""].filter(Boolean).join(" · "), a.coverArt || o.cover, list(a.song).map(songItem));
          view = nv; paint2();
        });
      } else if (o.kind === "playlist") {
        call("getPlaylist", { id: o.id }, function (err, r) {
          if (my !== seq) return;
          if (err) { failed(err); return; }
          var p = r.playlist || {};
          var nv = songsView(p.name || o.name, (p.songCount || list(p.entry).length) + " songs", p.coverArt || o.cover, list(p.entry).map(songItem));
          nv.covers = true;
          view = nv; paint2();
        });
      } else if (o.kind === "artist") {
        call("getArtist", { id: o.id }, function (err, r) {
          if (my !== seq) return;
          if (err) { failed(err); return; }
          var a = r.artist || {};
          v.loading = false;
          v.items = list(a.album).map(albumItem);
          v.sub = v.items.length + (v.items.length === 1 ? " album" : " albums");
          v.playAll = function (shuf) { artistSongs(v.items, function (songs) { playList(songs, shuf ? -1 : 0, shuf); }); };
          paint2();
        });
      }
    }
    // all songs of an artist: the albums' tracks, in order (at most 30 albums)
    function artistSongs(albums, cb) {
      var ids = albums.slice(0, 30), out = [], left = ids.length, failed = null;
      if (!left) { cb([]); return; }
      setMessage("Loading the artist's songs…");
      each(ids, function (al, k) {
        call("getAlbum", { id: al.id }, function (err, r) {
          if (err) failed = err; else out[k] = list(r.album && r.album.song).map(songItem);
          if (--left) return;
          var all = [];
          each(out, function (x) { each(x || [], function (s) { all.push(s); }); });
          setMessage("");
          if (!all.length && failed) { setMessage(errorText(failed), true); return; }
          cb(all);
        });
      });
    }

    /* ---------- search (search3, debounced) ---------- */
    function search(q) {
      q = String(q || "").replace(/^\s+|\s+$/g, "");
      if (q.length < 2) { if (view && view.kind === "search") setTab(tab); return; }
      var v = { kind: "search", q: q, layout: "search", loading: true, items: [] };
      setView(v, false);
      var my = seq;
      call("search3", { query: q, artistCount: 8, albumCount: 16, songCount: 40 }, function (err, r) {
        if (my !== seq) return;
        v.loading = false;
        if (err) { v.error = errBox(err, function () { search(q); }); paint2(); return; }
        var sr = r.searchResult3 || {};
        v.songs = list(sr.song).map(songItem); v.albums = list(sr.album).map(albumItem); v.artists = list(sr.artist).map(artistItem);
        paint2();
      });
    }
    function paintSearch() {
      var b = body();
      if (view.loading) { b.appendChild(el("div", "spb-loading", "Searching…")); return; }
      if (!view.songs.length && !view.albums.length && !view.artists.length) { b.appendChild(msgBox("No results for “" + view.q + "”")); return; }
      function section(label, items, kind) {
        if (!items.length) return;
        var box = el("div", "spb-section");
        box.setAttribute("data-type", kind);
        box.appendChild(el("div", "spb-section-title", label));
        var l = el("div", kind === "song" ? "spb-rows" : "spb-shelf");
        each(items, function (o, i) { l.appendChild(kind === "song" ? row(o, i, function (x, k) { playList(view.songs, k, false); }, true) : card(o)); });
        box.appendChild(l);
        b.appendChild(box);
      }
      section("Songs", view.songs, "song");
      section("Albums", view.albums, "album");
      section("Artists", view.artists, "artist");
      markPlaying();
    }

    /* ---------- sheets: Up next, account ---------- */
    var sheet = null;
    function openSheet(kind) {
      sheet = kind;
      var s = $("lm-sheet");
      if (!s) return;
      s.style.display = "";
      toggleClass($("lm-queue-btn"), "active", kind === "queue");
      toggleClass($("lm-account-btn"), "active", kind === "account");
      if (kind === "queue") paintQueue(); else paintAccount();
    }
    function closeSheet() {
      sheet = null;
      if ($("lm-sheet")) $("lm-sheet").style.display = "none";
      toggleClass($("lm-queue-btn"), "active", false);
      toggleClass($("lm-account-btn"), "active", false);
    }
    function paintQueue() {
      setText("lm-sheet-title", "Up next");
      var b = $("lm-sheet-body");
      if (!b) return;
      b.innerHTML = "";
      var s = current();
      if (!s) { b.appendChild(msgBox("Nothing queued", "Tap a song to start playing.")); return; }
      b.appendChild(el("div", "spb-section-title", "Now playing"));
      b.appendChild(row(s, pos, function () {}, true));
      var rest = order.slice(pos + 1, pos + 101);
      b.appendChild(el("div", "spb-section-title", rest.length ? "Next" : "That's the last song"));
      each(rest, function (qi, k) {
        b.appendChild(row(queue[qi], pos + 1 + k, function () { pos = pos + 1 + k; start(); }, true));
      });
      each(b.querySelectorAll(".spb-row"), function (r, k) { toggleClass(r, "playing", k === 0); });
    }
    function paintAccount() {
      setText("lm-sheet-title", "Local Music");
      var b = $("lm-sheet-body");
      if (!b) return;
      b.innerHTML = "";
      var box = el("div", "lm-account");
      box.appendChild(el("div", "spb-sub", "Server"));
      box.appendChild(el("div", "spb-name", serverUrl()));
      box.appendChild(el("div", "spb-sub", "Signed in as"));
      box.appendChild(el("div", "spb-name", auth ? auth.u : ""));
      var out = el("button", "pill-btn ghost lm-signout", "Sign out");
      out.id = "lm-signout";
      out.addEventListener("click", signOut);
      box.appendChild(out);
      box.appendChild(el("div", "spb-empty-sub", "Signing out removes the saved sign-in token from this tablet."));
      b.appendChild(box);
    }

    /* ---------- setup form ---------- */
    function showSetup(message) {
      var on = !signedIn() || !!message;
      if ($("lm-setup")) $("lm-setup").style.display = on ? "" : "none";
      if ($("lm-browse")) $("lm-browse").style.display = on ? "none" : "";
      if ($("lm-player")) $("lm-player").style.display = on ? "none" : "";
      toggleClass($("local-panel"), "sp-connected", !on);
      if (on) {
        closeSheet();
        if (document.body.classList.contains("lm-full")) setFull(false);
        if ($("lm-url") && !$("lm-url").value) $("lm-url").value = serverUrl();
        if ($("lm-user") && !$("lm-user").value && auth) $("lm-user").value = auth.u;
        setupMsg(message || "", !!message);
      }
    }
    function setupMsg(t, bad) { setText("lm-setup-msg", t || ""); toggleClass($("lm-setup-msg"), "bad", !!bad); }
    function signIn() {
      var url = trimUrl($("lm-url") && $("lm-url").value), user = String(($("lm-user") && $("lm-user").value) || "").replace(/^\s+|\s+$/g, "");
      var pass = ($("lm-pass") && $("lm-pass").value) || "";
      if (!url) { setupMsg("Enter the music server's address.", true); return; }
      if (!/^https?:\/\//i.test(url)) url = "http://" + url;
      if (!user || !pass) { setupMsg("Enter your username and password.", true); return; }
      var s = salt(), a = { u: user, t: tokenFor(pass, s), s: s };
      if (configUrls().indexOf(url) === -1) a.url = url; // a server that isn't in config.js: remember it (tried first)
      var urls = [url];
      each(configUrls(), function (u) { if (urls.indexOf(u) === -1) urls.push(u); });
      if ($("lm-pass")) $("lm-pass").value = ""; // the password isn't kept anywhere, not even in the form
      pass = "";
      setupMsg("Signing in…");
      if ($("lm-signin")) $("lm-signin").disabled = true;
      remember(null);
      findServer(function (err) {
        if ($("lm-signin")) $("lm-signin").disabled = false;
        if (err) { setupMsg(errorText(err), true); return; }
        auth = a;
        store.set(AUTH_KEY, JSON.stringify(a));
        if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
        showSetup("");
        setTab("albums");
      }, a, urls);
    }
    function signOut() {
      pause();
      if (audio) { audio.removeAttribute("src"); try { audio.load(); } catch (e) { /* ignore */ } }
      queue = []; order = []; pos = -1; playingNow = false;
      auth = null; remember(null);
      try { window.localStorage.removeItem(AUTH_KEY); } catch (e2) { /* ignore */ }
      closeSheet();
      if ($("lm-user")) $("lm-user").value = "";
      if ($("lm-url")) $("lm-url").value = serverUrl();
      showSetup("");
      setupMsg("Signed out. The sign-in token was removed from this tablet.");
      paint();
    }

    /* ---------- wiring ---------- */
    function init() {
      each($("lm-tabs") ? $("lm-tabs").querySelectorAll(".spb-tab") : [], function (b) {
        b.addEventListener("click", function () { closeSheet(); setTab(b.getAttribute("data-tab")); });
      });
      var si = $("lm-search");
      if (si) {
        si.addEventListener("input", function () { clearTimeout(searchTimer); var q = si.value; searchTimer = setTimeout(function () { search(q); }, 400); });
        si.addEventListener("keydown", function (e) { if (e.keyCode === 13) { if (e.preventDefault) e.preventDefault(); clearTimeout(searchTimer); search(si.value); si.blur(); } });
      }
      if ($("lm-search-form")) $("lm-search-form").addEventListener("submit", function (e) { if (e.preventDefault) e.preventDefault(); });
      if (body()) body().addEventListener("scroll", onScroll);
      if ($("lm-queue-btn")) $("lm-queue-btn").addEventListener("click", function () { if (sheet === "queue") closeSheet(); else openSheet("queue"); });
      if ($("lm-account-btn")) $("lm-account-btn").addEventListener("click", function () { if (sheet === "account") closeSheet(); else openSheet("account"); });
      if ($("lm-sheet-close")) $("lm-sheet-close").addEventListener("click", closeSheet);
      if ($("lm-form")) $("lm-form").addEventListener("submit", function (e) { if (e.preventDefault) e.preventDefault(); signIn(); });
      if ($("lm-signin")) $("lm-signin").addEventListener("click", function (e) { if (e.preventDefault) e.preventDefault(); signIn(); });
      if ($("lm-play")) $("lm-play").addEventListener("click", toggle);
      if ($("lm-prev")) $("lm-prev").addEventListener("click", prev);
      if ($("lm-next")) $("lm-next").addEventListener("click", function () { next(false); });
      if ($("lm-shuffle")) $("lm-shuffle").addEventListener("click", function () { setShuffle(!shuffle); });
      if ($("lm-repeat")) $("lm-repeat").addEventListener("click", cycleRepeat);
      if ($("lm-message")) $("lm-message").addEventListener("click", function () { setMessage(""); });
      if ($("lm-full-btn")) $("lm-full-btn").addEventListener("click", function () { setFull(!document.body.classList.contains("lm-full")); });
      if ($("lm-full-close")) $("lm-full-close").addEventListener("click", function () { setFull(false); });
      if ($("lm-art")) $("lm-art").addEventListener("error", function () { toggleClass(this.parentNode, "has-art", false); this.style.display = "none"; });
      if ($("lm-player")) $("lm-player").addEventListener("click", function (e) {
        var t = e.target, full = document.body.classList.contains("lm-full"), onArt = false, onInfo = false;
        while (t && t !== this) { if (t.classList && t.classList.contains("album-art")) onArt = true; if (t.classList && t.classList.contains("now-playing")) onInfo = true; t = t.parentNode; }
        if (!current()) return;
        if (full && onArt) setFull(false); else if (!full && (onArt || onInfo)) setFull(true);
      });
      if ($("lm-progress-wrap")) $("lm-progress-wrap").addEventListener("click", function (e) {
        var bar = this.querySelector(".sp-progress");
        if (!document.body.classList.contains("lm-full") || !bar) return;
        var r = bar.getBoundingClientRect();
        if (r.width) seekTo((e.clientX - r.left) / r.width);
      });
      document.addEventListener("keydown", function (e) { if ((e.keyCode === 27 || e.key === "Escape") && document.body.classList.contains("lm-full")) setFull(false); });
      showSetup("");
      if (signedIn()) setTab("albums");
      paint();
    }

    return {
      init: init,
      signedIn: signedIn,
      onShow: function () { if (signedIn() && view && view.error && view.kind === "tab") setTab(tab); },
      hasTrack: function () { return !!current(); },
      isPlaying: function () { return playingNow; },
      toggle: toggle, next: function () { next(false); }, prev: prev, pause: pause, setVolume: setVolume, setFull: setFull,
      info: function () {
        var s = current();
        if (!s) return null;
        return { title: s.name, artist: s.artist, album: s.album, art: s.cover ? coverUrl(s.cover, 300) : "", playing: playingNow, pos: songPos() * 1000, dur: songDur() * 1000 };
      },
      // for tests / the console
      _md5: md5, _state: function () { return { queue: queue.map(function (s) { return s.id; }), order: order.slice(), pos: pos, shuffle: shuffle, repeat: repeat, tab: tab, view: view && view.kind, sheet: sheet }; },
      _playList: playList, _search: search, _errorText: errorText, _classify: classify, _server: function () { return winner; }
    };
  };
})();
