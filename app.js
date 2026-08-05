/* Tourenplaner – Client-seitige App.
 * Login/Daten: Firebase (Authentication + Firestore).
 * Geokodierung via OpenStreetMap Nominatim, Routing/Distanzmatrix via OSRM (project-osrm.org).
 */
import { onAuthChange, login, logout, ensureUserDoc } from "./js/firebase-app.js";
import {
  subscribeCustomers,
  addCustomer,
  saveGeocodeResult,
  addVisit,
  getVisits,
  getFinancials,
  importStaticAddresses,
  importRecordsForColleague,
  countOwnCustomers,
  listUsers,
} from "./js/data-store.js";
import { parseNorthDataCsv } from "./js/northdata-import.js";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving/";
const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/";
const NOMINATIM_DELAY_MS = 1100; // Nominatim-Nutzungsrichtlinie: max. 1 Anfrage/Sekunde
const MAX_MULTISTART_N = 120;
const GOOGLE_MAPS_CHUNK = 10;

const els = {};
let map = null;
let mapLayer = null;

const state = {
  user: null, // { uid, email }
  role: "colleague",
  customers: [], // aktuelle Firestore-Kundenliste (je nach scope)
  byCity: {},
  scopeAll: false,
  unsubscribeCustomers: null,
  gpsCoords: null,
  pendingConfirm: null, // { customerId, note }
};

document.addEventListener("DOMContentLoaded", init);

function init() {
  cacheEls();
  bindStaticEvents();
  onAuthChange(handleAuthChange);
}

function cacheEls() {
  els.userBar = document.getElementById("user-bar");
  els.userInfo = document.getElementById("user-info");
  els.scopeToggleLabel = document.getElementById("scope-toggle-label");
  els.scopeToggle = document.getElementById("scope-toggle");
  els.logoutBtn = document.getElementById("logout-btn");

  els.loginPanel = document.getElementById("login-panel");
  els.loginForm = document.getElementById("login-form");
  els.loginEmail = document.getElementById("login-email");
  els.loginPassword = document.getElementById("login-password");
  els.loginError = document.getElementById("login-error");

  els.appRoot = document.getElementById("app-root");

  els.addCustomerToggle = document.getElementById("add-customer-toggle");
  els.addCustomerForm = document.getElementById("add-customer-form");
  els.addCustomerStatus = document.getElementById("add-customer-status");

  els.importPanel = document.getElementById("import-panel");
  els.importBtn = document.getElementById("import-btn");
  els.importStatus = document.getElementById("import-status");

  els.adminImportPanel = document.getElementById("admin-import-panel");
  els.adminImportToggle = document.getElementById("admin-import-toggle");
  els.adminImportBody = document.getElementById("admin-import-body");
  els.adminImportUser = document.getElementById("admin-import-user");
  els.adminImportFile = document.getElementById("admin-import-file");
  els.adminImportBtn = document.getElementById("admin-import-btn");
  els.adminImportProgress = document.getElementById("admin-import-progress");
  els.adminImportProgressFill = document.getElementById("admin-import-progress-fill");
  els.adminImportStatus = document.getElementById("admin-import-status");

  els.citySelect = document.getElementById("city-select");
  els.startModeRadios = document.querySelectorAll('input[name="start-mode"]');
  els.startAddressSelect = document.getElementById("start-address-select");
  els.gpsStatus = document.getElementById("gps-status");
  els.returnToStart = document.getElementById("return-to-start");
  els.computeBtn = document.getElementById("compute-btn");
  els.progress = document.getElementById("progress");
  els.progressFill = document.getElementById("progress-fill");
  els.progressLabel = document.getElementById("progress-label");
  els.resultsPanel = document.getElementById("results-panel");
  els.resultsTitle = document.getElementById("results-title");
  els.mapsLinksToggle = document.getElementById("maps-links-toggle");
  els.mapsLinks = document.getElementById("maps-links");
  els.printBtn = document.getElementById("print-btn");
  els.mapDiv = document.getElementById("map");
  els.stopList = document.getElementById("stop-list");
  els.unresolved = document.getElementById("unresolved");
  els.unresolvedList = document.getElementById("unresolved-list");

  els.confirmOverlay = document.getElementById("confirm-overlay");
  els.confirmCompany = document.getElementById("confirm-company");
  els.confirmBtn = document.getElementById("confirm-btn");
  els.confirmCancel = document.getElementById("confirm-cancel");
  els.confirmThanks = document.getElementById("confirm-thanks");
}

function bindStaticEvents() {
  els.loginForm.addEventListener("submit", onLoginSubmit);
  els.logoutBtn.addEventListener("click", () => logout());
  els.scopeToggle.addEventListener("change", onScopeToggle);

  els.addCustomerToggle.addEventListener("click", () => {
    els.addCustomerForm.classList.toggle("hidden");
  });
  els.addCustomerForm.addEventListener("submit", onAddCustomerSubmit);
  els.importBtn.addEventListener("click", onImportClick);

  els.adminImportToggle.addEventListener("click", () => {
    els.adminImportBody.classList.toggle("hidden");
  });
  els.adminImportBtn.addEventListener("click", onAdminImportClick);

  els.citySelect.addEventListener("change", onCityChange);
  els.startModeRadios.forEach((r) => r.addEventListener("change", onStartModeChange));
  els.computeBtn.addEventListener("click", onComputeClick);
  els.mapsLinksToggle.addEventListener("click", () => els.mapsLinks.classList.toggle("hidden"));
  els.printBtn.addEventListener("click", () => window.print());

  els.confirmBtn.addEventListener("click", onConfirmVisitClick);
  els.confirmCancel.addEventListener("click", closeConfirmOverlay);
}

// ---------- Auth ----------

async function onLoginSubmit(ev) {
  ev.preventDefault();
  els.loginError.classList.add("hidden");
  try {
    await login(els.loginEmail.value.trim(), els.loginPassword.value);
  } catch (err) {
    els.loginError.textContent = "Anmeldung fehlgeschlagen: " + friendlyAuthError(err);
    els.loginError.classList.remove("hidden");
  }
}

function friendlyAuthError(err) {
  const code = err && err.code ? err.code : "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found")) {
    return "E-Mail oder Passwort ist falsch.";
  }
  if (code.includes("too-many-requests")) {
    return "Zu viele Versuche, bitte kurz warten.";
  }
  return err.message || "Unbekannter Fehler.";
}

async function handleAuthChange(user) {
  if (state.unsubscribeCustomers) {
    state.unsubscribeCustomers();
    state.unsubscribeCustomers = null;
  }

  if (!user) {
    state.user = null;
    els.loginPanel.classList.remove("hidden");
    els.appRoot.classList.add("hidden");
    els.userBar.classList.add("hidden");
    return;
  }

  const profile = await ensureUserDoc(user);
  state.user = { uid: user.uid, email: user.email };
  state.role = profile.role || "colleague";

  els.loginPanel.classList.add("hidden");
  els.appRoot.classList.remove("hidden");
  els.userBar.classList.remove("hidden");
  els.userInfo.textContent = user.email + (state.role === "owner" ? " (Admin)" : "");
  els.scopeToggleLabel.classList.toggle("hidden", state.role !== "owner");
  els.scopeToggle.checked = false;
  state.scopeAll = false;

  els.adminImportPanel.classList.toggle("hidden", state.role !== "owner");
  if (state.role === "owner") populateAdminImportUsers();

  subscribeToCustomers();
}

async function populateAdminImportUsers() {
  els.adminImportUser.innerHTML = "";
  try {
    const users = (await listUsers()).filter((u) => u.uid !== state.user.uid);
    if (!users.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "-- noch niemand angemeldet --";
      els.adminImportUser.appendChild(opt);
      return;
    }
    users
      .sort((a, b) => (a.email || "").localeCompare(b.email || "", "de"))
      .forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.uid;
        opt.textContent = u.name || u.email || u.uid;
        els.adminImportUser.appendChild(opt);
      });
  } catch (err) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Fehler beim Laden der Nutzerliste";
    els.adminImportUser.appendChild(opt);
    console.error(err);
  }
}

function onScopeToggle() {
  state.scopeAll = els.scopeToggle.checked;
  subscribeToCustomers();
}

function subscribeToCustomers() {
  if (state.unsubscribeCustomers) {
    state.unsubscribeCustomers();
    state.unsubscribeCustomers = null;
  }
  const scope = state.scopeAll ? { all: true } : { ownerUid: state.user.uid };
  state.unsubscribeCustomers = subscribeCustomers(
    scope,
    (rows) => {
      state.customers = rows;
      regroupByCity();
      populateCitySelect();
      if (currentCity()) onCityChange();
      maybeShowImportPanel();
    },
    (err) => {
      console.error(err);
      alert("Kundendaten konnten nicht geladen werden: " + err.message);
    }
  );
}

function maybeShowImportPanel() {
  // Die urspruengliche 215er-Liste soll nur "owner" selbst importieren
  // koennen - Kolleg:innen bekommen ihre Kunden per Admin-Import oder
  // legen sie einzeln ueber "Kunde hinzufuegen" an.
  const show = state.role === "owner" && !state.scopeAll && state.customers.length === 0;
  els.importPanel.classList.toggle("hidden", !show);
}

// ---------- Kunde hinzufügen ----------

async function onAddCustomerSubmit(ev) {
  ev.preventDefault();
  const fields = {
    unternehmen: document.getElementById("nc-unternehmen").value.trim(),
    strasse: document.getElementById("nc-strasse").value.trim(),
    plz: document.getElementById("nc-plz").value.trim(),
    ort: document.getElementById("nc-ort").value.trim(),
    inhaber: document.getElementById("nc-inhaber").value.trim(),
    telefon: document.getElementById("nc-telefon").value.trim(),
    email: document.getElementById("nc-email").value.trim(),
    website: document.getElementById("nc-website").value.trim(),
  };
  if (!fields.unternehmen || !fields.ort) {
    els.addCustomerStatus.textContent = "Bitte mindestens Unternehmen und Ort angeben.";
    return;
  }
  els.addCustomerStatus.textContent = "Speichere …";
  try {
    await addCustomer(fields, state.user.uid);
    els.addCustomerForm.reset();
    els.addCustomerStatus.textContent = "Gespeichert.";
    setTimeout(() => (els.addCustomerStatus.textContent = ""), 3000);
  } catch (err) {
    els.addCustomerStatus.textContent = "Fehler: " + err.message;
  }
}

async function onImportClick() {
  const staticRecords = window.ADDRESS_DATA || [];
  if (!staticRecords.length) {
    els.importStatus.textContent = "Keine Daten in data/adressen.js gefunden.";
    return;
  }
  const existing = await countOwnCustomers(state.user.uid);
  if (existing > 0) {
    els.importStatus.textContent = "Du hast bereits eigene Kunden – Import übersprungen.";
    return;
  }
  els.importBtn.disabled = true;
  await importStaticAddresses(state.user.uid, staticRecords, (done, total) => {
    els.importStatus.textContent = `Importiere … ${done}/${total}`;
  });
  els.importStatus.textContent = "Import abgeschlossen.";
  els.importBtn.disabled = false;
}

function readFileAsText(file, encoding) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, encoding);
  });
}

async function onAdminImportClick() {
  const targetUid = els.adminImportUser.value;
  const file = els.adminImportFile.files[0];
  if (!targetUid) {
    els.adminImportStatus.textContent = "Bitte eine Person auswählen.";
    return;
  }
  if (!file) {
    els.adminImportStatus.textContent = "Bitte zuerst eine CSV-Datei auswählen.";
    return;
  }

  els.adminImportBtn.disabled = true;
  els.adminImportStatus.textContent = "Lese Datei …";
  try {
    // North-Data-Exporte sind ISO-8859-1/CP1252 kodiert, nicht UTF-8.
    const text = await readFileAsText(file, "ISO-8859-1");
    const records = parseNorthDataCsv(text);
    if (!records.length) {
      els.adminImportStatus.textContent = "Keine verwertbaren Zeilen in der Datei gefunden.";
      return;
    }
    els.adminImportProgress.classList.remove("hidden");
    await importRecordsForColleague(targetUid, state.user.uid, records, (done, total) => {
      els.adminImportProgressFill.style.width = Math.round((done / total) * 100) + "%";
      els.adminImportStatus.textContent = `Importiere … ${done}/${total}`;
    });
    els.adminImportStatus.textContent = `Fertig: ${records.length} Kunden importiert.`;
    els.adminImportFile.value = "";
  } catch (err) {
    els.adminImportStatus.textContent = "Fehler: " + err.message;
    console.error(err);
  } finally {
    els.adminImportProgress.classList.add("hidden");
    els.adminImportBtn.disabled = false;
  }
}

// ---------- Städte / Auswahl ----------

function regroupByCity() {
  state.byCity = {};
  state.customers.forEach((a) => {
    const city = a.ort || "(ohne Ort)";
    if (!state.byCity[city]) state.byCity[city] = [];
    state.byCity[city].push(a);
  });
}

function populateCitySelect() {
  const previous = els.citySelect.value;
  const cities = Object.keys(state.byCity).sort((a, b) => a.localeCompare(b, "de"));
  const frag = document.createDocumentFragment();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = `-- Ort wählen (${cities.length} Orte, ${state.customers.length} Adressen) --`;
  frag.appendChild(placeholder);
  cities.forEach((city) => {
    const opt = document.createElement("option");
    opt.value = city;
    const n = state.byCity[city].length;
    opt.textContent = `${city} (${n} ${n === 1 ? "Adresse" : "Adressen"})`;
    frag.appendChild(opt);
  });
  els.citySelect.innerHTML = "";
  els.citySelect.appendChild(frag);
  if (cities.includes(previous)) els.citySelect.value = previous;
}

function currentCity() {
  return els.citySelect.value;
}

function currentStartMode() {
  const checked = document.querySelector('input[name="start-mode"]:checked');
  return checked ? checked.value : "first";
}

function onCityChange() {
  const city = currentCity();
  const addresses = (state.byCity[city] || []).filter((a) => a.hasAddress);
  const frag = document.createDocumentFragment();
  addresses.forEach((a) => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.unternehmen + " – " + a.strasse;
    frag.appendChild(opt);
  });
  els.startAddressSelect.innerHTML = "";
  els.startAddressSelect.appendChild(frag);
}

function onStartModeChange() {
  const mode = currentStartMode();
  els.startAddressSelect.classList.toggle("hidden", mode !== "address");
  els.gpsStatus.classList.toggle("hidden", mode !== "gps");
  if (mode === "gps") requestGpsLocation();
}

function requestGpsLocation() {
  els.gpsStatus.textContent = "Standort wird ermittelt …";
  if (!navigator.geolocation) {
    els.gpsStatus.textContent = "Geolocation wird von diesem Browser nicht unterstützt.";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.gpsCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      els.gpsStatus.textContent = "Standort erkannt (Genauigkeit ±" + Math.round(pos.coords.accuracy) + " m).";
    },
    (err) => {
      state.gpsCoords = null;
      els.gpsStatus.textContent = "Standort konnte nicht ermittelt werden (" + err.message + ").";
    },
    { enableHighAccuracy: true, timeout: 15000 }
  );
}

// ---------- Geokodierung (Nominatim), Cache in Firestore je Kunde ----------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function geocodeOne(addr) {
  if (typeof addr.lat === "number" && typeof addr.lon === "number") {
    return { coords: { lat: addr.lat, lon: addr.lon }, fromCache: true };
  }
  const url = NOMINATIM_URL + "?format=jsonv2&limit=1&countrycodes=de&q=" + encodeURIComponent(addr.geocodeQuery);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    let coords = null;
    if (json && json.length) {
      coords = { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) };
      saveGeocodeResult(addr.id, coords).catch(() => {});
    }
    return { coords, fromCache: false };
  } catch (e) {
    return { coords: null, fromCache: false, error: true };
  }
}

async function geocodeAll(addresses, onProgress) {
  const results = [];
  for (let i = 0; i < addresses.length; i++) {
    const addr = addresses[i];
    onProgress(i, addresses.length, addr);
    const r = await geocodeOne(addr);
    results.push({ addr, coords: r.coords });
    if (!r.fromCache) await sleep(NOMINATIM_DELAY_MS);
  }
  return results;
}

function fetchDurationMatrix(points) {
  const coordStr = points.map((p) => p.lon + "," + p.lat).join(";");
  const url = OSRM_TABLE_URL + coordStr + "?annotations=duration,distance";
  return fetch(url)
    .then((res) => res.json())
    .then((json) => {
      if (json.code !== "Ok") throw new Error("OSRM table: " + json.code);
      return { durations: json.durations, distances: json.distances };
    });
}

function fetchRouteGeometry(pointsInOrder) {
  const coordStr = pointsInOrder.map((p) => p.lon + "," + p.lat).join(";");
  const url = OSRM_ROUTE_URL + coordStr + "?overview=full&geometries=geojson";
  return fetch(url)
    .then((res) => res.json())
    .then((json) => {
      if (json.code !== "Ok" || !json.routes || !json.routes.length) throw new Error("OSRM route: " + json.code);
      return json.routes[0];
    });
}

// ---------- TSP: nearest-neighbour + 2-opt ----------

function nearestNeighborTour(cost, n, start) {
  const visited = new Array(n).fill(false);
  const tour = [start];
  visited[start] = true;
  for (let step = 1; step < n; step++) {
    const last = tour[tour.length - 1];
    let best = -1;
    let bestCost = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && cost[last][j] < bestCost) {
        bestCost = cost[last][j];
        best = j;
      }
    }
    tour.push(best);
    visited[best] = true;
  }
  return tour;
}

function tourCost(cost, tour, closed) {
  let total = 0;
  for (let i = 0; i < tour.length - 1; i++) total += cost[tour[i]][tour[i + 1]];
  if (closed) total += cost[tour[tour.length - 1]][tour[0]];
  return total;
}

function twoOptImprove(cost, tour, closed) {
  const n = tour.length;
  if (n < 4) return tour;
  const next = (idx) => (idx + 1) % n;
  let improved = true;
  while (improved) {
    improved = false;
    const jMax = closed ? n - 1 : n - 2;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j <= jMax; j++) {
        const jn = closed ? next(j) : j + 1;
        if (jn === i) continue;
        const d0 = cost[tour[i - 1]][tour[i]] + cost[tour[j]][tour[jn]];
        const d1 = cost[tour[i - 1]][tour[j]] + cost[tour[i]][tour[jn]];
        if (d1 < d0 - 1e-6) {
          let lo = i,
            hi = j;
          while (lo < hi) {
            const tmp = tour[lo];
            tour[lo] = tour[hi];
            tour[hi] = tmp;
            lo++;
            hi--;
          }
          improved = true;
        }
      }
    }
  }
  return tour;
}

function solveTour(cost, n, fixedStart, closed) {
  let starts;
  if (fixedStart !== null) {
    starts = [fixedStart];
  } else if (n <= MAX_MULTISTART_N) {
    starts = Array.from({ length: n }, (_, i) => i);
  } else {
    starts = [0];
  }
  let bestTour = null;
  let bestCost = Infinity;
  starts.forEach((s) => {
    let tour = nearestNeighborTour(cost, n, s);
    tour = twoOptImprove(cost, tour, closed);
    const c = tourCost(cost, tour, closed);
    if (c < bestCost) {
      bestCost = c;
      bestTour = tour;
    }
  });
  return { tour: bestTour, cost: bestCost };
}

function formatDuration(seconds) {
  const min = Math.round(seconds / 60);
  if (min < 60) return min + " min";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h + " h " + (m ? m + " min" : "");
}

function formatDistance(meters) {
  return (meters / 1000).toFixed(1).replace(".", ",") + " km";
}

function formatEuro(n) {
  if (typeof n !== "number") return null;
  return n.toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " €";
}

function formatPercent(n) {
  if (typeof n !== "number") return null;
  return n.toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " %";
}

function buildFinancialsText(f) {
  const bits = [];
  const umsatz = formatEuro(f.umsatz);
  if (umsatz) bits.push("Umsatz " + umsatz + (typeof f.umsatzCagr === "number" ? " (CAGR " + formatPercent(f.umsatzCagr) + ")" : ""));
  const gewinn = formatEuro(f.gewinn);
  if (gewinn) bits.push("Gewinn " + gewinn + (typeof f.gewinnCagr === "number" ? " (CAGR " + formatPercent(f.gewinnCagr) + ")" : ""));
  if (typeof f.mitarbeiterzahl === "number") bits.push("Mitarbeiter " + f.mitarbeiterzahl);
  if (!bits.length) return "";
  return '<span class="label">Nur für dich:</span> ' + bits.map(escapeHtml).join(" · ");
}

function formatDate(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("de-DE") + " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function setProgress(fraction, label) {
  els.progress.classList.remove("hidden");
  els.progressFill.style.width = Math.round(fraction * 100) + "%";
  els.progressLabel.textContent = label;
}

function hideProgress() {
  els.progress.classList.add("hidden");
}

// ---------- Route berechnen ----------

async function onComputeClick() {
  const city = currentCity();
  if (!city) {
    alert("Bitte zuerst einen Ort auswählen.");
    return;
  }
  const mode = currentStartMode();
  if (mode === "gps" && !state.gpsCoords) {
    alert("Standort noch nicht verfügbar. Bitte GPS-Freigabe im Browser erlauben und erneut versuchen.");
    return;
  }

  els.computeBtn.disabled = true;
  els.resultsPanel.classList.add("hidden");

  try {
    const all = state.byCity[city] || [];
    const withAddress = all.filter((a) => a.hasAddress);
    const withoutAddress = all.filter((a) => !a.hasAddress);

    if (withAddress.length === 0) {
      hideProgress();
      renderNoRoute(city, withoutAddress);
      return;
    }

    setProgress(0, "Adressen werden geokodiert (0/" + withAddress.length + ") …");
    const geocoded = await geocodeAll(withAddress, (i, total, addr) => {
      setProgress(i / total, "Geokodiere " + (i + 1) + "/" + total + ": " + addr.unternehmen);
    });

    const resolved = geocoded.filter((g) => g.coords);
    const failed = geocoded.filter((g) => !g.coords).map((g) => g.addr);

    if (resolved.length === 0) {
      hideProgress();
      renderNoRoute(city, withoutAddress.concat(failed));
      return;
    }

    setProgress(1, "Fahrzeiten werden berechnet …");

    const points = [];
    const stopMeta = [];
    let fixedStartIndex = null;

    if (mode === "gps") {
      points.push(state.gpsCoords);
      stopMeta.push(null);
      fixedStartIndex = 0;
    } else if (mode === "address") {
      const chosenId = els.startAddressSelect.value;
      let chosenIdx = resolved.findIndex((g) => g.addr.id === chosenId);
      if (chosenIdx === -1) chosenIdx = 0;
      const chosen = resolved.splice(chosenIdx, 1)[0];
      resolved.unshift(chosen);
      fixedStartIndex = 0;
    }

    resolved.forEach((g) => {
      points.push(g.coords);
      stopMeta.push(g.addr);
    });

    const n = points.length;
    const matrix = await fetchDurationMatrix(points);

    const closed = els.returnToStart.checked;
    const result = solveTour(matrix.durations, n, fixedStartIndex, closed);
    const orderIdx = result.tour;

    const orderedPoints = orderIdx.map((i) => points[i]);
    const orderedMeta = orderIdx.map((i) => stopMeta[i]);

    const legDurations = [];
    const legDistances = [];
    for (let k = 0; k < orderIdx.length - 1; k++) {
      legDurations.push(matrix.durations[orderIdx[k]][orderIdx[k + 1]]);
      legDistances.push(matrix.distances[orderIdx[k]][orderIdx[k + 1]]);
    }
    let totalDuration = legDurations.reduce((a, b) => a + b, 0);
    let totalDistance = legDistances.reduce((a, b) => a + b, 0);
    if (closed) {
      const lastIdx = orderIdx[orderIdx.length - 1];
      const firstIdx = orderIdx[0];
      totalDuration += matrix.durations[lastIdx][firstIdx];
      totalDistance += matrix.distances[lastIdx][firstIdx];
    }

    let routeGeometry = null;
    try {
      const routePoints = closed ? orderedPoints.concat([orderedPoints[0]]) : orderedPoints;
      const route = await fetchRouteGeometry(routePoints);
      routeGeometry = route.geometry;
    } catch (e) {
      routeGeometry = null;
    }

    if (state.role === "owner") {
      setProgress(1, "Lade Finanzkennzahlen …");
      await Promise.all(
        orderedMeta.map(async (meta) => {
          if (!meta) return;
          try {
            meta.financials = await getFinancials(meta.id);
          } catch (e) {
            meta.financials = null;
          }
        })
      );
    }

    hideProgress();
    renderResults({
      city,
      orderedPoints,
      orderedMeta,
      legDurations,
      legDistances,
      totalDuration,
      totalDistance,
      closed,
      routeGeometry,
      unresolved: withoutAddress.concat(failed),
    });
  } catch (err) {
    hideProgress();
    alert("Bei der Berechnung ist ein Fehler aufgetreten: " + err.message + "\nBitte Internetverbindung prüfen und erneut versuchen.");
    console.error(err);
  } finally {
    els.computeBtn.disabled = false;
  }
}

function renderNoRoute(city, unresolved) {
  els.resultsPanel.classList.remove("hidden");
  els.resultsTitle.textContent = city + ": keine Route berechenbar";
  els.mapsLinks.classList.add("hidden");
  els.mapsLinksToggle.classList.add("hidden");
  els.mapDiv.classList.add("hidden");
  els.stopList.innerHTML = "";
  renderUnresolved(unresolved);
}

function renderUnresolved(list) {
  if (!list.length) {
    els.unresolved.classList.add("hidden");
    return;
  }
  els.unresolved.classList.remove("hidden");
  els.unresolvedList.innerHTML = "";
  list.forEach((a) => {
    const li = document.createElement("li");
    const parts = [a.unternehmen];
    const addr = [a.strasse, [a.plz, a.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    if (addr) parts.push(addr);
    li.textContent = parts.join(" – ");
    els.unresolvedList.appendChild(li);
  });
}

function renderResults(r) {
  els.resultsPanel.classList.remove("hidden");
  els.mapDiv.classList.remove("hidden");
  els.mapsLinksToggle.classList.remove("hidden");

  const stopCount = r.orderedMeta.filter(Boolean).length;
  els.resultsTitle.textContent =
    r.city + ": " + stopCount + " Stopps – " + formatDistance(r.totalDistance) + " · " + formatDuration(r.totalDuration) + (r.closed ? " (Rundtour)" : "");

  renderMap(r);
  renderStopList(r);
  renderMapsLinks(r);
  renderUnresolved(r.unresolved);
}

function renderMap(r) {
  if (!map) {
    map = L.map(els.mapDiv);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap-Mitwirkende",
    }).addTo(map);
  }
  if (mapLayer) map.removeLayer(mapLayer);
  mapLayer = L.layerGroup().addTo(map);

  r.orderedPoints.forEach((p, i) => {
    const meta = r.orderedMeta[i];
    const isStart = i === 0;
    const isVisited = Boolean(meta && meta.lastVisitedAt);
    const label = isStart ? "Start" : String(i);
    const color = isStart ? "#2c9e6b" : isVisited ? "#b45309" : "#1a5fb4";
    const icon = L.divIcon({
      className: "",
      html:
        '<div style="background:' +
        color +
        ';color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.4);">' +
        label +
        "</div>",
      iconSize: [26, 26],
      iconAnchor: [13, 13],
    });
    const marker = L.marker([p.lat, p.lon], { icon }).addTo(mapLayer);
    const popupText = meta ? "<strong>" + escapeHtml(meta.unternehmen) + "</strong><br>" + escapeHtml(meta.strasse) : "Mein Standort";
    marker.bindPopup(popupText);
  });

  if (r.routeGeometry) {
    const latlngs = r.routeGeometry.coordinates.map((c) => [c[1], c[0]]);
    L.polyline(latlngs, { color: "#1a5fb4", weight: 4, opacity: 0.75 }).addTo(mapLayer);
  } else {
    const straight = r.orderedPoints.map((p) => [p.lat, p.lon]);
    L.polyline(straight, { color: "#1a5fb4", weight: 3, opacity: 0.5, dashArray: "6 6" }).addTo(mapLayer);
  }

  const bounds = L.latLngBounds(r.orderedPoints.map((p) => [p.lat, p.lon]));
  map.fitBounds(bounds, { padding: [30, 30] });
  setTimeout(() => map.invalidateSize(), 50);
}

function renderStopList(r) {
  els.stopList.innerHTML = "";
  r.orderedMeta.forEach((meta, i) => {
    const li = document.createElement("li");
    const isStart = i === 0;
    const isVisited = Boolean(meta && meta.lastVisitedAt);

    const idxSpan = document.createElement("span");
    idxSpan.className = "stop-index" + (isStart ? " start" : isVisited ? " visited" : "");
    idxSpan.textContent = isStart ? "S" : String(i);
    li.appendChild(idxSpan);

    const body = document.createElement("div");
    body.className = "stop-body";

    if (!meta) {
      body.innerHTML = '<div class="company">Mein Standort (Startpunkt)</div>';
    } else {
      const addrLine = [meta.strasse, [meta.plz, meta.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
      let html = '<div class="company">' + escapeHtml(meta.unternehmen) + "</div>";
      html += '<div class="address">' + escapeHtml(addrLine) + "</div>";

      const vertreter = [meta.vertreter1, meta.vertreter2, meta.vertreter3].filter(Boolean);
      if (vertreter.length) {
        html += '<div class="vertreter">Vertretung: ' + escapeHtml(vertreter.join(", ")) + "</div>";
      } else if (meta.inhaber) {
        html += '<div class="vertreter">' + escapeHtml(meta.inhaber) + "</div>";
      }

      const contactBits = [];
      if (meta.telefon) contactBits.push(escapeHtml(meta.telefon));
      if (meta.website) contactBits.push(escapeHtml(meta.website));
      if (contactBits.length) html += '<div class="contact">' + contactBits.join(" · ") + "</div>";
      if (isVisited) {
        html +=
          '<div class="visited-badge">✓ ' +
          (meta.lastVisitConfirmed ? "Vom Kunden bestätigt" : "Besucht") +
          " am " +
          escapeHtml(formatDate(meta.lastVisitedAt)) +
          (meta.lastVisitNote ? ": " + escapeHtml(meta.lastVisitNote) : "") +
          "</div>";
      }
      if (meta.financials) {
        html += '<div class="financials">' + buildFinancialsText(meta.financials) + "</div>";
      }
      body.innerHTML = html;
      body.appendChild(buildVisitControls(meta));
    }

    if (i > 0) {
      const leg = document.createElement("div");
      leg.className = "leg";
      leg.textContent = "→ " + formatDistance(r.legDistances[i - 1]) + ", " + formatDuration(r.legDurations[i - 1]) + " ab vorherigem Stopp";
      body.appendChild(leg);
    }

    li.appendChild(body);
    els.stopList.appendChild(li);
  });

  if (r.closed) {
    const li = document.createElement("li");
    const idxSpan = document.createElement("span");
    idxSpan.className = "stop-index start";
    idxSpan.textContent = "S";
    li.appendChild(idxSpan);
    const body = document.createElement("div");
    body.className = "stop-body";
    body.innerHTML = '<div class="company">Zurück zum Start</div>';
    li.appendChild(body);
    els.stopList.appendChild(li);
  }
}

function buildVisitControls(meta) {
  const wrap = document.createElement("div");
  wrap.className = "visit-controls";

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "link-btn";
  toggleBtn.textContent = "Besuch eintragen";
  wrap.appendChild(toggleBtn);

  const historyBtn = document.createElement("button");
  historyBtn.type = "button";
  historyBtn.className = "link-btn";
  historyBtn.textContent = "Verlauf anzeigen";
  wrap.appendChild(historyBtn);

  const form = document.createElement("div");
  form.className = "visit-form hidden";
  const textarea = document.createElement("textarea");
  textarea.placeholder = "Notiz (optional, z. B. Gesprächsinhalt)";
  textarea.rows = 2;
  const confirmOpenBtn = document.createElement("button");
  confirmOpenBtn.type = "button";
  confirmOpenBtn.className = "primary small";
  confirmOpenBtn.textContent = "Vom Kunden bestätigen lassen";
  form.appendChild(textarea);
  form.appendChild(confirmOpenBtn);
  const formHint = document.createElement("p");
  formHint.className = "hint";
  formHint.textContent = "Damit der Besuch wirklich stattgefunden hat, bestätigt ihn die Kundin/der Kunde direkt auf deinem Handy.";
  form.appendChild(formHint);
  wrap.appendChild(form);

  const historyBox = document.createElement("div");
  historyBox.className = "visit-history hidden";
  wrap.appendChild(historyBox);

  toggleBtn.addEventListener("click", () => form.classList.toggle("hidden"));

  confirmOpenBtn.addEventListener("click", () => {
    openConfirmOverlay(meta, textarea.value.trim());
    form.classList.add("hidden");
    textarea.value = "";
  });

  historyBtn.addEventListener("click", async () => {
    const willShow = historyBox.classList.contains("hidden");
    if (!willShow) {
      historyBox.classList.add("hidden");
      return;
    }
    historyBox.textContent = "Lade …";
    historyBox.classList.remove("hidden");
    try {
      const visits = await getVisits(meta.id);
      if (!visits.length) {
        historyBox.textContent = "Noch keine Besuche eingetragen.";
        return;
      }
      historyBox.innerHTML = "";
      const ul = document.createElement("ul");
      visits.forEach((v) => {
        const li = document.createElement("li");
        li.textContent =
          formatDate(v.visitedAt) +
          (v.confirmedByCustomer ? " ✓ vom Kunden bestätigt" : "") +
          " – " +
          (v.byName || "?") +
          (v.note ? ": " + v.note : "");
        ul.appendChild(li);
      });
      historyBox.appendChild(ul);
    } catch (err) {
      historyBox.textContent = "Fehler beim Laden: " + err.message;
    }
  });

  return wrap;
}

function renderMapsLinks(r) {
  els.mapsLinks.innerHTML = "";
  els.mapsLinks.classList.add("hidden");

  const stops = r.orderedPoints.map((p, i) => {
    const meta = r.orderedMeta[i];
    return {
      label: meta ? meta.unternehmen + ", " + meta.strasse + ", " + [meta.plz, meta.ort].filter(Boolean).join(" ") : "Mein Standort",
      lat: p.lat,
      lon: p.lon,
    };
  });
  if (r.closed) stops.push(stops[0]);

  const chunks = [];
  let i = 0;
  while (i < stops.length - 1) {
    const end = Math.min(i + GOOGLE_MAPS_CHUNK - 1, stops.length - 1);
    chunks.push(stops.slice(i, end + 1));
    i = end;
  }

  chunks.forEach((chunk, idx) => {
    const origin = chunk[0];
    const destination = chunk[chunk.length - 1];
    const waypoints = chunk.slice(1, -1);
    let url =
      "https://www.google.com/maps/dir/?api=1&travelmode=driving" +
      "&origin=" +
      encodeURIComponent(origin.lat + "," + origin.lon) +
      "&destination=" +
      encodeURIComponent(destination.lat + "," + destination.lon);
    if (waypoints.length) {
      url += "&waypoints=" + waypoints.map((w) => encodeURIComponent(w.lat + "," + w.lon)).join("|");
    }
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent =
      chunks.length > 1
        ? "Teil " + (idx + 1) + " von " + chunks.length + " in Google Maps öffnen (" + chunk.length + " Orte)"
        : "Route in Google Maps öffnen (" + chunk.length + " Orte)";
    els.mapsLinks.appendChild(a);
  });

  if (chunks.length > 1) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Google Maps erlaubt nur " + GOOGLE_MAPS_CHUNK + " Orte pro Link – die Tour wurde daher in " + chunks.length + " aufeinanderfolgende Abschnitte aufgeteilt.";
    els.mapsLinks.appendChild(hint);
  }
}

// ---------- Besuch vom Kunden bestätigen lassen ----------

function openConfirmOverlay(meta, note) {
  state.pendingConfirm = { customerId: meta.id, note };
  els.confirmCompany.textContent = meta.unternehmen;
  els.confirmThanks.classList.add("hidden");
  els.confirmBtn.classList.remove("hidden");
  els.confirmCancel.classList.remove("hidden");
  els.confirmOverlay.classList.remove("hidden");
}

function closeConfirmOverlay() {
  state.pendingConfirm = null;
  els.confirmOverlay.classList.add("hidden");
}

async function onConfirmVisitClick() {
  if (!state.pendingConfirm) return;
  const { customerId, note } = state.pendingConfirm;
  els.confirmBtn.disabled = true;
  try {
    await addVisit(customerId, { note, byUid: state.user.uid, byName: state.user.email, confirmedByCustomer: true });
    els.confirmBtn.classList.add("hidden");
    els.confirmCancel.classList.add("hidden");
    els.confirmThanks.classList.remove("hidden");
    setTimeout(() => {
      closeConfirmOverlay();
      els.confirmBtn.disabled = false;
    }, 1600);
  } catch (err) {
    alert("Konnte Besuch nicht bestätigen: " + err.message);
    els.confirmBtn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
