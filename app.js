/*
 * Home Dashboard - app logic.
 * Written in plain ES5 (no arrow functions, let/const, template strings,
 * async/await, optional chaining, fetch) so it runs on old Android
 * Chrome / Samsung Internet / WebView builds.
 */
(function () {
  "use strict";

  var CFG = (typeof CONFIG !== "undefined" && CONFIG) ? CONFIG : {};
  var SLIDE_MS = Number(CFG.SLIDESHOW_INTERVAL) > 1000 ? Number(CFG.SLIDESHOW_INTERVAL) : 8000;
  var HAS_CONFIG = typeof CONFIG !== "undefined" && !!CONFIG;
  // "drive" (default) = public Google Drive folder; "local" = photos/ folder next to index.html
  var PHOTO_SOURCE = String(CFG.PHOTO_SOURCE || "drive").toLowerCase() === "local" ? "local" : "drive";
  var IS_FILE = window.location.protocol === "file:";
  // Data comes from our own Netlify Functions (they hold the API keys), never straight from the APIs.
  var API_BASE = String(CFG.API_BASE || "/api/");
  if (API_BASE.charAt(API_BASE.length - 1) !== "/") API_BASE += "/";
  function apiUrl(path) { return API_BASE + path; }

  /* ===== HELPERS ===== */
  function $(id) { return document.getElementById(id); }

  // Only touch the DOM when the text actually changes (avoids needless repaints).
  function setText(id, text) {
    var el = $(id);
    text = (text === undefined || text === null) ? "" : String(text);
    if (el && el.textContent !== text) el.textContent = text;
  }

  function each(list, fn) { Array.prototype.forEach.call(list || [], fn); }

  function toggleClass(el, cls, on) {
    if (!el) return;
    if (on) el.classList.add(cls); else el.classList.remove(cls);
  }

  // localStorage can throw (private mode, quota, disabled storage).
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, String(v)); } catch (e) { /* ignore */ } }
  };

  function isHidden() { return !!(document.hidden || document.webkitHidden); }

  function fmtTime(d) { return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function dayKey(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

  /*
   * GET a JSON URL with a timeout. cb(err, data, meta) is called exactly once.
   * meta.offline is true when the service worker answered from its cache
   * because the network was down (the data is the last saved copy).
   * Uses XMLHttpRequest because it works on every old browser.
   */
  function getJSON(url, cb) {
    var done = false;
    var xhr = new XMLHttpRequest();
    function finish(err, data) {
      if (done) return;
      done = true;
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onabort = null;
      var offline = false;
      try { offline = xhr.getResponseHeader("X-Dashboard-Offline") === "1"; } catch (e) { /* ignore */ }
      cb(err, data, { offline: offline });
    }
    try {
      xhr.open("GET", url, true);
      xhr.timeout = 20000;
      xhr.onload = function () {
        var data = null;
        try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ }
        if (xhr.status >= 200 && xhr.status < 300 && data) return finish(null, data);
        var msg = (data && data.error && (data.error.message || data.error)) || (data && data.message) || "";
        finish(new Error("HTTP " + xhr.status + (msg ? " - " + msg : "")));
      };
      xhr.onerror = function () { finish(new Error("Network error")); };
      xhr.ontimeout = function () { finish(new Error("Timed out")); };
      xhr.onabort = function () { finish(new Error("Aborted")); };
      xhr.send();
    } catch (e) {
      finish(e);
    }
  }

  /*
   * A self-rescheduling background job. Uses a setTimeout chain (never
   * setInterval) so runs can't pile up. On failure it retries with backoff
   * (30s, 60s, 2m, ... up to the normal interval). A watchdog releases a run
   * that never reports back, so one stuck request can't stall it forever.
   */
  var tasks = [];
  function makeTask(name, fn, interval) {
    var t = { name: name, timer: null, guard: null, busy: false, fails: 0, lastOk: 0, runId: 0 };

    function schedule(ms) {
      clearTimeout(t.timer);
      t.timer = setTimeout(run, ms);
    }
    function finish(id, ok) {
      if (!t.busy || id !== t.runId) return; // late/duplicate callback
      t.busy = false;
      clearTimeout(t.guard);
      if (ok) {
        t.fails = 0;
        t.lastOk = Date.now();
        schedule(interval);
      } else {
        t.fails++;
        schedule(Math.min(interval, 30000 * Math.pow(2, Math.min(t.fails - 1, 6))));
      }
    }
    function run() {
      if (t.busy) return;
      t.busy = true;
      t.runId++;
      var id = t.runId;
      clearTimeout(t.timer);
      t.guard = setTimeout(function () {
        if (window.console) console.warn(name + ": timed out, will retry");
        finish(id, false);
      }, 60000);
      try {
        fn(function (ok) { finish(id, ok !== false); });
      } catch (e) {
        if (window.console) console.error(name + " failed:", e);
        finish(id, false);
      }
    }
    t.run = run;
    t.isStale = function (maxAge) { return Date.now() - t.lastOk > maxAge; };
    tasks.push(t);
    return t;
  }

  function refreshStale(maxAge) {
    each(tasks, function (t) { if (t.isStale(maxAge)) t.run(); });
  }

  /* ===== NAVIGATION ===== */
  // Kiosk browsers (Fully Kiosk etc.) are already fullscreen and usually
  // don't support the Fullscreen API, so only show the button where it works.
  var FS_SUPPORTED = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  var currentPage = "home";

  function showPage(pageId) {
    if (!$(pageId)) return;
    currentPage = pageId;
    each(document.querySelectorAll(".page"), function (p) { toggleClass(p, "active", p.id === pageId); });
    each(document.querySelectorAll(".nav-btn"), function (b) {
      toggleClass(b, "active", b.getAttribute("data-page") === pageId);
    });

    toggleClass(document.body, "home-active", pageId === "home");
    toggleClass($("sidebar"), "open", false); // any nav tap (incl. Home) closes the slide-out menu

    var fsBtn = $("fs-btn");
    if (fsBtn) fsBtn.style.display = (pageId === "photos" && FS_SUPPORTED) ? "block" : "none";

    // Show a photo right away when arriving at a page that has a slideshow,
    // then let the (single) slideshow timer take over.
    slideshow.onPageChange();
  }

  each(document.querySelectorAll(".nav-btn"), function (btn) {
    btn.addEventListener("click", function () { showPage(btn.getAttribute("data-page")); });
  });

  function toggleSidebar() {
    if (document.body.classList.contains("home-active")) {
      var sb = $("sidebar");
      if (sb) sb.classList.toggle("open");
    }
  }
  window.toggleSidebar = toggleSidebar;
  if ($("menuToggle")) $("menuToggle").addEventListener("click", toggleSidebar);

  // Tapping anywhere on the home grid closes the slide-out menu.
  var homeGrid = document.querySelector(".home-grid");
  if (homeGrid) homeGrid.addEventListener("click", function () { toggleClass($("sidebar"), "open", false); });

  /* ===== CLOCK (+ day-change / wake-from-sleep detection) ===== */
  var lastTick = Date.now();
  var lastDay = dayKey(new Date());
  var startedAt = Date.now();
  var reloadPending = false;
  var lastNightCheck = 0;

  function updateClock() {
    var now = new Date();
    var timeStr = fmtTime(now);
    var dateStr = now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
    setText("home-time", timeStr);
    setText("home-date", dateStr);
    setText("time", timeStr);
    setText("date", dateStr);

    var nowMs = now.getTime();
    // Device slept / browser was frozen for a while: refresh anything stale.
    if (nowMs - lastTick > 2 * 60 * 1000) refreshStale(60 * 1000);
    lastTick = nowMs;

    // Midnight rollover: redraw "Today" + calendar (and new month) right away.
    var dk = dayKey(now);
    if (dk !== lastDay) {
      lastDay = dk;
      renderCalendarAll();
      calendarTask.run();
    }

    maybeDailyReload(now);
    if (now.getSeconds() === 0 || nowMs - lastNightCheck > 61000) {
      lastNightCheck = nowMs;
      if (typeof applyNightSchedule === "function") applyNightSchedule(now);
    }
  }

  // Once a day, reload the page to clear any memory build-up in old browsers
  // and pick up new deploys. Only reloads if the site is reachable, so the
  // tablet never ends up stuck on an offline error page.
  function maybeDailyReload(now) {
    var hour = CFG.DAILY_RELOAD_HOUR;
    if (hour === null || hour === undefined || hour === false || reloadPending) return;
    if (now.getHours() !== Number(hour) || now.getMinutes() > 10) return;
    if (Date.now() - startedAt < 60 * 60 * 1000) return; // loaded recently already
    reloadPending = true;
    if (IS_FILE) { window.location.reload(); return; } // local file: always reachable
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "index.html?ping=" + Date.now(), true);
    xhr.timeout = 15000;
    xhr.onload = function () {
      if (xhr.status >= 200 && xhr.status < 400) window.location.reload();
      else reloadPending = false;
    };
    xhr.onerror = xhr.ontimeout = function () { reloadPending = false; };
    xhr.send();
  }

  updateClock();
  setInterval(updateClock, 1000);

  /* ===== NIGHT MODE (manual button + optional schedule) ===== */
  // NIGHT_MODE_START / NIGHT_MODE_END are hours 0-23 (e.g. 22 and 6). null turns the schedule off.
  // The button always works; the schedule re-applies at the next start/end time.
  var nightBtn = $("night-toggle");
  function validHour(h) { return typeof h === "number" && h >= 0 && h <= 23 && Math.floor(h) === h; }
  var NIGHT_START = CFG.NIGHT_MODE_START, NIGHT_END = CFG.NIGHT_MODE_END;
  var NIGHT_SCHEDULED = validHour(NIGHT_START) && validHour(NIGHT_END) && NIGHT_START !== NIGHT_END;

  function isNightHour(h) {
    return NIGHT_START < NIGHT_END ? (h >= NIGHT_START && h < NIGHT_END) : (h >= NIGHT_START || h < NIGHT_END);
  }
  // Identifies the current scheduled period by its starting boundary (e.g. "night@2026-10-20 22").
  function nightPeriodKey(now) {
    var t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());
    var night = isNightHour(t.getHours());
    for (var i = 0; i < 48; i++) {
      var prev = new Date(t.getTime() - 3600000);
      if (isNightHour(prev.getHours()) !== night) break;
      t = prev;
    }
    return (night ? "night@" : "day@") + dayKey(t) + " " + t.getHours();
  }

  function setNight(on) {
    toggleClass(document.body, "night", on);
    if (nightBtn) nightBtn.textContent = on ? "Night On" : "Night Mode";
    store.set("nightMode", on);
    if (NIGHT_SCHEDULED) store.set("nightModePeriod", nightPeriodKey(new Date()));
  }

  var lastNightPeriod = null;
  function applyNightSchedule(now) {
    if (!NIGHT_SCHEDULED) return;
    var key = nightPeriodKey(now);
    if (key === lastNightPeriod) return;
    var first = lastNightPeriod === null;
    lastNightPeriod = key;
    // On start-up keep a manual choice made earlier in this same period (e.g. across the 3 AM reload).
    if (first && store.get("nightModePeriod") === key && store.get("nightMode") !== null) {
      setNight(store.get("nightMode") === "true");
    } else {
      setNight(isNightHour(now.getHours()));
    }
  }

  if (NIGHT_SCHEDULED) applyNightSchedule(new Date());
  else if (store.get("nightMode") === "true") setNight(true);
  if (nightBtn) nightBtn.addEventListener("click", function () {
    setNight(!document.body.classList.contains("night"));
  });

  /* ===== WEATHER ===== */
  var weatherLoaded = false;

  function windDir(deg) {
    if (typeof deg !== "number" || isNaN(deg)) return "";
    var dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return dirs[Math.round(deg / 45) % 8];
  }

  function owmUrl(kind) {
    return apiUrl("weather?kind=" + (kind === "weather" ? "current" : kind));
  }

  function precipOf(f) {
    return ((f.rain && f.rain["3h"]) || 0) + ((f.snow && f.snow["3h"]) || 0);
  }

  function makeTile(cls, label, main, sub) {
    var box = document.createElement("div");
    box.className = cls;
    var a = document.createElement("div"); a.textContent = label;
    var b = document.createElement("div"); b.style.fontWeight = "600"; b.textContent = main;
    var c = document.createElement("div"); c.style.fontSize = "12px"; c.style.opacity = "0.7"; c.textContent = sub;
    box.appendChild(a); box.appendChild(b); box.appendChild(c);
    return box;
  }

  function renderCurrent(current) {
    var main = current.main || {};
    var wind = current.wind || {};
    var sys = current.sys || {};
    var temp = Math.round(main.temp) + "°";
    var feels = "Feels like " + Math.round(main.feels_like) + "°";
    var desc = (current.weather && current.weather[0] && current.weather[0].description) || "";
    var humidity = main.humidity !== undefined ? main.humidity + "%" : "--";
    var speed = wind.speed !== undefined ? Math.round(wind.speed) + " mph" : "--";
    var vis = typeof current.visibility === "number" ? (current.visibility / 1609).toFixed(1) + " mi" : "--";

    setText("home-temp", temp);
    setText("home-desc", desc);
    setText("home-feels", feels);
    setText("home-humidity", humidity);
    setText("home-wind", speed);
    setText("home-visibility", vis);
    setText("home-sunrise", sys.sunrise ? fmtTime(new Date(sys.sunrise * 1000)) : "--");
    setText("home-sunset", sys.sunset ? fmtTime(new Date(sys.sunset * 1000)) : "--");

    setText("weather-temp", temp);
    setText("weather-desc", desc);
    setText("weather-feels", feels);
    setText("weather-humidity", humidity);
    var dir = windDir(wind.deg);
    setText("weather-wind", (dir ? dir + " " : "") + speed);
    setText("weather-visibility", vis);
  }

  function renderForecast(forecast) {
    var list = (forecast && forecast.list) || [];
    var hourly = $("hourly");
    var daily = $("daily");

    if (hourly) {
      var hf = document.createDocumentFragment();
      list.slice(0, 8).forEach(function (f) {
        var time = new Date(f.dt * 1000).toLocaleString("en-US", { hour: "numeric", hour12: true });
        var percent = Math.round((f.pop || 0) * 100);
        var total = precipOf(f) / 25.4;
        var precip = total >= 0.005 ? total.toFixed(2) + '" · ' + percent + "%" : (percent > 0 ? percent + "%" : "Dry");
        hf.appendChild(makeTile("hour", time, Math.round(f.main.temp) + "°", precip));
      });
      hourly.innerHTML = "";
      hourly.appendChild(hf);
    }

    if (daily) {
      var days = [];
      var byKey = {};
      list.forEach(function (f) {
        var d = new Date(f.dt * 1000);
        var k = dayKey(d);
        if (!byKey[k]) { byKey[k] = { date: d, temps: [], precip: 0, pop: 0 }; days.push(byKey[k]); }
        byKey[k].temps.push(f.main.temp);
        byKey[k].precip += precipOf(f);
        byKey[k].pop = Math.max(byKey[k].pop, f.pop || 0);
      });
      var df = document.createDocumentFragment();
      days.slice(0, 6).forEach(function (d) {
        var hi = Math.round(Math.max.apply(null, d.temps));
        var lo = Math.round(Math.min.apply(null, d.temps));
        var label = d.date.toLocaleDateString([], { weekday: "short" });
        df.appendChild(makeTile("day", label, hi + "° / " + lo + "°",
          (d.precip / 25.4).toFixed(2) + '" · ' + Math.round(d.pop * 100) + "%"));
      });
      daily.innerHTML = "";
      daily.appendChild(df);
    }
  }

  function weatherFailed(msg) {
    // Keep showing the last good reading; only show the error if we have none.
    if (!weatherLoaded) {
      setText("home-desc", msg);
      setText("weather-desc", msg);
    }
  }

  var weatherTask = makeTask("Weather", function (done) {
    getJSON(owmUrl("weather"), function (err, current, meta) {
      if (err || !current || !current.main) {
        if (window.console) console.error("Weather failed:", err);
        weatherFailed("Weather unavailable");
        return done(false);
      }
      renderCurrent(current);
      weatherLoaded = true;
      getJSON(owmUrl("forecast"), function (err2, forecast) {
        if (err2 || !forecast || !forecast.list) {
          if (window.console) console.error("Forecast failed:", err2);
          return done(false);
        }
        renderForecast(forecast);
        done(!meta.offline); // cached copy while offline: keep retrying

      });
    });
  }, 10 * 60 * 1000);

  /* ===== CALENDAR ===== */
  var HOLIDAY_RE = /Day|Birthday|Holiday|Christmas|Thanksgiving|Halloween|Easter|New Year/i;
  var calEvents = [];
  var calLoaded = false;

  function parseDate(part, isEnd) {
    if (!part) return null;
    if (part.dateTime) return new Date(part.dateTime);
    if (part.date) {
      var p = part.date.split("-");
      var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
      // All-day end dates are exclusive in Google Calendar.
      if (isEnd) d = new Date(d.getTime() - 1);
      return d;
    }
    return null;
  }
  function parseEventDate(ev) { return parseDate(ev.start, false); }
  function parseEventEnd(ev) {
    var e = parseDate(ev.end, true);
    var s = parseEventDate(ev);
    if (!e || !s || e < s) return s;
    // Timed event ending exactly at midnight shouldn't spill into the next day.
    if (ev.end && ev.end.dateTime && e.getTime() > s.getTime()) e = new Date(e.getTime() - 1);
    return e;
  }

  function isHolidayEvent(ev) { return ev._holiday || HOLIDAY_RE.test(ev.summary || ""); }

  function calUrl(which, start, end) {
    return apiUrl("calendar?which=" + which + "&timeMin=" + encodeURIComponent(start) + "&timeMax=" + encodeURIComponent(end));
  }

  var calendarTask = makeTask("Calendar", function (done) {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    var end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    var pending = 2, mainItems = null, holidayItems = null, mainErr = null, offline = false;
    function oneDone() {
      if (--pending > 0) return;
      if (mainItems === null && holidayItems === null) {
        if (window.console) console.error("Calendar failed:", mainErr);
        if (!calLoaded) setText("today-date", now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }));
        if (!calLoaded && $("today-events")) $("today-events").innerHTML = '<div style="opacity:0.6">Calendar unavailable</div>';
        return done(false);
      }
      var all = (mainItems || []).concat(holidayItems || []);
      all.sort(function (a, b) {
        var da = parseEventDate(a), db = parseEventDate(b);
        return (da ? da.getTime() : 0) - (db ? db.getTime() : 0);
      });
      calEvents = all;
      calLoaded = true;
      renderCalendarAll();
      // If one of the two calendars failed, retry sooner.
      done(mainItems !== null && holidayItems !== null && !offline);
    }

    getJSON(calUrl("main", start, end), function (err, data, meta) {
      if (err || !data) { mainErr = err; } else { mainItems = data.items || []; if (meta.offline) offline = true; }
      oneDone();
    });
    getJSON(calUrl("holiday", start, end), function (err, data) {
      if (err || !data) {
        if (window.console) console.warn("Holiday calendar failed:", err);
      } else {
        holidayItems = (data.items || []).map(function (ev) { ev._holiday = true; return ev; });
      }
      oneDone();
    });
  }, 15 * 60 * 1000);

  function renderCalendarAll() {
    renderCalendar(calEvents);
    renderToday(calEvents);
  }

  function renderCalendar(events) {
    var grid = $("calendar-grid");
    if (!grid) return;

    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth();
    var firstDay = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var monthStart = new Date(year, month, 1);
    var monthEnd = new Date(year, month, daysInMonth, 23, 59, 59, 999);

    // Map each event onto every day it covers within this month
    // (multi-day events show on each day; events from other months don't leak in).
    var eventMap = {};
    events.forEach(function (ev) {
      var s = parseEventDate(ev);
      var e = parseEventEnd(ev);
      if (!s) return;
      if (e < monthStart || s > monthEnd) return;
      var d = new Date(Math.max(s.getTime(), monthStart.getTime()));
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      var guard = 0;
      while (d <= e && d <= monthEnd && guard++ < 32) {
        var day = d.getDate();
        if (!eventMap[day]) eventMap[day] = [];
        eventMap[day].push(ev);
        d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
      }
    });

    var frag = document.createDocumentFragment();
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].forEach(function (name) {
      var h = document.createElement("div");
      h.className = "cal-day-header";
      h.textContent = name;
      frag.appendChild(h);
    });

    for (var i = 0; i < firstDay; i++) {
      var empty = document.createElement("div");
      empty.className = "cal-day empty";
      frag.appendChild(empty);
    }

    var today = now.getDate();
    for (var day = 1; day <= daysInMonth; day++) {
      var cell = document.createElement("div");
      cell.className = "cal-day" + (day === today ? " today" : "");
      var dateLabel = document.createElement("div");
      dateLabel.className = "cal-date";
      dateLabel.textContent = day;
      cell.appendChild(dateLabel);

      (eventMap[day] || []).forEach(function (ev) {
        var evDiv = document.createElement("div");
        evDiv.className = "cal-event" + (isHolidayEvent(ev) ? " holiday" : "");
        evDiv.textContent = ev.summary || "Untitled";
        cell.appendChild(evDiv);
      });
      frag.appendChild(cell);
    }

    grid.innerHTML = "";
    grid.appendChild(frag);
  }

  // "3:00 PM" for timed events starting today, "All day" for all-day events.
  // A timed event that began on an earlier day shows when it ends today ("Until 11:00 AM"),
  // or "All day" if it runs through the whole day.
  function todayEventTime(ev, dayStart) {
    if (!ev.start || !ev.start.dateTime) return "All day";
    var s = parseEventDate(ev);
    if (s >= dayStart) return fmtTime(s);
    var e = parseEventEnd(ev);
    var dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), 23, 59, 59, 999);
    return e && e < dayEnd ? "Until " + fmtTime(new Date(e.getTime() + 1)) : "All day";
  }

  function renderToday(events) {
    var container = $("today-events");
    var dateEl = $("today-date");
    if (!container || !dateEl) return;

    var now = new Date();
    dateEl.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

    var dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    var todays = events.filter(function (ev) {
      var s = parseEventDate(ev), e = parseEventEnd(ev);
      return s && s <= dayEnd && e >= dayStart;
    });

    container.innerHTML = "";
    if (!todays.length) {
      container.innerHTML = '<div style="opacity:0.6">' + (calLoaded ? "No events today" : "Loading…") + "</div>";
      return;
    }

    todays.forEach(function (ev) {
      var div = document.createElement("div");
      div.className = "today-event" + (isHolidayEvent(ev) ? " holiday" : "");
      var time = document.createElement("span");
      time.className = "today-event-time";
      time.textContent = todayEventTime(ev, dayStart);
      div.appendChild(time);
      div.appendChild(document.createTextNode(ev.summary || "Untitled"));
      container.appendChild(div);
    });
  }

  /* ===== PHOTOS / DRIVE ===== */
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return arr;
  }

  // Ask Google for images sized to the screen instead of always 1920px:
  // much less decoding work / memory on an old tablet.
  function photoSize(forHome) {
    var dpr = window.devicePixelRatio || 1;
    var px = Math.max(window.screen.width || 1280, window.screen.height || 800) * dpr;
    if (forHome) px = px * 0.5;
    return Math.max(640, Math.min(1920, Math.round(px)));
  }
  function photoUrl(id, forHome) {
    if (PHOTO_SOURCE === "local") return "photos/" + encodeURIComponent(id);
    return "https://lh3.googleusercontent.com/d/" + id + "=s" + photoSize(forHome);
  }

  /*
   * One timer drives whichever slideshow is on screen. Nothing loads while
   * the other pages are showing or the screen is off, and a broken image is
   * skipped instead of leaving a blank frame.
   */
  var slideshow = (function () {
    var ids = [];
    var timer = null;
    var fadeTimer = null;
    var loadedOnce = false;
    var homeImg = $("home-slideshow-img");
    var frameImg = $("photo-frame-img");
    var state = { home: { idx: 0, shown: -1, errors: 0 }, photos: { idx: 0, shown: -1, errors: 0 } };

    var emptyEls = [$("home-photo-empty"), $("photo-frame-empty")];

    // Friendly message instead of a blank frame. title=null hides it.
    function setEmpty(title, hint) {
      each(emptyEls, function (el) {
        if (!el) return;
        if (!title) { toggleClass(el, "show", false); return; }
        el.innerHTML = "";
        var icon = document.createElement("div"); icon.className = "photo-empty-icon";
        icon.innerHTML = '<svg viewBox="0 0 24 24" width="48" height="48" fill="currentColor"><path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5z"/></svg>';
        var t = document.createElement("div"); t.className = "photo-empty-title"; t.textContent = title;
        el.appendChild(icon); el.appendChild(t);
        if (hint) { var h = document.createElement("div"); h.className = "photo-empty-hint"; h.textContent = hint; el.appendChild(h); }
        toggleClass(el, "show", true);
      });
    }

    function imgFor(page) { return page === "home" ? homeImg : (page === "photos" ? frameImg : null); }

    function show(page, idx) {
      var img = imgFor(page);
      if (!img || !ids.length) return;
      var s = state[page];
      s.idx = idx % ids.length;
      s.shown = s.idx;
      var url = photoUrl(ids[s.idx], page === "home");
      if (page === "home") {
        img.style.opacity = "0";
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(function () {
          if (img.src === url) img.style.opacity = "1"; else img.src = url;
        }, 400);
      } else {
        img.src = url;
      }
    }

    function handleLoad(page) {
      return function () {
        state[page].errors = 0;
        loadedOnce = true;
        setEmpty(null);
        if (page === "home") homeImg.style.opacity = "1";
      };
    }
    function handleError(page) {
      return function () {
        var s = state[page];
        if (!ids.length || !imgFor(page).getAttribute("src")) return;
        s.errors++;
        if (window.console) console.warn("Photo failed to load, skipping");
        if (s.errors < Math.min(ids.length, 5)) show(page, s.idx + 1); // otherwise wait for next tick
        else if (!loadedOnce) setEmpty("Photos couldn't load", "Will try again shortly.");
      };
    }
    if (homeImg) { homeImg.onload = handleLoad("home"); homeImg.onerror = handleError("home"); }
    if (frameImg) { frameImg.onload = handleLoad("photos"); frameImg.onerror = handleError("photos"); }

    function schedule() {
      clearTimeout(timer);
      timer = null;
      if (!ids.length || isHidden() || !imgFor(currentPage)) return;
      timer = setTimeout(function () {
        var s = state[currentPage];
        if (s) { s.errors = 0; show(currentPage, s.idx + 1); }
        schedule();
      }, SLIDE_MS);
    }

    function onPageChange() {
      var s = state[currentPage];
      if (s && ids.length && s.shown === -1) show(currentPage, s.idx);
      schedule();
    }

    // emptyHint: message to show if newIds is empty (e.g. where to add photos).
    function setList(newIds, emptyHint) {
      if (!newIds.length) {
        ids = [];
        clearTimeout(timer); clearTimeout(fadeTimer); timer = null;
        loadedOnce = false;
        if (homeImg) homeImg.removeAttribute("src");
        if (frameImg) frameImg.removeAttribute("src");
        state.home = { idx: 0, shown: -1, errors: 0 };
        state.photos = { idx: 0, shown: -1, errors: 0 };
        setEmpty("No photos yet", emptyHint || "");
        return;
      }
      var same = newIds.length === ids.length && newIds.slice().sort().join() === ids.slice().sort().join();
      if (same) return;
      ids = shuffle(newIds.slice());
      state.home = { idx: 0, shown: -1, errors: 0 };
      state.photos = { idx: 0, shown: -1, errors: 0 };
      onPageChange();
    }

    function hasPhotos() { return ids.length > 0; }

    return { setList: setList, onPageChange: onPageChange, schedule: schedule, hasPhotos: hasPhotos };
  })();

  // The photos function returns every image in the shared Drive folder (all pages).
  function driveUrl() { return apiUrl("photos"); }

  // Remember the last Drive photo list so the slideshow can start even if the
  // tablet boots without Wi-Fi (already-viewed photos come from the cache).
  function cachedDriveList() {
    try { var l = JSON.parse(store.get("drivePhotoIds") || "[]"); return l && l.length ? l : null; } catch (e) { return null; }
  }

  function loadDrivePhotos(done) {
    getJSON(driveUrl(), function (err, data, meta) {
      if (err || !data) {
        if (window.console) console.error("Drive photo load failed:", err);
        var cached = cachedDriveList();
        if (cached) slideshow.setList(cached);
        else if (!slideshow.hasPhotos()) {
          var notSetUp = err && /HTTP 503/.test(err.message);
          slideshow.setList([], notSetUp ? "Photos aren't set up yet (Netlify GOOGLE_DRIVE_FOLDER_ID)." :
            "Couldn't reach Google Drive. Will try again shortly.");
        }
        return done(false);
      }
      var found = [];
      (data.files || []).forEach(function (f) {
        if (f.mimeType && f.mimeType.indexOf("image/") === 0) found.push(f.id);
      });
      slideshow.setList(found, "Add photos to your Google Drive photo folder.");
      store.set("drivePhotoIds", JSON.stringify(found));
      done(!meta.offline);
    });
  }

  /*
   * Local photos: photos/photos.js (made by make-photo-list.bat / .sh) sets
   * window.LOCAL_PHOTOS = ["a.jpg", ...]. Loaded with a <script> tag because
   * that works from file:// on every browser (XHR/directory listing doesn't).
   */
  var localScript = null;
  function loadLocalPhotos(done) {
    if (localScript && localScript.parentNode) localScript.parentNode.removeChild(localScript);
    window.LOCAL_PHOTOS = null;
    var el = document.createElement("script");
    var finished = false;
    function finish(ok) {
      if (finished) return;
      finished = true;
      el.onload = el.onerror = null;
      var list = [];
      each(window.LOCAL_PHOTOS || [], function (name) {
        if (typeof name === "string" && /\.(jpe?g|png|gif|webp)$/i.test(name)) list.push(name);
      });
      if (!list.length && window.console) console.warn("No local photos listed in photos/photos.js");
      slideshow.setList(list, "Add photos to the photos folder, then run make-photo-list.");
      done(ok);
    }
    el.onload = function () { finish(true); };
    el.onerror = function () {
      if (window.console) console.warn("photos/photos.js not found - run make-photo-list after adding photos");
      finish(false);
    };
    el.src = "photos/photos.js?t=" + Date.now();
    localScript = el;
    document.getElementsByTagName("head")[0].appendChild(el);
  }

  var photosTask = makeTask("Photos", function (done) {
    if (PHOTO_SOURCE === "local") loadLocalPhotos(done); else loadDrivePhotos(done);
  }, 60 * 60 * 1000); // pick up added/removed photos hourly

  /* Fullscreen (with old webkit-prefixed fallback) */
  if ($("fs-btn")) $("fs-btn").addEventListener("click", function () {
    var el = $("photos");
    var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (!fsEl) {
        var req = el && (el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen);
        if (req) {
          var p = req.call(el);
          if (p && p["catch"]) p["catch"](function () { /* ignore */ });
        }
      } else {
        var exit = document.exitFullscreen || document.webkitExitFullscreen || document.webkitCancelFullScreen;
        if (exit) {
          var p2 = exit.call(document);
          if (p2 && p2["catch"]) p2["catch"](function () { /* ignore */ });
        }
      }
    } catch (e) { /* fullscreen not allowed */ }
  });

  /* ===== MEDIA (local state only) ===== */
  var isPlaying = false;
  var activeSource = "spotify";
  var volumeLevel = 60;
  var isMuted = false;
  var connectedOutput = "Bluetooth Speaker";

  var playBtn = $("play-btn");
  var playStatus = $("play-status");
  var trackInfo = $("track-info");
  var volumeSlider = document.querySelector(".volume-slider");
  var muteBtn = document.querySelector(".mute-btn");
  var outputText = document.querySelector(".media-output strong");
  var homeNowPlaying = $("home-nowplaying-text");

  // Paint the filled part of the (custom-styled) volume slider.
  function paintVolume() {
    if (!volumeSlider) return;
    var v = Math.max(0, Math.min(100, Number(volumeSlider.value) || 0));
    volumeSlider.style.backgroundSize = v + "% 14px, 100% 14px";
  }

  function updateNowPlaying() {
    var text = isPlaying ? String(activeSource).toUpperCase() + " · Playing" : "Not Playing";
    if (playStatus) playStatus.textContent = isPlaying ? "Playing" : "Not Playing";
    if (trackInfo) trackInfo.textContent = isPlaying ? "Demo Track · Demo Artist" : "Artist · Album";
    if (homeNowPlaying) homeNowPlaying.textContent = text;
  }

  if (playBtn) playBtn.addEventListener("click", function () {
    isPlaying = !isPlaying;
    toggleClass(playBtn, "paused", isPlaying);
    store.set("isPlaying", isPlaying);
    updateNowPlaying();
  });

  each(document.querySelectorAll(".shortcut-btn"), function (btn) {
    btn.addEventListener("click", function () {
      each(document.querySelectorAll(".shortcut-btn"), function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      activeSource = btn.getAttribute("data-source");
      store.set("activeSource", activeSource);
      updateNowPlaying();
    });
  });

  function onVolumeInput() {
    var v = Number(volumeSlider.value);
    isMuted = v === 0;
    if (!isMuted) volumeLevel = v; // remember last non-zero level for un-mute
    toggleClass(muteBtn, "active", isMuted);
    store.set("volumeLevel", volumeLevel);
    store.set("isMuted", isMuted);
    paintVolume();
  }
  if (volumeSlider) {
    volumeSlider.addEventListener("input", onVolumeInput);
    volumeSlider.addEventListener("change", onVolumeInput); // very old WebViews only fire "change"
  }

  if (muteBtn) muteBtn.addEventListener("click", function () {
    isMuted = !isMuted;
    if (volumeSlider) volumeSlider.value = isMuted ? 0 : (volumeLevel || 60);
    paintVolume();
    toggleClass(muteBtn, "active", isMuted);
    store.set("isMuted", isMuted);
  });

  function restoreMediaState() {
    var savedPlaying = store.get("isPlaying");
    if (savedPlaying !== null) {
      isPlaying = savedPlaying === "true";
      toggleClass(playBtn, "paused", isPlaying);
    }
    var savedVol = store.get("volumeLevel");
    if (savedVol !== null && !isNaN(Number(savedVol))) {
      volumeLevel = Number(savedVol);
      if (volumeSlider) volumeSlider.value = volumeLevel;
    }
    if (store.get("isMuted") === "true") {
      isMuted = true;
      if (volumeSlider) volumeSlider.value = 0;
      toggleClass(muteBtn, "active", true);
    }
    var savedSource = store.get("activeSource");
    if (savedSource) {
      activeSource = savedSource;
      each(document.querySelectorAll(".shortcut-btn"), function (btn) {
        toggleClass(btn, "active", btn.getAttribute("data-source") === savedSource);
      });
    }
    var savedOutput = store.get("connectedOutput");
    if (savedOutput && outputText) {
      connectedOutput = savedOutput;
      outputText.textContent = connectedOutput;
    }
    updateNowPlaying();
    paintVolume();
  }
  restoreMediaState();

  /* ===== RECOVERY ===== */
  // Back online after a Wi-Fi drop: refresh anything that has gone stale.
  window.addEventListener("online", function () { refreshStale(60 * 1000); });

  // Screen turned back on: resume the slideshow and refresh stale data.
  function onVisibility() {
    slideshow.schedule();
    if (!isHidden()) refreshStale(5 * 60 * 1000);
  }
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("webkitvisibilitychange", onVisibility);

  /* ===== INIT ===== */
  showPage("home");
  renderCalendarAll();
  weatherTask.run();
  calendarTask.run();
  photosTask.run();
  if (!HAS_CONFIG) {
    setText("home-desc", "config.js missing - copy config.example.js to config.js");
    setText("weather-desc", "config.js missing");
    if (window.console) console.error("config.js is missing: copy config.example.js to config.js and fill in your keys");
  }
})();
