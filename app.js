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
  // Our functions answer 503 when their Netlify environment variables aren't set.
  function notConfigured(err) { return !!(err && /^HTTP 503/.test(err.message)); }
  var weatherNotConfigured = false, calNotConfigured = false;

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
    closeDayModal();

    var fsBtn = $("fs-btn");
    if (fsBtn) fsBtn.style.display = (pageId === "photos" && FS_SUPPORTED) ? "block" : "none";

    // Show a photo right away when arriving at a page that has a slideshow,
    // then let the (single) slideshow timer take over.
    slideshow.onPageChange();
    if (typeof spotify !== "undefined" && spotify) spotify.onPageChange();
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
  // Missing keys (e.g. a config.js made before this setting existed) use the documented 22 / 6 default.
  var NIGHT_START = CFG.NIGHT_MODE_START === undefined ? 22 : CFG.NIGHT_MODE_START;
  var NIGHT_END = CFG.NIGHT_MODE_END === undefined ? 6 : CFG.NIGHT_MODE_END;
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

  // Forecast failed: say so instead of leaving the hourly/daily rows blank
  // (or silently showing an old forecast).
  var forecastAt = 0;
  function forecastNote(failed) {
    var note = $("forecast-note");
    if (!note) return;
    var text = "";
    if (failed) {
      text = forecastAt ? "Forecast couldn't refresh - showing earlier data from " + fmtTime(new Date(forecastAt)) :
        "Forecast unavailable - retrying automatically";
    }
    setText("forecast-note", text);
    toggleClass(note, "show", !!text);
  }

  var weatherTask = makeTask("Weather", function (done) {
    getJSON(owmUrl("weather"), function (err, current, meta) {
      weatherNotConfigured = notConfigured(err);
      if (err || !current || !current.main) {
        if (window.console) console.error("Weather failed:", err);
        weatherFailed(weatherNotConfigured ? "Weather not configured" : "Weather unavailable");
        forecastNote(true);
        return done(false);
      }
      renderCurrent(current);
      weatherLoaded = true;
      getJSON(owmUrl("forecast"), function (err2, forecast) {
        if (err2 || !forecast || !forecast.list) {
          if (window.console) console.error("Forecast failed:", err2);
          forecastNote(true);
          return done(false);
        }
        renderForecast(forecast);
        if (!meta.offline) { forecastAt = Date.now(); forecastNote(false); }
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
        if (!calLoaded && $("today-events")) $("today-events").innerHTML = '<div style="opacity:0.6">' + (calNotConfigured ? "Calendar not configured" : "Calendar unavailable") + "</div>";
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
      calNotConfigured = notConfigured(err);
      if (err || !data) { mainErr = err; } else { mainItems = data.items || []; if (meta.offline) offline = true; }
      oneDone();
    });
    getJSON(calUrl("holiday", start, end), function (err, data, meta) {
      if (err || !data) {
        if (window.console) console.warn("Holiday calendar failed:", err);
      } else {
        if (meta.offline) offline = true;
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
    setText("cal-title", monthStart.toLocaleDateString([], { month: "long", year: "numeric" }));

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
      cell.setAttribute("data-day", day);
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

    calDayEvents = eventMap;
    calMonthStart = monthStart;
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

  /* Tap a calendar day to see all of its events (full titles + times). */
  var calDayEvents = {};
  var calMonthStart = new Date();
  var dayModal = $("day-modal");
  var dayModalTimer = null;

  function eventTimeText(ev, dayDate) {
    if (!ev.start || !ev.start.dateTime) return "All day";
    var s = parseEventDate(ev), e = parseEventEnd(ev);
    var dayEnd = new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate() + 1);
    var endsToday = e && e < dayEnd;
    var endTxt = endsToday ? fmtTime(new Date(e.getTime() + 1)) : "";
    // Same wording as the Today card for events that began on an earlier day.
    if (s < dayDate) return endsToday ? "Until " + endTxt : "All day";
    return fmtTime(s) + (endsToday ? " – " + endTxt : " – later");
  }

  function openDayModal(day) {
    if (!dayModal) return;
    var date = new Date(calMonthStart.getFullYear(), calMonthStart.getMonth(), day);
    setText("day-modal-title", date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" }));
    var list = $("day-modal-list");
    list.innerHTML = "";
    var evs = calDayEvents[day] || [];
    if (!evs.length) {
      var none = document.createElement("div");
      none.className = "modal-empty";
      none.textContent = "No events";
      list.appendChild(none);
    }
    evs.forEach(function (ev) {
      var row = document.createElement("div");
      row.className = "modal-event" + (isHolidayEvent(ev) ? " holiday" : "");
      var t = document.createElement("div");
      t.className = "modal-event-time";
      t.textContent = eventTimeText(ev, date);
      var n = document.createElement("div");
      n.className = "modal-event-title";
      n.textContent = ev.summary || "Untitled";
      row.appendChild(t);
      row.appendChild(n);
      list.appendChild(row);
    });
    toggleClass(dayModal, "open", true);
    // A wall panel shouldn't stay stuck on a popup: close it after a minute.
    clearTimeout(dayModalTimer);
    dayModalTimer = setTimeout(closeDayModal, 60000);
  }

  function closeDayModal() {
    clearTimeout(dayModalTimer);
    toggleClass(dayModal, "open", false);
  }

  if ($("calendar-grid")) $("calendar-grid").addEventListener("click", function (e) {
    var el = e.target;
    while (el && el !== this && !(el.getAttribute && el.getAttribute("data-day"))) el = el.parentNode;
    if (el && el !== this) openDayModal(Number(el.getAttribute("data-day")));
  });
  if ($("day-modal-close")) $("day-modal-close").addEventListener("click", closeDayModal);
  // Tapping the dimmed area outside the panel closes it too.
  if (dayModal) dayModal.addEventListener("click", function (e) { if (e.target === dayModal) closeDayModal(); });
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Escape" || e.keyCode === 27) && dayModal && dayModal.classList.contains("open")) closeDayModal();
  });

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
      container.innerHTML = '<div style="opacity:0.6">' + (calNotConfigured ? "Calendar not configured" : (calLoaded ? "No events today" : "Loading…")) + "</div>";
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

  /* ===== MEDIA: shared state, volume, source buttons ===== */
  var isPlaying = false;          // demo player state (used only when Spotify isn't connected)
  var activeSource = "spotify";   // "spotify" or "youtube" (which panel shows)
  var volumeLevel = 60;
  var isMuted = false;
  var connectedOutput = "Bluetooth Speaker";

  var playBtn = $("play-btn");
  var prevBtn = $("prev-btn");
  var nextBtn = $("next-btn");
  var volumeSlider = document.querySelector(".volume-slider");
  var muteBtn = document.querySelector(".mute-btn");
  var outputText = document.querySelector(".media-output strong");

  // Paint the filled part of the (custom-styled) volume slider.
  function paintVolume() {
    if (!volumeSlider) return;
    var v = Math.max(0, Math.min(100, Number(volumeSlider.value) || 0));
    volumeSlider.style.backgroundSize = v + "% 14px, 100% 14px";
  }

  function fmtDuration(ms) {
    var s = Math.max(0, Math.floor((ms || 0) / 1000));
    return Math.floor(s / 60) + ":" + pad2(s % 60);
  }

  // One place decides what the Media page and the Home "now playing" card say.
  function updateNowPlaying() {
    var home = "Not Playing";
    if (youtube.isPlaying()) {
      home = "YouTube · " + (youtube.title() || "Playing");
    } else if (spotify.connected()) {
      home = spotify.homeText();
    } else if (isPlaying) {
      home = String(activeSource).toUpperCase() + " · Playing";
    }
    if (!spotify.connected()) {
      setText("play-status", isPlaying ? "Playing" : "Not Playing");
      setText("track-info", isPlaying ? "Demo Track · Demo Artist" : "Artist · Album");
      toggleClass(playBtn, "paused", isPlaying);
    }
    setText("home-nowplaying-text", home);
    var out = spotify.deviceName() || connectedOutput;
    if (outputText && outputText.textContent !== out) outputText.textContent = out;
  }

  function showMediaPanel(source) {
    activeSource = source === "youtube" ? "youtube" : "spotify";
    store.set("activeSource", activeSource);
    var sp = $("spotify-panel"), yt = $("youtube-panel");
    if (sp) sp.style.display = activeSource === "spotify" ? "" : "none";
    if (yt) yt.style.display = activeSource === "youtube" ? "" : "none";
    each(document.querySelectorAll(".shortcut-btn"), function (b) {
      toggleClass(b, "active", b.getAttribute("data-source") === activeSource);
    });
    if (activeSource === "youtube") youtube.onShow();
    updateNowPlaying();
  }

  each(document.querySelectorAll(".shortcut-btn"), function (btn) {
    btn.addEventListener("click", function () {
      var src = btn.getAttribute("data-source");
      if (src === "bluetooth") { bluetooth.open(); return; }
      showMediaPanel(src);
    });
  });

  // Volume goes to whichever player is in use: YouTube, Spotify, or (demo) nothing.
  function applyVolume(v) {
    if (activeSource === "youtube" && youtube.hasPlayer()) youtube.setVolume(v);
    else if (spotify.connected()) spotify.setVolume(v);
  }

  function onVolumeInput() {
    var v = Number(volumeSlider.value);
    isMuted = v === 0;
    if (!isMuted) volumeLevel = v; // remember last non-zero level for un-mute
    toggleClass(muteBtn, "active", isMuted);
    store.set("volumeLevel", volumeLevel);
    store.set("isMuted", isMuted);
    paintVolume();
    applyVolume(v);
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
    applyVolume(isMuted ? 0 : (volumeLevel || 60));
  });

  if (playBtn) playBtn.addEventListener("click", function () {
    if (spotify.connected()) { spotify.togglePlay(); return; }
    isPlaying = !isPlaying;
    store.set("isPlaying", isPlaying);
    updateNowPlaying();
  });
  if (prevBtn) prevBtn.addEventListener("click", function () { if (spotify.connected()) spotify.command("previous"); });
  if (nextBtn) nextBtn.addEventListener("click", function () { if (spotify.connected()) spotify.command("next"); });

  /* ===== SHA-256 (for Spotify's PKCE sign-in; old WebViews have no crypto.subtle) ===== */
  var sha256 = (function () {
    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
    // ASCII input only (the PKCE verifier is [A-Za-z0-9-._~]); returns an array of 32 bytes.
    return function (str) {
      var bytes = [], i;
      for (i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
      var bitLen = bytes.length * 8;
      bytes.push(0x80);
      while (bytes.length % 64 !== 56) bytes.push(0);
      for (i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 0xff);
      var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
      var W = new Array(64);
      for (var off = 0; off < bytes.length; off += 64) {
        for (i = 0; i < 16; i++) {
          W[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
        }
        for (i = 16; i < 64; i++) {
          var s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
          var s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
          W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
        }
        var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (i = 0; i < 64; i++) {
          var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
          var ch = (e & f) ^ (~e & g);
          var t1 = (h + S1 + ch + K[i] + W[i]) | 0;
          var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
          var maj = (a & b) ^ (a & c) ^ (b & c);
          var t2 = (S0 + maj) | 0;
          h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
      }
      var out = [];
      for (i = 0; i < 8; i++) out.push((H[i] >>> 24) & 0xff, (H[i] >>> 16) & 0xff, (H[i] >>> 8) & 0xff, H[i] & 0xff);
      return out;
    };
  })();

  function base64url(bytes) {
    var bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return window.btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function randomString(len) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    var out = "", vals = null, i;
    var c = window.crypto || window.msCrypto;
    if (c && c.getRandomValues) { vals = new window.Uint8Array(len); c.getRandomValues(vals); }
    for (i = 0; i < len; i++) out += chars.charAt((vals ? vals[i] : Math.floor(Math.random() * 256)) % chars.length);
    return out;
  }

  function formEncode(obj) {
    var parts = [];
    for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) {
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]));
    }
    return parts.join("&");
  }

  function parseQuery(qs) {
    var out = {};
    each(String(qs || "").replace(/^\?/, "").split("&"), function (p) {
      if (!p) return;
      var i = p.indexOf("=");
      var k = decodeURIComponent((i < 0 ? p : p.slice(0, i)).replace(/\+/g, " "));
      out[k] = i < 0 ? "" : decodeURIComponent(p.slice(i + 1).replace(/\+/g, " "));
    });
    return out;
  }

  /*
   * Small XHR helper for Spotify (needs methods + headers + bodies).
   * cb(err, data, status, xhr); err has .status, .reason (e.g. PREMIUM_REQUIRED), .retryAfter.
   */
  function request(method, url, headers, body, cb) {
    var xhr = new XMLHttpRequest();
    var finished = false;
    function finish(err, data) {
      if (finished) return;
      finished = true;
      cb(err, data, xhr.status, xhr);
    }
    try {
      xhr.open(method, url, true);
      xhr.timeout = 15000;
      for (var h in headers) if (Object.prototype.hasOwnProperty.call(headers, h)) xhr.setRequestHeader(h, headers[h]);
      xhr.onload = function () {
        var data = null;
        if (xhr.responseText) { try { data = JSON.parse(xhr.responseText); } catch (e) { /* not JSON */ } }
        if (xhr.status >= 200 && xhr.status < 300) return finish(null, data);
        var e2 = data && data.error;
        var err = new Error((e2 && (e2.message || e2)) || (data && data.error_description) || ("HTTP " + xhr.status));
        err.status = xhr.status;
        err.reason = (e2 && e2.reason) || (data && typeof data.error === "string" ? data.error : "");
        err.retryAfter = 0;
        if (xhr.status === 429) { try { err.retryAfter = Number(xhr.getResponseHeader("Retry-After")) || 0; } catch (e3) { /* not exposed */ } }
        finish(err, data);
      };
      xhr.onerror = function () { var e = new Error("Network error"); e.status = 0; finish(e); };
      xhr.ontimeout = function () { var e = new Error("Timed out"); e.status = 0; finish(e); };
      xhr.send(body === undefined ? null : body);
    } catch (e) {
      e.status = 0;
      finish(e);
    }
  }

  /* ===== SPOTIFY (now playing + remote; Authorization Code with PKCE, no secret) ===== */
  var spotify = (function () {
    var CLIENT_ID = String(CFG.SPOTIFY_CLIENT_ID || "");
    var ACCOUNTS = "https://accounts.spotify.com";
    var API = "https://api.spotify.com/v1";
    var SCOPES = "user-read-currently-playing user-read-playback-state user-modify-playback-state";
    var FAST_MS = 5000, SLOW_MS = 30000, IDLE_MS = 60000;
    var CAN_USE = !IS_FILE && !!CLIENT_ID && !!window.btoa;

    var state = null;        // last /me/player response (null = nothing playing)
    var stateAt = 0;         // when it was fetched (to advance the progress bar)
    var message = "";
    var pollTimer = null, tickTimer = null, volTimer = null;
    var polling = false;
    var refreshing = null;   // queued callbacks while a token refresh is running

    function redirectUri() {
      if (CFG.SPOTIFY_REDIRECT_URI) return String(CFG.SPOTIFY_REDIRECT_URI);
      var base = window.location.protocol + "//" + window.location.host +
        window.location.pathname.replace(/[^/]*$/, "");
      return base + "spotify-callback";
    }
    function connected() { return CAN_USE && !!store.get("sp_refresh"); }

    function setMessage(text) {
      message = text || "";
      setText("sp-message", message);
    }

    function saveTokens(t) {
      if (t.access_token) store.set("sp_access", t.access_token);
      if (t.refresh_token) store.set("sp_refresh", t.refresh_token);
      store.set("sp_expires", Date.now() + (Number(t.expires_in) || 3600) * 1000);
    }

    function forget() {
      try {
        each(["sp_access", "sp_refresh", "sp_expires", "sp_verifier", "sp_state"], function (k) {
          window.localStorage.removeItem(k);
        });
      } catch (e) { /* ignore */ }
      state = null;
    }

    function login() {
      if (!CAN_USE) return;
      var verifier = randomString(64);
      var st = randomString(16);
      store.set("sp_verifier", verifier);
      store.set("sp_state", st);
      window.location.href = ACCOUNTS + "/authorize?" + formEncode({
        client_id: CLIENT_ID,
        response_type: "code",
        redirect_uri: redirectUri(),
        code_challenge_method: "S256",
        code_challenge: base64url(sha256(verifier)),
        scope: SCOPES,
        state: st
      });
    }

    // Back from Spotify's sign-in page (…/spotify-callback?code=…&state=…).
    function handleCallback() {
      if (!/spotify-callback\/?$/.test(window.location.pathname)) return false;
      var q = parseQuery(window.location.search);
      var verifier = store.get("sp_verifier");
      var home = window.location.pathname.replace(/spotify-callback\/?$/, "");
      try { window.history.replaceState(null, "", home || "/"); } catch (e) { /* ignore */ }
      if (!CAN_USE) return true;
      if (q.error || !q.code || !verifier || q.state !== store.get("sp_state")) {
        setMessage(q.error === "access_denied" ? "Spotify sign-in was cancelled." : "Spotify sign-in didn't complete. Try Connect again.");
        return true;
      }
      setMessage("Connecting to Spotify…");
      request("POST", ACCOUNTS + "/api/token", { "Content-Type": "application/x-www-form-urlencoded" }, formEncode({
        grant_type: "authorization_code",
        code: q.code,
        redirect_uri: redirectUri(),
        client_id: CLIENT_ID,
        code_verifier: verifier
      }), function (err, data) {
        try { window.localStorage.removeItem("sp_verifier"); window.localStorage.removeItem("sp_state"); } catch (e) { /* ignore */ }
        if (err || !data || !data.refresh_token) {
          setMessage("Spotify sign-in failed (" + (err ? err.message : "no token") + "). Try Connect again.");
          render();
          return;
        }
        saveTokens(data);
        setMessage("");
        render();
        poll();
      });
      return true;
    }

    // cb(err, accessToken). Refreshes when the token is (nearly) expired or force is set.
    function withToken(cb, force) {
      var access = store.get("sp_access");
      if (!force && access && Number(store.get("sp_expires")) - 60000 > Date.now()) return cb(null, access);
      if (refreshing) { refreshing.push(cb); return; }
      refreshing = [cb];
      request("POST", ACCOUNTS + "/api/token", { "Content-Type": "application/x-www-form-urlencoded" }, formEncode({
        grant_type: "refresh_token",
        refresh_token: store.get("sp_refresh") || "",
        client_id: CLIENT_ID
      }), function (err, data) {
        var waiting = refreshing; refreshing = null;
        if (!err && data && data.access_token) saveTokens(data);
        else if (err && err.status === 400) {
          // refresh token revoked/expired: must sign in again
          forget();
          setMessage("Spotify sign-in expired. Tap Connect Spotify again.");
          render();
        }
        each(waiting, function (fn) { fn(err || (data && data.access_token ? null : new Error("No token")), data && data.access_token); });
      });
    }

    // Call the Web API; retries once with a fresh token on 401.
    function api(method, path, body, cb, retried) {
      withToken(function (err, token) {
        if (err) return cb(err);
        var headers = { "Authorization": "Bearer " + token };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        request(method, API + path, headers, body === undefined ? undefined : JSON.stringify(body), function (e, data, status) {
          if (e && e.status === 401 && !retried) {
            return withToken(function (e2) { if (e2) return cb(e2); api(method, path, body, cb, true); }, true);
          }
          cb(e, data, status);
        });
      });
    }

    function pageVisible() {
      return !isHidden() && (currentPage === "media" || currentPage === "home");
    }

    function schedulePoll(ms) {
      clearTimeout(pollTimer);
      if (!connected()) return;
      if (ms === undefined) ms = pageVisible() ? FAST_MS : (isHidden() ? IDLE_MS : SLOW_MS);
      pollTimer = setTimeout(poll, ms);
    }

    function poll() {
      clearTimeout(pollTimer);
      if (!connected() || polling) return;
      polling = true;
      api("GET", "/me/player?additional_types=episode", undefined, function (err, data, status) {
        polling = false;
        if (!err) {
          state = (status === 204 || !data) ? null : data;
          stateAt = Date.now();
          if (message && !/Premium/.test(message)) setMessage("");
          render();
          schedulePoll();
          return;
        }
        if (err.status === 429) { schedulePoll(Math.max(err.retryAfter * 1000, SLOW_MS)); return; }
        if (err.status === 403 && /premium/i.test(err.message + " " + err.reason)) setMessage("Controls need Spotify Premium");
        else if (err.status === 403) setMessage("Spotify said no (" + err.message + "). Is this account on the app's user list?");
        else if (connected() && err.status) setMessage("Spotify: " + err.message);
        render();
        schedulePoll(SLOW_MS);
      });
    }

    function onCommandError(err) {
      if (!err) { setMessage(""); return; }
      if (err.status === 403 && /premium/i.test(err.message + " " + err.reason)) setMessage("Controls need Spotify Premium");
      else if (err.status === 404 || err.reason === "NO_ACTIVE_DEVICE") setMessage("No active Spotify device. Start playing on a phone or speaker first.");
      else if (err.status === 429) setMessage("Spotify is busy, try again in a moment.");
      else setMessage("Spotify: " + err.message);
    }

    function command(which) {
      var map = { next: ["POST", "/me/player/next"], previous: ["POST", "/me/player/previous"],
                  play: ["PUT", "/me/player/play"], pause: ["PUT", "/me/player/pause"] };
      var m = map[which];
      if (!m) return;
      api(m[0], m[1], undefined, function (err) {
        onCommandError(err);
        if (err) { render(); return; }
        schedulePoll(600); // pick up the new track/state quickly
      });
    }

    function togglePlay() {
      var playing = !!(state && state.is_playing);
      if (state) { // optimistic update so the button responds instantly
        state.progress_ms = progressNow();
        stateAt = Date.now();
        state.is_playing = !playing;
        render();
      }
      var m = playing ? "pause" : "play";
      api("PUT", "/me/player/" + m, undefined, function (err) {
        if (err && state) { state.is_playing = playing; }
        onCommandError(err);
        render();
        schedulePoll(800);
      });
    }

    function setVolume(v) {
      clearTimeout(volTimer);
      volTimer = setTimeout(function () {
        api("PUT", "/me/player/volume?volume_percent=" + Math.round(v), undefined, function (err) {
          onCommandError(err);
        });
      }, 400);
    }

    function progressNow() {
      if (!state || !state.item) return 0;
      var p = state.progress_ms || 0;
      if (state.is_playing) p += Date.now() - stateAt;
      return Math.min(p, state.item.duration_ms || p);
    }

    function trackLine(item) {
      if (!item) return "";
      if (item.type === "episode") return (item.show && item.show.name) || "Podcast";
      var artists = [];
      each(item.artists, function (a) { artists.push(a.name); });
      return artists.join(", ") + (item.album && item.album.name ? " · " + item.album.name : "");
    }

    function artUrl(item) {
      var imgs = (item && ((item.album && item.album.images) || item.images)) || [];
      if (!imgs.length) return "";
      // ~300px image (index 1) is plenty for the card; fall back to whatever exists
      return (imgs[1] || imgs[0]).url || "";
    }

    function renderProgress() {
      var item = state && state.item;
      var dur = item ? item.duration_ms || 0 : 0;
      var pos = progressNow();
      var bar = $("sp-progress-bar");
      if (bar) bar.style.width = (dur ? Math.min(100, pos / dur * 100) : 0).toFixed(2) + "%";
      setText("sp-pos", fmtDuration(pos));
      setText("sp-dur", fmtDuration(dur));
    }

    function tick() {
      clearTimeout(tickTimer);
      if (!connected() || !state || !state.is_playing || !pageVisible()) return;
      renderProgress();
      var item = state.item;
      // song probably ended: ask Spotify what's next
      if (item && progressNow() >= item.duration_ms && !polling) schedulePoll(1000);
      tickTimer = setTimeout(tick, 1000);
    }

    function render() {
      var on = connected();
      var connectBtn = $("sp-connect"), discBtn = $("sp-disconnect"), note = $("demo-note");
      if (connectBtn) connectBtn.style.display = (!on && CAN_USE) ? "" : "none";
      if (discBtn) discBtn.style.display = on ? "" : "none";
      if (note) note.style.display = on ? "none" : "";
      var wrap = $("sp-progress-wrap");
      var art = $("sp-art");
      var panel = $("spotify-panel");
      toggleClass(panel, "sp-connected", on);
      if (!on) {
        if (wrap) wrap.style.display = "none";
        if (art) { art.removeAttribute("src"); art.style.display = "none"; }
        updateNowPlaying();
        return;
      }
      var item = state && state.item;
      if (item) {
        setText("play-status", item.name);
        setText("track-info", trackLine(item));
      } else {
        setText("play-status", "Nothing playing on Spotify");
        setText("track-info", "Start something on a phone or speaker");
      }
      toggleClass(playBtn, "paused", !!(state && state.is_playing));
      var src = artUrl(item);
      if (art) {
        if (src) { if (art.getAttribute("src") !== src) art.setAttribute("src", src); art.style.display = "block"; }
        else { art.removeAttribute("src"); art.style.display = "none"; }
      }
      if (wrap) wrap.style.display = item ? "block" : "none";
      renderProgress();
      var dev = state && state.device;
      if (dev && typeof dev.volume_percent === "number" && volumeSlider && activeSource === "spotify" &&
          !volTimer && document.activeElement !== volumeSlider) {
        // keep the slider in step with the speaker (unless the user is dragging it)
        volumeSlider.value = dev.volume_percent;
        paintVolume();
      }
      updateNowPlaying();
      tick();
    }

    function homeText() {
      var item = state && state.item;
      if (!item) return "Spotify · Nothing playing";
      return (state.is_playing ? "" : "Paused · ") + item.name + " — " + trackLine(item).split(" · ")[0];
    }

    function deviceName() { return connected() && state && state.device ? state.device.name : ""; }

    function init() {
      if ($("sp-connect")) $("sp-connect").addEventListener("click", login);
      if ($("sp-disconnect")) $("sp-disconnect").addEventListener("click", function () {
        forget();
        setMessage("Spotify disconnected.");
        clearTimeout(pollTimer);
        render();
      });
      var fromCallback = handleCallback();
      render();
      if (connected() && !fromCallback) poll();
      return fromCallback;
    }

    return {
      init: init, connected: connected, command: command, togglePlay: togglePlay, setVolume: setVolume,
      homeText: homeText, deviceName: deviceName,
      onPageChange: function () { if (connected()) { schedulePoll(currentPage === "media" ? 300 : undefined); tick(); } },
      refresh: function () { if (connected()) poll(); }
    };
  })();

  /* ===== YOUTUBE (IFrame player on the Media page) ===== */
  var youtube = (function () {
    var player = null, ready = false, apiLoading = false, apiWaiters = [];
    var playing = false, currentTitle = "";
    var FAVS = (CFG.YOUTUBE_FAVORITES && CFG.YOUTUBE_FAVORITES.length) ? CFG.YOUTUBE_FAVORITES : [];
    var favsDrawn = false;

    // Accepts a bare 11-character ID or any common YouTube link.
    function parseId(text) {
      text = String(text || "").replace(/^\s+|\s+$/g, "");
      if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;
      var m = text.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/|\/v\/)([A-Za-z0-9_-]{11})/);
      return m ? m[1] : "";
    }

    function msg(text) { setText("yt-msg", text || ""); }

    function loadApi(cb) {
      if (window.YT && window.YT.Player) return cb(null);
      apiWaiters.push(cb);
      if (apiLoading) return;
      apiLoading = true;
      var prev = window.onYouTubeIframeAPIReady;
      var timer = setTimeout(function () { flush(new Error("YouTube didn't load (offline?)")); }, 20000);
      function flush(err) {
        clearTimeout(timer);
        if (err) apiLoading = false;
        var w = apiWaiters; apiWaiters = [];
        each(w, function (fn) { fn(err); });
      }
      window.onYouTubeIframeAPIReady = function () {
        if (typeof prev === "function") { try { prev(); } catch (e) { /* ignore */ } }
        flush(null);
      };
      var s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      s.onerror = function () { if (s.parentNode) s.parentNode.removeChild(s); flush(new Error("YouTube couldn't be reached (offline?)")); };
      document.getElementsByTagName("head")[0].appendChild(s);
    }

    function errorText(code) {
      if (code === 2) return "That doesn't look like a valid YouTube video.";
      if (code === 5) return "This video can't play in this browser.";
      if (code === 100) return "Video not found (removed or private).";
      if (code === 101 || code === 150) return "The owner doesn't allow this video to play outside YouTube. Try another one.";
      if (code === 152 || code === 153) return "YouTube refused to play here (it needs the site address). Use the https Netlify site, not a local file.";
      return "YouTube error " + code + ".";
    }

    function setPlaying(on) {
      playing = on;
      if (on) {
        try { var d = player.getVideoData(); currentTitle = (d && d.title) || currentTitle; } catch (e) { /* ignore */ }
      }
      updateNowPlaying();
    }

    function play(id) {
      if (!id) { msg("Paste a YouTube link (youtu.be/…, youtube.com/watch?v=…) or an 11-character video ID."); return; }
      msg("Loading…");
      var ph = $("yt-placeholder");
      if (ph) ph.style.display = "none";
      toggleClass($("yt-wrap"), "has-video", true);
      currentTitle = "";
      store.set("ytLast", id);
      loadApi(function (err) {
        if (err) { msg(err.message); if (ph) ph.style.display = ""; return; }
        if (player && ready) { player.loadVideoById(id); msg(""); return; }
        if (player) { try { player.destroy(); } catch (e) { /* ignore */ } player = null; }
        ensureHost();
        var origin = window.location.protocol + "//" + window.location.host;
        player = new window.YT.Player("yt-player", {
          width: "100%", height: "100%", videoId: id,
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, fs: 1, origin: origin },
          events: {
            onReady: function () {
              ready = true;
              msg("");
              try {
                player.setVolume(isMuted ? 0 : volumeLevel);
                player.playVideo();
              } catch (e) { /* ignore */ }
            },
            onStateChange: function (ev) {
              // 1 = playing, 2 = paused, 0 = ended
              setPlaying(ev.data === 1 || (ev.data === 3 && playing));
              if (ev.data === 1) msg("");
            },
            onError: function (ev) { msg(errorText(ev.data)); setPlaying(false); }
          }
        });
      });
    }

    function ensureHost() {
      if ($("yt-player")) return;
      var d = document.createElement("div");
      d.id = "yt-player";
      var wrap = $("yt-wrap");
      if (wrap) wrap.insertBefore(d, wrap.firstChild);
    }

    function stop() {
      exitMax();
      if (player) { try { player.destroy(); } catch (e) { /* ignore */ } }
      player = null; ready = false;
      ensureHost();
      var ph = $("yt-placeholder");
      if (ph) ph.style.display = "";
      toggleClass($("yt-wrap"), "has-video", false);
      msg("");
      setPlaying(false);
    }

    // Fullscreen: real Fullscreen API where it exists (incl. old webkit names);
    // otherwise (e.g. Fully Kiosk WebView) stretch the player over the whole screen.
    function fsElement() {
      return document.fullscreenElement || document.webkitFullscreenElement || document.webkitCurrentFullScreenElement || null;
    }
    function exitMax() {
      var wrap = $("yt-wrap");
      if (wrap && wrap.classList.contains("yt-max")) { wrap.classList.remove("yt-max"); document.body.classList.remove("yt-max-open"); }
      if (fsElement()) {
        try {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
          else if (document.webkitCancelFullScreen) document.webkitCancelFullScreen();
        } catch (e) { /* ignore */ }
      }
    }
    function toggleFullscreen() {
      var wrap = $("yt-wrap");
      if (!wrap) return;
      if (fsElement() || wrap.classList.contains("yt-max")) { exitMax(); return; }
      var req = wrap.requestFullscreen || wrap.webkitRequestFullscreen || wrap.webkitRequestFullScreen;
      var fallback = function () { wrap.classList.add("yt-max"); document.body.classList.add("yt-max-open"); };
      if (!req || !(document.fullscreenEnabled || document.webkitFullscreenEnabled)) { fallback(); return; }
      try {
        var p = req.call(wrap);
        if (p && typeof p.then === "function") p.then(null, fallback);
      } catch (e) { fallback(); }
    }

    function drawFavs() {
      if (favsDrawn) return;
      favsDrawn = true;
      var box = $("yt-favs");
      if (!box) return;
      if (!FAVS.length) { box.style.display = "none"; return; }
      each(FAVS, function (f) {
        var id = parseId(f && (f.id || f.url));
        if (!id) return;
        var b = document.createElement("button");
        b.className = "yt-fav";
        b.textContent = (f && f.title) || id;
        b.addEventListener("click", function () { play(id); });
        box.appendChild(b);
      });
    }

    function init() {
      var go = $("yt-go"), input = $("yt-input");
      if (go) go.addEventListener("click", function () { play(parseId(input && input.value)); if (input) input.blur(); });
      if (input) input.addEventListener("keydown", function (e) {
        if (e.keyCode === 13) { play(parseId(input.value)); input.blur(); }
      });
      if ($("yt-fs")) $("yt-fs").addEventListener("click", toggleFullscreen);
      if ($("yt-stop")) $("yt-stop").addEventListener("click", stop);
      document.addEventListener("keydown", function (e) { if (e.keyCode === 27) exitMax(); });
    }

    return {
      init: init, play: play, stop: stop, parseId: parseId,
      onShow: drawFavs,
      isPlaying: function () { return playing; },
      title: function () { return currentTitle; },
      hasPlayer: function () { return !!(player && ready); },
      setVolume: function (v) {
        try { if (v > 0) { player.unMute(); player.setVolume(v); } else player.mute(); } catch (e) { /* ignore */ }
      }
    };
  })();

  /* ===== BLUETOOTH button ===== */
  // Android can't be told to pair a speaker from a web page, but it can open the Bluetooth
  // settings screen. Fully Kiosk does this via its JavaScript Interface (PLUS licence) or
  // via an intent: link (free "Open Other URL Schemes" setting). Otherwise show a how-to.
  var bluetooth = (function () {
    var INTENT = "intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;end";
    function intentWithFallback() {
      // Chrome goes to browser_fallback_url if it can't open the intent (instead of an error page).
      var back = window.location.href.split("#")[0];
      return "intent:#Intent;action=android.settings.BLUETOOTH_SETTINGS;S.browser_fallback_url=" +
        encodeURIComponent(back) + ";end";
    }
    var helpOpen = false, returnFocus = null;
    function showHelp(on) {
      var h = $("bt-help");
      if (!h) return;
      h.style.display = on ? "" : "none";
      if (on && !helpOpen) {
        returnFocus = document.activeElement;
        var first = $("bt-close") || $("bt-try");
        if (first && first.focus) first.focus();
      } else if (!on && helpOpen && returnFocus && returnFocus.focus) {
        try { returnFocus.focus(); } catch (e) { /* element may be gone */ }
        returnFocus = null;
      }
      helpOpen = !!on;
    }
    function tryIntentUrl() {
      window.location.href = intentWithFallback();
    }
    function open() {
      var f = window.fully;
      if (f && typeof f.startIntent === "function") {
        try { f.startIntent(INTENT); return; } catch (e) { /* fall through to the how-to */ }
      }
      if (CFG.BLUETOOTH_OPEN_VIA_INTENT_URL === true) { tryIntentUrl(); return; }
      showHelp(true);
    }
    function init() {
      if ($("bt-close")) $("bt-close").addEventListener("click", function () { showHelp(false); });
      if ($("bt-try")) $("bt-try").addEventListener("click", function () { showHelp(false); tryIntentUrl(); });
      if ($("bt-help")) $("bt-help").addEventListener("click", function (e) { if (e.target === $("bt-help")) showHelp(false); });
      // Esc closes the how-to. Capture phase so it wins over the day modal underneath it.
      document.addEventListener("keydown", function (e) {
        if (helpOpen && (e.keyCode === 27 || e.key === "Escape")) {
          showHelp(false);
          if (e.stopPropagation) e.stopPropagation();
          if (e.preventDefault) e.preventDefault();
        }
      }, true);
    }
    return { init: init, open: open, INTENT: INTENT };
  })();

  function restoreMediaState() {
    var savedPlaying = store.get("isPlaying");
    if (savedPlaying !== null) isPlaying = savedPlaying === "true";
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
    var savedOutput = store.get("connectedOutput");
    if (savedOutput) connectedOutput = savedOutput;
    var savedSource = store.get("activeSource");
    youtube.init();
    bluetooth.init();
    var fromCallback = spotify.init();
    showMediaPanel(fromCallback ? "spotify" : (savedSource === "youtube" ? "youtube" : "spotify"));
    paintVolume();
    return fromCallback;
  }
  var cameFromSpotify = restoreMediaState();
  // debug/testing hook (harmless): lets tests and the console reach the media modules
  window.__dashMedia = { spotify: spotify, youtube: youtube, bluetooth: bluetooth, sha256: sha256, base64url: base64url };

  /* ===== RECOVERY ===== */
  // Back online after a Wi-Fi drop: refresh anything that has gone stale.
  window.addEventListener("online", function () { refreshStale(60 * 1000); spotify.refresh(); });

  // Screen turned back on: resume the slideshow and refresh stale data.
  function onVisibility() {
    slideshow.schedule();
    if (!isHidden()) { refreshStale(5 * 60 * 1000); spotify.onPageChange(); }
  }
  document.addEventListener("visibilitychange", onVisibility);
  document.addEventListener("webkitvisibilitychange", onVisibility);

  /*
   * Offline / stale-data badge: tells you when the weather or calendar on
   * screen is old (Wi-Fi down, API failing), so stale data isn't mistaken
   * for current data.
   */
  var statusSources = [
    { label: "Weather", task: weatherTask, maxAge: 30 * 60 * 1000, on: function () { return !weatherNotConfigured; } },
    { label: "Calendar", task: calendarTask, maxAge: 45 * 60 * 1000, on: function () { return !calNotConfigured; } }
  ];
  function whenText(ms) {
    var d = new Date(ms);
    var sameDay = dayKey(d) === dayKey(new Date());
    return (sameDay ? "" : d.toLocaleDateString([], { weekday: "short" }) + " ") + fmtTime(d);
  }
  function updateStatus() {
    var badge = $("status-badge");
    if (!badge) return;
    var now = Date.now();
    var offline = navigator.onLine === false;
    var parts = [];
    var oldest = 0;
    each(statusSources, function (s) {
      if (!s.on() || !s.task.lastOk) return;
      if (!oldest || s.task.lastOk < oldest) oldest = s.task.lastOk;
      if (now - s.task.lastOk > s.maxAge) parts.push(s.label + " last updated " + whenText(s.task.lastOk));
    });
    var text = offline ? "Offline" + (oldest ? " \u00b7 last updated " + whenText(oldest) : "") : parts.join(" \u00b7 ");
    setText("status-badge", text);
    toggleClass(badge, "show", !!text);
  }
  window.addEventListener("online", function () { setTimeout(updateStatus, 0); });
  window.addEventListener("offline", updateStatus);
  setInterval(updateStatus, 15000);

  /* ===== OFFLINE START-UP (service worker) ===== */
  // Caches the app so it still opens if Wi-Fi is down when the tablet boots.
  // Only where supported (Chrome 40+) and allowed (https or localhost).
  (function registerServiceWorker() {
    var secure = window.location.protocol === "https:" ||
      /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    if (!secure || !("serviceWorker" in navigator) || !window.Promise) return;
    try {
      navigator.serviceWorker.register("sw.js")["catch"](function (e) {
        if (window.console) console.warn("Service worker not registered:", e && e.message);
      });
    } catch (e) { /* ignore */ }
  })();

  /* ===== INIT ===== */
  showPage(cameFromSpotify ? "media" : "home");
  renderCalendarAll();
  weatherTask.run();
  calendarTask.run();
  photosTask.run();
  if (!HAS_CONFIG) {
    setText("home-desc", "config.js missing");
    setText("weather-desc", "config.js missing");
    if (window.console) console.error("config.js is missing: it should sit next to index.html (see README)");
  }
})();
