/**********************
 * PAGE NAVIGATION
 **********************/

function showPage(pageId) {

  // Hide all pages
  document.querySelectorAll('.page').forEach(p =>
    p.classList.remove('active')
  );

  // Remove active state from sidebar buttons
  document.querySelectorAll('.nav-btn').forEach(b =>
    b.classList.remove('active')
  );

  // Show selected page
  document.getElementById(pageId).classList.add('active');

  // Highlight correct sidebar button
  document.querySelectorAll('.nav-btn').forEach(btn => {
    if (btn.onclick.toString().includes(pageId)) {
      btn.classList.add('active');
    }
  });

  // Toggle home-specific body class
  document.body.classList.toggle("home-active", pageId === "home");

  // Close sidebar when leaving home
  if (pageId !== "home") {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("open");
  }

  // Fullscreen button visibility
  const fsBtn = document.getElementById("fs-btn");
  if (fsBtn) {
    fsBtn.style.display = pageId === "photos" ? "block" : "none";
  }

  // Only load photos when entering photos page
  if (pageId === "photos") {
    loadDrivePhotos();
  }
}

/**********************
 * CLOCK
 **********************/
function updateClock() {
  const now = new Date();

  // Format time
  const timeString = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });

  const dateString = now.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric"
  });

  /* ===== Home Clock ===== */
  const homeTime = document.getElementById("home-time");
  const homeDate = document.getElementById("home-date");

  if (homeTime) homeTime.textContent = timeString;
  if (homeDate) homeDate.textContent = dateString;

  /* ===== Header Clock ===== */
  const headerTime = document.getElementById("time");
  const headerDate = document.getElementById("date");

  if (headerTime) headerTime.textContent = timeString;
  if (headerDate) headerDate.textContent = dateString;
}

updateClock();
setInterval(updateClock, 1000);



/**********************
 * WEATHER
 **********************/
const API_KEY = "1e024bbd575716ce93ea03863c76416f";
const ZIP = "44004";

async function loadWeather() {
  try {
    const current = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?zip=${ZIP},US&units=imperial&appid=${API_KEY}`
    ).then(r => r.json());

// Sunrise & Sunset
const sunrise = new Date(current.sys.sunrise * 1000)
  .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const sunset = new Date(current.sys.sunset * 1000)
  .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

    document.getElementById('weather-temp').textContent = Math.round(current.main.temp) + "°";
    document.getElementById("weather-feels").textContent =
  `Feels like ${Math.round(current.main.feels_like)}°`;
    document.getElementById('weather-desc').textContent = current.weather[0].description;
    document.getElementById('weather-humidity').textContent =
  `${current.main.humidity}%`;
  function windDir(deg) {
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(deg / 45) % 8];
}
document.getElementById("weather-wind").textContent =
  `${windDir(current.wind.deg)} ${Math.round(current.wind.speed)} mph` +
  (current.wind.gust ? ` · Gusts ${Math.round(current.wind.gust)} mph` : "");
  document.getElementById("weather-visibility").textContent =
  `Visibility ${(current.visibility / 1609).toFixed(1)} mi`;
  
  /* ===== HOME WEATHER ===== */
const set = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

set("home-temp", Math.round(current.main.temp) + "°");
set("home-desc", current.weather[0].description);
set("home-feels", "Feels like " + Math.round(current.main.feels_like) + "°");
set("home-humidity", current.main.humidity + "%");
set("home-wind", Math.round(current.wind.speed) + " mph");
set("home-visibility", (current.visibility / 1609).toFixed(1) + " mi");
set("home-sunrise", sunrise);
set("home-sunset", sunset);

    const forecast = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?zip=${ZIP},US&units=imperial&appid=${API_KEY}`
    ).then(r => r.json());

    const hourly = document.getElementById('hourly');
    const daily = document.getElementById('daily');
    hourly.innerHTML = "";
    daily.innerHTML = "";

 forecast.list.slice(0, 8).forEach(f => {

  const date = new Date(f.dt * 1000);

  const time = date.toLocaleString("en-US", {
    hour: "numeric",
    hour12: true
  });

  const temp = Math.round(f.main.temp);

  const rainMM = f.rain?.["3h"] || 0;
  const snowMM = f.snow?.["3h"] || 0;
  const totalMM = rainMM + snowMM;

  const inches =
    totalMM > 0 ? (totalMM / 25.4).toFixed(2) : null;

  const percent = Math.round((f.pop || 0) * 100);

  let precipLabel = "Dry";

  if (totalMM > 0 && percent > 0) {
    precipLabel = `${inches}" · ${percent}%`;
  } else if (percent > 0) {
    precipLabel = `${percent}%`;
  }

  hourly.innerHTML += `
    <div class="hour">
      <div class="hour-time">${time}</div>
      <div class="hour-temp">${temp}°</div>
      <div class="hour-precip">${precipLabel}</div>
    </div>
  `;
});

    const days = {};

forecast.list.forEach(f => {
  const dayKey = new Date(f.dt * 1000).toDateString();

  if (!days[dayKey]) {
    days[dayKey] = {
      temps: [],
      rain: 0,
      snow: 0,
      pop: 0
    };
  }

  days[dayKey].temps.push(f.main.temp);
  days[dayKey].rain += f.rain?.["3h"] || 0;
  days[dayKey].snow += f.snow?.["3h"] || 0;
  days[dayKey].pop = Math.max(days[dayKey].pop, f.pop || 0);
});

Object.entries(days).slice(0, 6).forEach(([day, d]) => {
  const hi = Math.round(Math.max(...d.temps));
  const lo = Math.round(Math.min(...d.temps));

  const inches = ((d.rain + d.snow) / 25.4).toFixed(2);
  const percent = Math.round(d.pop * 100);

  const label = new Date(day).toLocaleDateString([], {
    weekday: "short"
  });

  daily.innerHTML += `
    <div class="day">
      <div class="day-name">${label}</div>
      <div class="day-temp">${hi}° / ${lo}°</div>
      <div class="day-precip">${inches}" · ${percent}%</div>
    </div>
  `;
});

  } catch (e) {
    console.error("Weather failed:", e);
  }
}

loadWeather();

// Is music playing?
let isPlaying = false;

// Grab things from the page
const playBtn = document.getElementById("play-btn");
const playStatus = document.getElementById("play-status");
const trackInfo = document.getElementById("track-info");

// When the play button is clicked…
playBtn.addEventListener("click", () => {
  isPlaying = !isPlaying;

  // Switch the icon
  playBtn.classList.toggle("paused", isPlaying);

  if (isPlaying) {
    playStatus.textContent = "Playing";
    trackInfo.textContent = "Demo Track · Demo Artist";
  } else {
    playStatus.textContent = "Not Playing";
    trackInfo.textContent = "Artist · Album";
    
    localStorage.setItem("isPlaying", isPlaying);
  }
});

let activeSource = "spotify"; // default
localStorage.setItem("activeSource", activeSource);

let volumeLevel = 60;
let isMuted = false;

const volumeSlider = document.querySelector(".volume-slider");
const muteBtn = document.querySelector(".mute-btn");

volumeSlider.addEventListener("input", () => {
  volumeLevel = volumeSlider.value;

  if (volumeLevel > 0) {
    isMuted = false;
    muteBtn.classList.remove("active");
    localStorage.setItem("volumeLevel", volumeLevel);
localStorage.setItem("isMuted", false);
  }
});

muteBtn.addEventListener("click", () => {
  isMuted = !isMuted;

  if (isMuted) {
    volumeSlider.value = 0;
    muteBtn.classList.add("active");
  } else {
    volumeSlider.value = volumeLevel || 60;
    muteBtn.classList.remove("active");
    localStorage.setItem("isMuted", isMuted);
localStorage.setItem("volumeLevel", volumeSlider.value);
  }
});

let connectedOutput = "Living Room Speaker";
localStorage.setItem("connectedOutput", connectedOutput);

const shortcuts = document.querySelectorAll(".shortcut-btn");
const outputText = document.querySelector(".media-output strong");
shortcuts.forEach(btn => {
  btn.addEventListener("click", () => {

    // Clear active state
    shortcuts.forEach(b => b.classList.remove("active"));

    // Set new active
    btn.classList.add("active");

    // Read source name (Spotify / YouTube / BT)
    activeSource = btn.dataset.source;

    // (Optional) update now playing text
    trackInfo.textContent = `${activeSource.toUpperCase()} · Ready`;

  });
});
function updateOutput() {
  const outputText = document.querySelector(".media-output strong");
  outputText.textContent = connectedOutput;
}
updateOutput();

function restoreMediaState() {
  // Play state
  const savedPlaying = localStorage.getItem("isPlaying");
  if (savedPlaying !== null) {
    isPlaying = savedPlaying === "true";
    playBtn.classList.toggle("paused", isPlaying);
    playStatus.textContent = isPlaying ? "Playing" : "Not Playing";
  }

  // Volume
  const savedVolume = localStorage.getItem("volumeLevel");
  if (savedVolume !== null) {
    volumeLevel = savedVolume;
    volumeSlider.value = savedVolume;
  }

  // Mute
  const savedMuted = localStorage.getItem("isMuted");
  if (savedMuted === "true") {
    isMuted = true;
    volumeSlider.value = 0;
    muteBtn.classList.add("active");
  }

  // Active source
  const savedSource = localStorage.getItem("activeSource");
  if (savedSource) {
    activeSource = savedSource;
    shortcuts.forEach(btn => {
      btn.classList.toggle(
        "active",
        btn.dataset.source === savedSource
      );
    });
  }

  // Output device
  const savedOutput = localStorage.getItem("connectedOutput");
  if (savedOutput) {
    connectedOutput = savedOutput;
    updateOutput();
  }
}
restoreMediaState();

/**********************
 * GOOGLE CALENDAR – PUBLIC FEED
 **********************/

const CAL_API_KEY = "AIzaSyBebis1wlON9Tg7JZjB-BI2rLaaPut3OVI";
const CAL_ID = "orioncorey15@gmail.com";

function parseEventDate(ev) {
  if (ev.start.dateTime) {
    return new Date(ev.start.dateTime);
  }

  if (ev.start.date) {
    const parts = ev.start.date.split("-");
    return new Date(
      parseInt(parts[0]),
      parseInt(parts[1]) - 1,
      parseInt(parts[2])
    );
  }

  return null;
}

/* ---------- FETCH EVENTS ---------- */
async function listEvents() {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const range =
      `&timeMin=${startOfMonth.toISOString()}` +
      `&timeMax=${endOfMonth.toISOString()}` +
      `&singleEvents=true&orderBy=startTime`;

    const mainUrl =
      `https://www.googleapis.com/calendar/v3/calendars/${CAL_ID}/events?key=${CAL_API_KEY}${range}`;

    const holidayUrl =
      `https://www.googleapis.com/calendar/v3/calendars/en.usa%23holiday@group.v.calendar.google.com/events?key=${CAL_API_KEY}${range}`;

    const [mainRes, holidayRes] = await Promise.all([
      fetch(mainUrl),
      fetch(holidayUrl)
    ]);

    const mainData = await mainRes.json();
    const holidayData = await holidayRes.json();

    const allEvents = [
      ...(mainData.items || []),
      ...(holidayData.items || [])
    ];

    renderCalendar(allEvents);
    renderToday(allEvents);

  } catch (e) {
    console.log("Calendar fetch failed:", e);
  }
}

/* ---------- MONTH RENDER ---------- */
function renderCalendar(events) {
  const grid = document.getElementById("calendar-grid");
  if (!grid) return;

  grid.innerHTML = "";

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const daysOfWeek = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  daysOfWeek.forEach(day => {
    const header = document.createElement("div");
    header.className = "cal-day-header";
    header.textContent = day;
    grid.appendChild(header);
  });

  const eventMap = {};
  events.forEach(ev => {
  const date = parseEventDate(ev);
  if (!date) return;

  const day = date.getDate();
    if (!eventMap[day]) eventMap[day] = [];
    eventMap[day].push(ev.summary || "Untitled");
  });

  for (let i = 0; i < firstDayOfMonth; i++) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "cal-day empty";
    grid.appendChild(emptyCell);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement("div");
    cell.className = "cal-day";

    const dateLabel = document.createElement("div");
    dateLabel.className = "cal-date";
    dateLabel.textContent = day;
    cell.appendChild(dateLabel);

    if (eventMap[day]) {
      eventMap[day].forEach(title => {
        const evDiv = document.createElement("div");
        evDiv.className = "cal-event";

        const holidayKeywords = [
          "Day","Birthday","Holiday",
          "Christmas","Thanksgiving",
          "Halloween","Easter","New Year"
        ];

        if (holidayKeywords.some(k => title.includes(k))) {
          evDiv.style.background = "#2e7d32";
          evDiv.style.boxShadow = "0 0 8px rgba(46,125,50,0.6)";
        }

        evDiv.textContent = title;
        cell.appendChild(evDiv);
      });
    }

    grid.appendChild(cell);
  }
  /* ===== HOME TODAY CARD ===== */
  const todayContainer = document.getElementById("today-events");
  if (todayContainer) {

    todayContainer.innerHTML = "";

    const today = new Date().getDate();

    if (eventMap[today]) {
      eventMap[today].forEach(title => {
        const evDiv = document.createElement("div");
        evDiv.className = "today-event";
        evDiv.textContent = title;
        todayContainer.appendChild(evDiv);
      });
    } else {
      todayContainer.innerHTML =
        '<div class="no-events">No events today</div>';
    }
  }
}
function renderToday(events) {
  const container = document.getElementById("today-events");
  const dateEl = document.getElementById("today-date");
  if (!container || !dateEl) return;

  container.innerHTML = "";

  const now = new Date();
  const todayString = now.toDateString();

  // Set large readable date
  dateEl.textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric"
  });

  // Filter events for today
  const todaysEvents = events.filter(ev => {
   let evDate;

if (ev.start.dateTime) {
  // Timed event — normal
  evDate = new Date(ev.start.dateTime);
} else {
  // All-day event — parse WITHOUT timezone shift
  const parts = ev.start.date.split("-");
  evDate = new Date(
    parts[0],        // year
    parts[1] - 1,    // month (0 indexed)
    parts[2]         // day
  );
}
    return evDate.toDateString() === todayString;
  });

  if (!todaysEvents.length) {
    container.innerHTML = `<div style="opacity:0.6;">No events today</div>`;
    return;
  }

  // Holidays first
  const holidayKeywords = [
    "Day","Birthday","Holiday",
    "Christmas","Thanksgiving",
    "Halloween","Easter","New Year"
  ];

  todaysEvents.sort((a, b) => {
    const aHoliday = holidayKeywords.some(k => (a.summary || "").includes(k));
    const bHoliday = holidayKeywords.some(k => (b.summary || "").includes(k));
    return bHoliday - aHoliday;
  });

  todaysEvents.forEach(ev => {
    const div = document.createElement("div");
    div.className = "today-event";

    if (holidayKeywords.some(k => (ev.summary || "").includes(k))) {
      div.classList.add("holiday");
    }

    div.textContent = ev.summary || "Untitled";
    container.appendChild(div);
  });
}


/* ---------- INIT ---------- */
window.addEventListener("load", () => {
  listEvents();
});

/**********************
 * GOOGLE DRIVE PHOTO FRAME
 **********************/

const DRIVE_API_KEY = "AIzaSyAUpJiY2rZmrRhXXPEaWK8E6BqXn9scnD8";
const DRIVE_FOLDER_ID = "17YV1RzRT3xCGqIKg5A6UrgoUyGhEMGEv";

let photoList = [];
let photoIndex = 0;
let slideshowInterval = null;

/* SHUFFLE */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

/* LOAD PHOTOS */
async function loadDrivePhotos() {
  try {
    const url =
      `https://www.googleapis.com/drive/v3/files` +
      `?q='${DRIVE_FOLDER_ID}'+in+parents` +
      `&key=${DRIVE_API_KEY}` +
      `&fields=files(id,mimeType)`;

    const res = await fetch(url);
    const data = await res.json();

    photoList = (data.files || [])
      .filter(f => f.mimeType && f.mimeType.startsWith("image/"))
      .map(f => `https://lh3.googleusercontent.com/d/${f.id}=s1920`);

    console.log("PHOTO LIST:", photoList);

    if (!photoList.length) return;

    shuffle(photoList);

    startSlideshow();
    startHomeSlideshow();

  } catch (e) {
    console.error("Drive photo load failed:", e);
  }
}

/* SLIDESHOW */
function startSlideshow() {
  const img = document.getElementById("photo-frame-img");
  if (!img || !photoList.length) return;

  img.src = photoList[0]; // show first immediately
  img.onload = () => {
  if (img.naturalHeight > img.naturalWidth) {
    // Portrait
    img.style.objectFit = "contain";
  } else {
    // Landscape
    img.style.objectFit = "cover";
  }
};

  img.onerror = () => console.log("FAILED:", img.src);

if (slideshowInterval) {
  clearInterval(slideshowInterval);
}

slideshowInterval = setInterval(() => {
  photoIndex = (photoIndex + 1) % photoList.length;
  img.src = photoList[photoIndex];
}, 8000);
}

let homeSlideshowInterval = null;
let homeIndex = 0;

function startHomeSlideshow() {
  const img = document.getElementById("home-slideshow-img");
  if (!img || !photoList.length) return;

  homeIndex = 0;
  img.src = photoList[0];

  img.onload = () => {
    img.style.opacity = "1";
  };

  if (homeSlideshowInterval) {
    clearInterval(homeSlideshowInterval);
  }

  homeSlideshowInterval = setInterval(() => {
    homeIndex = (homeIndex + 1) % photoList.length;

    img.style.opacity = "0";

    setTimeout(() => {
      img.src = photoList[homeIndex];
    }, 400);
  }, 8000);
}
/**********************
 * FULLSCREEN � PHOTOS ONLY
 **********************/
window.addEventListener("load", () => {

  const fsBtn = document.getElementById("fs-btn");
  const photosPage = document.getElementById("photos");

  if (!fsBtn || !photosPage) return;

  fsBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      photosPage.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  });

  // Auto-hide button
  let hideTimer;

  function showFsBtn() {
    fsBtn.style.opacity = "1";
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      fsBtn.style.opacity = "0";
    }, 3000);
  }

  photosPage.addEventListener("mousemove", showFsBtn);
  showFsBtn();
});
// Ensure correct page state on first load
window.addEventListener("load", () => {
  const activePage = document.querySelector(".page.active");
  if (activePage) {
    document.body.classList.toggle(
      "home-active",
      activePage.id === "home"
    );
  }
});

window.toggleSidebar = function () {
  if (document.body.classList.contains("home-active")) {
    document.getElementById("sidebar").classList.toggle("open");
  }
};

// GLOBAL sidebar toggle
window.toggleSidebar = function () {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;

  if (document.body.classList.contains("home-active")) {
    sidebar.classList.toggle("open");
  }
};
window.addEventListener("load", () => {
    loadDrivePhotos();
});