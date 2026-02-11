// ==========================
// GLOBAL STATE
// ==========================
let map;
let myLat = null;
let myLon = null;
let userMarker = null;
let nearbyMarkers = [];
let selectedUserId = null;
let nearbyUsers = [];
let currentRequestId = null;
let locationReady = false;
let requestPoller = null;
let matchPoller = null;
let isMatched = false;
// 🔥 view feedback state
let myFeedbackList = [];

// 🔥 feedback state
let feedbackTargetId = null;
let selectedRating = 0;

// GPS smoothing
let lastPositions = [];
const MAX_POINTS = 5;
let hasFirstFix = false;

// simple view toggler with explicit display control (prevents stuck overlays)
function showSection(sectionId) {
  ["app-shell", "match-view", "feedback-view"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isTarget = id === sectionId;
    el.classList.toggle("hidden", !isTarget);
    if (isTarget) {
      // match view uses flex, others block
      el.style.display = id === "match-view" ? "flex" : "block";
    } else {
      el.style.display = "none";
    }
  });
}

// ==========================
// INIT
// ==========================
document.addEventListener("DOMContentLoaded", () => {
  // force-hide match/feedback overlays on load in case of cached state
  const mv = document.getElementById("match-view");
  const fv = document.getElementById("feedback-view");
  const app = document.getElementById("app-shell");
  if (mv) { mv.classList.add("hidden"); mv.style.display = "none"; }
  if (fv) { fv.classList.add("hidden"); fv.style.display = "none"; }
  if (app) { app.classList.remove("hidden"); app.style.display = "block"; }

  initMap();
  fetchUserInfo();
  startRequestPoller();
  startMatchPoller();
});

function startRequestPoller() {
  if (requestPoller) return;
  requestPoller = setInterval(pollRequests, 5000);
}

// ==========================
// MAP INIT
// ==========================
function initMap() {
  map = L.map("map", { zoomControl: false }).setView([20.5937, 78.9629], 5);

  L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    { attribution: "&copy; OpenStreetMap contributors" }
  ).addTo(map);

  if (!navigator.geolocation) {
    showGPS("Geolocation not supported");
    return;
  }

  showGPS("📍 Getting your location…");

  navigator.geolocation.watchPosition(
    handleLocation,
    () => showGPS("📍 Unable to get location"),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 3000 }
  );
}

// ==========================
// LOCATION HANDLER
// ==========================
function handleLocation(pos) {
  const { latitude, longitude } = pos.coords;

  if (!hasFirstFix) {
    myLat = latitude;
    myLon = longitude;
    locationReady = true;
    hasFirstFix = true;
    hideGPS();
  } else {
    lastPositions.push([latitude, longitude]);
    if (lastPositions.length > MAX_POINTS) lastPositions.shift();

    myLat = lastPositions.reduce((s, p) => s + p[0], 0) / lastPositions.length;
    myLon = lastPositions.reduce((s, p) => s + p[1], 0) / lastPositions.length;
  }

  if (!userMarker) {
    map.setView([myLat, myLon], 15);
    userMarker = L.circleMarker([myLat, myLon], {
      radius: 8,
      fillColor: "#3bb2d0",
      color: "#fff",
      weight: 2,
      fillOpacity: 1
    }).addTo(map);
  } else {
    userMarker.setLatLng([myLat, myLon]);
  }

  if (!isMatched) fetchNearbyUsers();
}

// ==========================
// GPS UI
// ==========================
function showGPS(text) {
  const el = document.getElementById("gps-status");
  if (!el) return;
  el.innerText = text;
  el.style.display = "block";
}
function hideGPS() {
  const el = document.getElementById("gps-status");
  if (!el) return;
  el.style.display = "none";
}

// ==========================
// USER INFO
// ==========================
async function fetchUserInfo() {
  const res = await fetch("/api/user_info");
  if (!res.ok) return;
  const data = await res.json();

  const el = document.getElementById("my-trust-score");
  if (el) el.innerText = data.trust_score ?? "--";

  if (data.is_matched === 1) enterMatchMode();
}

// ==========================
// MATCH STATUS POLLING
// ==========================
function startMatchPoller() {
  if (matchPoller) return;
  matchPoller = setInterval(checkMatchStatus, 3000);
}

async function checkMatchStatus() {
  if (isMatched) return;

  const res = await fetch("/api/match_status");
  if (!res.ok) return;

  const data = await res.json();
  if (data.matched) enterMatchMode();
}

// ==========================
// NEARBY USERS
// ==========================
async function fetchNearbyUsers() {
  if (!locationReady) return;

  const res = await fetch(`/api/nearby?lat=${myLat}&lon=${myLon}`);
  if (!res.ok) return;

  const users = await res.json();
  nearbyUsers = users.map(u => ({
    ...u,
    vibes: u.vibe_tags ? u.vibe_tags.split(",").filter(Boolean) : [],
    distance_km: (u.lat && u.lon) ? haversine(myLat, myLon, u.lat, u.lon) : null
  }));

  nearbyMarkers.forEach(m => map.removeLayer(m));
  nearbyMarkers = [];

  nearbyUsers.forEach(user => {
    const icon = L.divIcon({
      html: `<div style="width:60px;height:60px;border-radius:50%;
        background:rgba(255,215,0,0.25);
        border:2px solid rgba(255,215,0,0.8)"></div>`,
      iconSize: [60, 60],
      className: ""
    });

    const marker = L.marker([user.lat, user.lon], { icon }).addTo(map);
    marker.on("click", () => openProfile(user));
    nearbyMarkers.push(marker);
  });

  renderNearbyCards();
}

// ==========================
// PROFILE
// ==========================
function openProfile(user) {
  selectedUserId = user.id;
  document.getElementById("p-avatar").innerText = user.username?.[0] || "?";
  document.getElementById("p-username").innerText = user.username;
  document.getElementById("p-score").innerText = user.trust_score ?? "--";
  document.getElementById("p-place").innerText = user.place || "—";
  document.getElementById("p-intent").innerText = user.intent || "—";
  document.getElementById("p-time").innerText = user.meet_time || "Now";
  const dist = user.distance_km;
  document.getElementById("p-distance").innerText = dist ? `${dist.toFixed(1)} km away` : "";

  const clueWrap = document.getElementById("p-clue-wrap");
  if (user.clue) {
    clueWrap.classList.remove("hidden");
    document.getElementById("p-clue").innerText = `👀 ${user.clue}`;
  } else {
    clueWrap.classList.add("hidden");
  }

  const bioWrap = document.getElementById("p-bio-wrap");
  if (user.bio) {
    bioWrap.classList.remove("hidden");
    document.getElementById("p-bio").innerText = user.bio;
  } else {
    bioWrap.classList.add("hidden");
  }

  const vibesWrap = document.getElementById("p-vibes-wrap");
  if (user.vibes && user.vibes.length) {
    vibesWrap.classList.remove("hidden");
    vibesWrap.innerHTML = user.vibes.map(v => `<span class="profile-chip">${v}</span>`).join("");
  } else {
    vibesWrap.classList.add("hidden");
  }
  openSheet("profile-sheet");
}

// ==========================
// SEND REQUEST
// ==========================
async function sendRequest() {
  if (!selectedUserId) return;

  await fetch("/api/send_request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ receiver_id: selectedUserId })
  });

  startMatchPoller();
  closeAllSheets();
}

// ==========================
// REPORT USER
// ==========================
async function reportUser() {
  if (!selectedUserId) {
    alert("No user selected");
    return;
  }
  const message = prompt("Why are you reporting this user? (optional)") || "";
  const res = await fetch("/api/report_user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target_id: selectedUserId, message })
  });
  if (!res.ok) {
    if (res.status === 401) { alert("Please sign in to report."); return; }
    alert("Unable to submit report");
    return;
  }
  alert("Report submitted");
}

// ==========================
// REQUESTS
// ==========================
async function pollRequests() {
  if (isMatched) return;

  const res = await fetch("/api/check_requests");
  if (!res.ok) return;

  const data = await res.json();
  if (data.type !== "incoming") return;

  currentRequestId = data.data.id;
  const bellBox = document.getElementById("bellBox");
  const dot = document.getElementById("bell-dot");
  if (dot) dot.classList.remove("hidden");
  if (bellBox) {
    bellBox.classList.remove("hidden");
    bellBox.innerHTML = `
      <div class="notif-item">
        <div class="notif-avatar">${data.data.username[0]}</div>
        <div class="notif-text">
          <div class="name">${data.data.username}</div>
          <div class="msg">wants to meet you</div>
        </div>
        <div class="notif-actions">
          <button class="accept-btn" onclick="respondRequest('accept')"><i class="fas fa-check"></i></button>
          <button class="decline-btn" onclick="respondRequest('decline')"><i class="fas fa-xmark"></i></button>
        </div>
      </div>
    `;
  }
}

// ==========================
// RESPOND REQUEST
// ==========================
async function respondRequest(action) {
  await fetch("/api/respond_request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request_id: currentRequestId, action })
  });

  currentRequestId = null;
  document.getElementById("bell-dot").classList.add("hidden");
  document.getElementById("bellBox").classList.add("hidden");

  if (action === "accept") enterMatchMode();
}

// ==========================
// MATCH MODE
// ==========================
function enterMatchMode() {
  if (isMatched) return;

  isMatched = true;
  clearInterval(requestPoller); requestPoller = null;
  clearInterval(matchPoller);

  // ensure overlays/sheets are closed so clicks aren't blocked
  closeAllSheets();
  const ov = document.getElementById("overlay");
  if (ov) {
    ov.classList.remove("active");
    ov.classList.add("hidden");
  }

  nearbyMarkers.forEach(m => map.removeLayer(m));
  nearbyMarkers = [];

  showSection("match-view");
}

// ==========================
// END MATCH → FEEDBACK
// ==========================
async function endMatch() {
  const resEnd = await fetch("/api/end_match", { method: "POST" });
  const endPayload = await resEnd.json().catch(() => ({}));
  if (!resEnd.ok) {
    alert(endPayload.error || "Unable to end match");
    return;
  }

  const res = await fetch("/api/feedback_target");
  const target = await res.json().catch(() => ({}));
  if (!res.ok || target.error || !target.id) {
    // No ended match to rate; just reset UI
    isMatched = false;
    backToMap();
    return;
  }

  feedbackTargetId = target.id;
  isMatched = false;
  showFeedbackUI(target.username);
}

// ==========================
// FEEDBACK UI
// ==========================
function showFeedbackUI(username) {
  showSection("feedback-view");
  selectedRating = 0;
  const nameEl = document.getElementById("feedback-username");
  if (nameEl) nameEl.innerText = `@${username}`;

  const ratingBox = document.getElementById("rating-box");
  if (ratingBox) {
    ratingBox.innerHTML = [1,2,3,4,5,6,7,8,9,10].map(n =>
      `<button class="rate-btn" onclick="selectRating(${n}, this)">${n}</button>`
    ).join("");
  }
}

function selectRating(n, el) {
  selectedRating = n;
  document.querySelectorAll(".rate-btn").forEach(b => {
    b.classList.remove("selected");
  });
  el.classList.add("selected");
}

// ==========================
// FEEDBACK RESULT (VIEW)
// ==========================
function showFeedbackResult(rating, comment) {
  const card = document.querySelector("#feedback-view .feedback-card");
  if (!card) return window.location.reload();

  card.innerHTML = `
    <h2>✅ Feedback Submitted</h2>
    <p>Your rating: <strong>${rating}/10</strong></p>
    ${comment ? `<p style="max-width:400px;margin-top:10px;">"${comment}"</p>` : ""}
    <button onclick="finishFeedback()" class="primary-btn" style="margin-top:20px;">
      Continue
    </button>
  `;
}

// ==========================
// SUBMIT FEEDBACK
// ==========================
function submitFeedback() {
  const comment = document.getElementById("feedback-text").value.trim();
  const rating = selectedRating;

  if (!rating) {
    alert("Select a rating");
    return;
  }

  if (!feedbackTargetId) {
    alert("No feedback target found");
    return;
  }

  fetch("/api/submit_feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      reviewed_id: feedbackTargetId, // ✅ REQUIRED
      rating: rating,
      comment: comment
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.status === "submitted") {
      alert("Feedback submitted");
      feedbackTargetId = null;
      showFeedbackResult(rating, comment);
    } else {
      alert("Failed to submit feedback");
    }
  })
  .catch(err => {
    console.error(err);
    alert("Server error");
  });
}

function finishFeedback() {
  selectedRating = 0;
  startRequestPoller();
  startMatchPoller();
  fetchNearbyUsers();
  fetchUserInfo();
  showSection("app-shell");
}

// ==========================
// UI HELPERS
// ==========================
function openSheet(id) {
  const ov = document.getElementById("overlay");
  ov.classList.remove("hidden");
  requestAnimationFrame(() => ov.classList.add("active"));
  setTimeout(() => document.getElementById(id).classList.add("active"), 10);
}

function closeAllSheets() {
  document.querySelectorAll(".bottom-sheet").forEach(s =>
    s.classList.remove("active")
  );
  const ov = document.getElementById("overlay");
  ov.classList.remove("active");
  setTimeout(() => ov.classList.add("hidden"), 300);
}
async function fetchMyFeedback() {
  const res = await fetch("/api/my_feedback");
  if (!res.ok) {
    alert("Unable to load feedback");
    return;
  }
  const payload = await res.json();
  myFeedbackList = payload.reviews || [];
  showMyFeedbackUI();
}
function showMyFeedbackUI() {
  if (!myFeedbackList || myFeedbackList.length === 0) {
    document.body.innerHTML = `
      <div style="min-height:100vh;background:#000;color:#fff;
        display:flex;flex-direction:column;justify-content:center;
        align-items:center;text-align:center;padding:20px;">
        <h2>📝 Feedback</h2>
        <p>No feedback yet</p>
        <button onclick="window.location.reload()" class="primary-btn">
          Back
        </button>
      </div>
    `;
    return;
  }

  document.body.innerHTML = `
    <div style="min-height:100vh;background:#000;color:#fff;padding:20px;">
      <h2 style="text-align:center;">📝 Feedback About You</h2>

      ${myFeedbackList.map(f => `
        <div style="background:#111;padding:15px;margin:15px 0;
          border-radius:10px;border:1px solid #333;">
          <p><strong>⭐ ${f.rating}/10</strong></p>
          ${f.comment ? `<p style="opacity:.9;">"${f.comment}"</p>` : ""}
          <small style="opacity:.6;">${new Date(f.created_at * 1000).toLocaleString()}</small>
        </div>
      `).join("")}

      <div style="text-align:center;margin-top:30px;">
        <button onclick="window.location.reload()" class="primary-btn">
          Back to Map
        </button>
      </div>
    </div>
  `;
}

// ==========================
// MISSING FUNCTIONS
// ==========================
function goToSettings() {
  window.location.href = '/settings';
}

function toggleBellBox() {
  const box = document.getElementById('bellBox');
  if (box) box.classList.toggle('hidden');
}

function backToMap() {
  showSection("app-shell");
  if (!isMatched) {
    startRequestPoller();
    startMatchPoller();
    fetchNearbyUsers();
  }
}

// ==========================
// REPORT APP (feedback to admin)
// ==========================
async function reportApp() {
  const message = prompt("Describe the issue or feedback:") || "";
  if (!message.trim()) return;
  const res = await fetch("/api/report_app", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });
  if (!res.ok) {
    if (res.status === 401) { alert("Please sign in to send a report."); return; }
    alert("Unable to send report");
    return;
  }
  alert("Thanks! Report sent.");
}

// ==========================
// CHECKIN FUNCTIONS
// ==========================
async function confirmCheckIn() {
  if (!locationReady) {
    alert("Location not ready yet");
    return;
  }

  const place = document.getElementById("place").value.trim();
  const intent = document.getElementById("intent").value.trim();
  const meet_time = document.getElementById("meet_time").value;
  const bill = document.getElementById("bill").value;
  const clue = document.getElementById("visual-clue").value.trim();

  if (!place || !intent) {
    alert("Please fill in place and intent");
    return;
  }

  const data = {
    lat: myLat,
    lon: myLon,
    place,
    intent,
    meet_time,
    bill,
    clue
  };

  const res = await fetch("/api/checkin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  if (!res.ok) {
    alert("Failed to check in");
    return;
  }

  closeAllSheets();
  // Show live indicator
  document.getElementById("live-indicator").classList.remove("hidden");
}

async function turnOffSpotlight() {
  const res = await fetch("/api/checkout", { method: "POST" });
  if (!res.ok) {
    alert("Failed to turn off");
    return;
  }

  document.getElementById("live-indicator").classList.add("hidden");
}

// ==========================
// NEARBY CARDS
// ==========================
function renderNearbyCards() {
  const el = document.getElementById("nearby-carousel");
  if (!el) return;

  if (!nearbyUsers || nearbyUsers.length === 0) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = nearbyUsers.map(u => `
    <div class="nearby-card" onclick='openProfile(${JSON.stringify(u).replace(/'/g, "\\'")})'>
      <div class="card-top">
        <div class="card-avatar">${u.username?.[0] || "?"}</div>
        <div>
          <div class="card-name">${u.username}</div>
          <div class="card-score"><i class="fas fa-star" style="font-size:10px"></i> ${u.trust_score ?? "--"}</div>
        </div>
      </div>
      <div class="card-info"><i class="fas fa-map-pin"></i> ${u.place || "Somewhere nearby"}</div>
      <div class="card-info"><i class="fas fa-mug-hot"></i> ${u.intent || "Hanging out"}</div>
      ${u.bio ? `<div class="card-bio">${u.bio.slice(0, 80)}${u.bio.length > 80 ? "…" : ""}</div>` : ""}
      <div class="card-dist"><span>${u.distance_km ? `${u.distance_km.toFixed(1)} km` : "Nearby"}</span><i class="fas fa-chevron-right" style="font-size:10px;color:rgba(255,215,0,0.4)"></i></div>
    </div>
  `).join("");
}

// ==========================
// UTIL – distance
// ==========================
function haversine(lat1, lon1, lat2, lon2) {
  const toRad = deg => deg * Math.PI / 180;
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
