/* Tourenplaner – Client-seitige App.
 * Login/Daten: Firebase (Authentication + Firestore).
 * Geokodierung via OpenStreetMap Nominatim, Routing/Distanzmatrix via OSRM (project-osrm.org).
 */
import { onAuthChange, login, logout, ensureUserDoc } from "./js/firebase-app.js?v=20260812a";
import {
  subscribeCustomers,
  addCustomer,
  saveGeocodeResult,
  addVisit,
  updateVisitOutcome,
  cancelVisitOutcome,
  completeTodo,
  setPensionsrueckstellungen,
  backfillMissingProvisions,
  getCustomersForOwner,
  addContact,
  removeContact,
  getVisits,
  getFinancials,
  importStaticAddresses,
  importRecordsForColleague,
  countOwnCustomers,
  listUsers,
  addTag,
  removeTag,
  backfillSourceTag,
} from "./js/data-store.js?v=20260812a";
import { parseNorthDataCsv } from "./js/northdata-import.js?v=20260812a";
import { TAG_OPTIONS } from "./js/tags.js?v=20260812a";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving/";
const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/";
const NOMINATIM_DELAY_MS = 1100; // Nominatim-Nutzungsrichtlinie: max. 1 Anfrage/Sekunde
const MAX_MULTISTART_N = 120;
const GOOGLE_MAPS_CHUNK = 10;

// Provisions-Standardsaetze (netto, editierbar bei der Eingabe) - werden
// sofort beim Eintragen des Besuchsergebnisses verbucht:
// - nur Mitgliedschaft (kein Beratungstermin)
// - nur Beratungstermin vereinbart (keine Mitgliedschaft)
// - Beratungstermin UND direkt eine Mitgliedschaft zusammen
const MEMBERSHIP_DEFAULT_AMOUNT = 150;
const CONSULT_NO_AMOUNT = 112.5;
const CONSULT_YES_AMOUNT = 200;

const els = {};
let map = null;
let mapLayer = null;

const state = {
  user: null, // { uid, email }
  role: "colleague",
  canSeeFinancials: false,
  customers: [], // aktuelle Firestore-Kundenliste (je nach scope)
  byCity: {},
  scopeAll: false,
  unsubscribeCustomers: null,
  gpsCoords: null,
  pendingConfirm: null, // { customerId, meta, details, visitId }
  pendingCancel: null, // { customerId, visitId, field }
  activeSearchFilter: null, // "members" | "consultations" | null
  openCustomerId: new URLSearchParams(location.search).get("customer") || null,
  customerPageScrolled: false,
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

  els.searchInput = document.getElementById("customer-search");
  els.searchResults = document.getElementById("search-results");
  els.searchEmpty = document.getElementById("search-empty");
  els.filterMembersBtn = document.getElementById("filter-members");
  els.filterConsultationsBtn = document.getElementById("filter-consultations");

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
  els.backfillBtn = document.getElementById("backfill-btn");
  els.backfillStatus = document.getElementById("backfill-status");
  els.printListUser = document.getElementById("print-list-user");
  els.printListBtn = document.getElementById("print-list-btn");
  els.printListStatus = document.getElementById("print-list-status");

  els.welcomeBanner = document.getElementById("welcome-banner");
  els.welcomeText = document.getElementById("welcome-text");
  els.welcomeClose = document.getElementById("welcome-close");

  els.dashboardPanel = document.getElementById("dashboard-panel");
  els.statCustomers = document.getElementById("stat-customers");
  els.statVisits = document.getElementById("stat-visits");
  els.statMemberships = document.getElementById("stat-memberships");
  els.statConsultations = document.getElementById("stat-consultations");
  els.statTodos = document.getElementById("stat-todos");
  els.statProvision = document.getElementById("stat-provision");
  els.dashboardBreakdown = document.getElementById("dashboard-breakdown");
  els.dashboardBreakdownBody = document.getElementById("dashboard-breakdown-body");
  els.statTiles = document.querySelectorAll(".stat-tile");
  els.statDetailOverlay = document.getElementById("stat-detail-overlay");
  els.statDetailClose = document.getElementById("stat-detail-close");
  els.statDetailTitle = document.getElementById("stat-detail-title");
  els.statDetailSubtitle = document.getElementById("stat-detail-subtitle");
  els.statDetailBody = document.getElementById("stat-detail-body");

  els.cancelOverlay = document.getElementById("cancel-overlay");
  els.cancelLabel = document.getElementById("cancel-label");
  els.cancelCompany = document.getElementById("cancel-company");
  els.cancelAmount = document.getElementById("cancel-amount");
  els.cancelConfirmBtn = document.getElementById("cancel-confirm-btn");
  els.cancelCancelBtn = document.getElementById("cancel-cancel-btn");
  els.backfillProvisionsBtn = document.getElementById("backfill-provisions-btn");
  els.backfillProvisionsStatus = document.getElementById("backfill-provisions-status");

  els.deeplinkPanel = document.getElementById("deeplink-panel");
  els.deeplinkBackBtn = document.getElementById("deeplink-back-btn");
  els.deeplinkBody = document.getElementById("deeplink-body");

  els.ncTagsOptions = document.getElementById("nc-tags-options");

  els.citySelect = document.getElementById("city-select");
  els.streetSelect = document.getElementById("street-select");
  els.startModeRadios = document.querySelectorAll('input[name="start-mode"]');
  els.startAddressSelect = document.getElementById("start-address-select");
  els.startFreeAddress = document.getElementById("start-free-address");
  els.gpsStatus = document.getElementById("gps-status");
  els.destinationEnabled = document.getElementById("destination-enabled");
  els.destinationAddress = document.getElementById("destination-address");
  els.destinationHint = document.getElementById("destination-hint");
  els.returnToStartField = document.getElementById("return-to-start-field");
  els.returnToStart = document.getElementById("return-to-start");
  els.computeBtn = document.getElementById("compute-btn");
  els.progress = document.getElementById("progress");
  els.progressFill = document.getElementById("progress-fill");
  els.progressLabel = document.getElementById("progress-label");
  els.resultsPanel = document.getElementById("results-panel");
  els.resultsTitle = document.getElementById("results-title");
  els.resultsDirectHint = document.getElementById("results-direct-hint");
  els.mapsLinksToggle = document.getElementById("maps-links-toggle");
  els.mapsLinks = document.getElementById("maps-links");
  els.printBtn = document.getElementById("print-btn");
  els.mapDiv = document.getElementById("map");
  els.stopList = document.getElementById("stop-list");
  els.unresolved = document.getElementById("unresolved");
  els.unresolvedList = document.getElementById("unresolved-list");

  els.confirmOverlay = document.getElementById("confirm-overlay");
  els.confirmStepVisit = document.getElementById("confirm-step-visit");
  els.confirmCompany = document.getElementById("confirm-company");
  els.confirmBtn = document.getElementById("confirm-btn");
  els.confirmCancel = document.getElementById("confirm-cancel");
  els.confirmStepOutcome = document.getElementById("confirm-step-outcome");
  els.confirmCompany2 = document.getElementById("confirm-company-2");
  els.provisionAmountField = document.getElementById("provision-amount-field");
  els.provisionAmount = document.getElementById("provision-amount");
  els.consultationDatetime = document.getElementById("consultation-datetime");
  els.consultationDate = document.getElementById("consultation-date");
  els.consultationTime = document.getElementById("consultation-time");
  els.outcomeSaveBtn = document.getElementById("outcome-save-btn");
  els.outcomeSkipBtn = document.getElementById("outcome-skip-btn");
  els.yesnoToggles = document.querySelectorAll(".yesno-toggle");
}

function bindStaticEvents() {
  els.loginForm.addEventListener("submit", onLoginSubmit);
  els.logoutBtn.addEventListener("click", () => logout());
  els.scopeToggle.addEventListener("change", onScopeToggle);

  els.searchInput.addEventListener("input", onSearchInput);
  els.filterMembersBtn.addEventListener("click", () => onFilterChipClick("members"));
  els.filterConsultationsBtn.addEventListener("click", () => onFilterChipClick("consultations"));

  els.addCustomerToggle.addEventListener("click", () => {
    els.addCustomerForm.classList.toggle("hidden");
  });
  els.addCustomerForm.addEventListener("submit", onAddCustomerSubmit);
  els.importBtn.addEventListener("click", onImportClick);

  els.adminImportToggle.addEventListener("click", () => {
    els.adminImportBody.classList.toggle("hidden");
  });
  els.adminImportBtn.addEventListener("click", onAdminImportClick);
  els.backfillBtn.addEventListener("click", onBackfillClick);
  els.printListBtn.addEventListener("click", onPrintListClick);

  els.citySelect.addEventListener("change", onCityChange);
  els.streetSelect.addEventListener("change", refreshStartAddressOptions);
  els.startModeRadios.forEach((r) => r.addEventListener("change", onStartModeChange));
  els.destinationEnabled.addEventListener("change", onDestinationToggle);
  els.computeBtn.addEventListener("click", onComputeClick);
  els.mapsLinksToggle.addEventListener("click", () => els.mapsLinks.classList.toggle("hidden"));
  els.printBtn.addEventListener("click", () => window.print());

  els.confirmBtn.addEventListener("click", onConfirmVisitClick);
  els.confirmCancel.addEventListener("click", closeConfirmOverlay);
  els.outcomeSaveBtn.addEventListener("click", onOutcomeSaveClick);
  els.outcomeSkipBtn.addEventListener("click", closeConfirmOverlay);
  els.yesnoToggles.forEach((toggle) => {
    toggle.querySelectorAll(".yesno-btn").forEach((btn) => {
      btn.addEventListener("click", () => onYesNoClick(toggle, btn));
    });
  });

  els.backfillProvisionsBtn.addEventListener("click", onBackfillProvisionsClick);

  els.statTiles.forEach((btn) => btn.addEventListener("click", () => openStatDetail(btn.dataset.stat)));
  els.statDetailClose.addEventListener("click", () => els.statDetailOverlay.classList.add("hidden"));

  els.welcomeClose.addEventListener("click", () => els.welcomeBanner.classList.add("hidden"));

  els.cancelConfirmBtn.addEventListener("click", onCancelConfirmClick);
  els.cancelCancelBtn.addEventListener("click", closeCancelOverlay);

  els.deeplinkBackBtn.addEventListener("click", closeCustomerPage);

  document.addEventListener("click", (ev) => {
    const link = ev.target.closest(".open-customer-link");
    if (!link) return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
    ev.preventDefault();
    els.statDetailOverlay.classList.add("hidden");
    openCustomerPage(link.dataset.customerId);
  });

  window.addEventListener("popstate", () => {
    state.openCustomerId = new URLSearchParams(location.search).get("customer") || null;
    refreshCustomerPage();
  });

  populateTagCheckboxes();
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
  state.user = { uid: user.uid, email: user.email, name: profile.name || user.email };
  state.role = profile.role || "colleague";
  state.canSeeFinancials = state.role === "owner" || Boolean(profile.financialsAccess);

  els.loginPanel.classList.add("hidden");
  els.appRoot.classList.remove("hidden");
  els.userBar.classList.remove("hidden");
  els.userInfo.textContent = user.email + (state.role === "owner" ? " (Admin)" : "");
  els.scopeToggleLabel.classList.toggle("hidden", state.role !== "owner");
  els.scopeToggle.checked = false;
  state.scopeAll = false;

  showWelcomeBanner(state.user.name);

  els.adminImportPanel.classList.toggle("hidden", state.role !== "owner");
  if (state.role === "owner") {
    populateAdminImportUsers();
    populatePrintListUsers();
  }

  subscribeToCustomers();
}

const WELCOME_SAYINGS = [
  "Auf einen erfolgreichen Tag!",
  "Jeder Besuch zählt.",
  "Schön, dass du da bist.",
  "Viel Erfolg unterwegs!",
  "Auf gute Gespräche heute.",
];

function friendlyFirstName(name) {
  const raw = (name || "").trim();
  if (!raw) return "";
  const base = raw.includes("@") ? raw.split("@")[0] : raw;
  const first = base.split(/[\s._-]/)[0];
  if (!first) return "";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

function showWelcomeBanner(name) {
  const firstName = friendlyFirstName(name);
  const saying = WELCOME_SAYINGS[Math.floor(Math.random() * WELCOME_SAYINGS.length)];
  els.welcomeText.textContent = "Willkommen zurück" + (firstName ? ", " + firstName : "") + "! " + saying;
  els.welcomeBanner.classList.remove("hidden");
  // Animation neu starten, falls die Bannerklasse schon einmal genutzt wurde.
  els.welcomeBanner.style.animation = "none";
  void els.welcomeBanner.offsetWidth;
  els.welcomeBanner.style.animation = "";
}

async function populateUserSelect(selectEl) {
  selectEl.innerHTML = "";
  try {
    const users = (await listUsers()).filter((u) => u.uid !== state.user.uid);
    if (!users.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "-- noch niemand angemeldet --";
      selectEl.appendChild(opt);
      return;
    }
    users
      .sort((a, b) => (a.email || "").localeCompare(b.email || "", "de"))
      .forEach((u) => {
        const opt = document.createElement("option");
        opt.value = u.uid;
        opt.textContent = u.name || u.email || u.uid;
        selectEl.appendChild(opt);
      });
  } catch (err) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Fehler beim Laden der Nutzerliste";
    selectEl.appendChild(opt);
    console.error(err);
  }
}

function populateAdminImportUsers() {
  return populateUserSelect(els.adminImportUser);
}

function populatePrintListUsers() {
  return populateUserSelect(els.printListUser);
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
      if (selectedCities().length) onCityChange();
      maybeShowImportPanel();
      refreshDashboard();
      refreshCustomerPage();
    },
    (err) => {
      console.error(err);
      alert("Kundendaten konnten nicht geladen werden: " + err.message);
    }
  );
}

function maybeShowImportPanel() {
  // Die urspruengliche 215er-Liste soll nur "owner" selbst importieren
  // koennen - Kollegen bekommen ihre Kunden per Kunden Import oder
  // legen sie einzeln ueber "Kunde hinzufuegen" an.
  const show = state.role === "owner" && !state.scopeAll && state.customers.length === 0;
  els.importPanel.classList.toggle("hidden", !show);
}

// ---------- Dashboard ----------
//
// Alle Zahlen kommen direkt aus der bereits geladenen Kundenliste
// (state.customers) - kein separates Firestore-Query/Index noetig. Besuche,
// Mitgliedschaft und Beratungstermin sind dafuer als "letzter Stand" am
// Kundendokument gespiegelt (siehe updateVisitOutcome in data-store.js).

function refreshDashboard() {
  const customers = state.customers;
  els.statCustomers.textContent = String(customers.length);
  els.statVisits.textContent = String(customers.filter((c) => c.lastVisitedAt).length);
  els.statMemberships.textContent = String(customers.filter((c) => c.membershipSigned).length);
  els.statConsultations.textContent = String(customers.filter((c) => c.consultationRequested).length);
  els.statTodos.textContent = String(customers.filter((c) => c.openTodo && c.openTodo.text).length);
  els.statProvision.textContent = formatEuroPrecise(customers.reduce((sum, c) => sum + (c.totalProvision || 0), 0));

  if (state.role === "owner" && state.scopeAll) {
    renderDashboardBreakdown();
    els.dashboardBreakdown.classList.remove("hidden");
  } else {
    els.dashboardBreakdown.classList.add("hidden");
  }
}

async function renderDashboardBreakdown() {
  let users = [];
  try {
    users = await listUsers();
  } catch (err) {
    console.error(err);
  }
  const nameByUid = {};
  users.forEach((u) => (nameByUid[u.uid] = u.name || u.email || u.uid));

  const perUid = {};
  function bucket(uid) {
    if (!perUid[uid]) perUid[uid] = { customers: 0, visits: 0, memberships: 0, consultations: 0, provision: 0 };
    return perUid[uid];
  }
  state.customers.forEach((c) => {
    const b = bucket(c.ownerUid);
    b.customers++;
    if (c.lastVisitedAt) b.visits++;
    if (c.membershipSigned) b.memberships++;
    if (c.consultationRequested) b.consultations++;
    b.provision += c.totalProvision || 0;
  });

  els.dashboardBreakdownBody.innerHTML = "";
  Object.keys(perUid)
    .sort((a, b) => (nameByUid[a] || a).localeCompare(nameByUid[b] || b, "de"))
    .forEach((uid) => {
      const row = perUid[uid];
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" +
        escapeHtml(nameByUid[uid] || uid) +
        "</td><td>" +
        row.customers +
        "</td><td>" +
        row.visits +
        "</td><td>" +
        row.memberships +
        "</td><td>" +
        row.consultations +
        "</td><td>" +
        escapeHtml(formatEuroPrecise(row.provision)) +
        "</td>";
      els.dashboardBreakdownBody.appendChild(tr);
    });
}

// ---------- Dashboard-Aufschlüsselung nach Monat ----------
//
// "Kunden angelegt" laesst sich direkt aus state.customers ableiten.
// Besuche/Mitglieder/Termine/Provision haengen dagegen am einzelnen
// Besuchsdatum, nicht am "letzter Stand" auf dem Kundendokument - dafuer
// werden die Besuchs-Unterdokumente aller sichtbaren Kunden geladen (nur
// bei Klick, nicht bei jedem Dashboard-Refresh).

const STAT_LABELS = {
  customers: "Kunden angelegt",
  visits: "Besuche",
  memberships: "BdSt-Mitgliedschaften",
  consultations: "Beratungstermine",
  todos: "Wiedervorlagen",
  provision: "Provision (netto)",
};

function monthKeyFromDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

function monthLabelFromKey(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
}

function toJsDate(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

function sortedMonthlyRows(buckets) {
  return Object.keys(buckets)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((key) => ({ label: monthLabelFromKey(key), value: buckets[key] }));
}

function renderMonthlyTable(container, rows, valueLabel, isEuro) {
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Keine Daten vorhanden.";
    container.appendChild(p);
    return;
  }
  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const totalP = document.createElement("p");
  totalP.className = "stat-detail-total";
  totalP.innerHTML = "<strong>Gesamt: " + escapeHtml(isEuro ? formatEuroPrecise(total) : String(total)) + "</strong>";
  container.appendChild(totalP);

  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  table.className = "stat-detail-table";
  const bodyRows = rows
    .map(
      (r) =>
        "<tr><td>" + escapeHtml(r.label) + '</td><td class="num">' + escapeHtml(isEuro ? formatEuroPrecise(r.value) : String(r.value)) + "</td></tr>"
    )
    .join("");
  table.innerHTML = "<thead><tr><th>Monat</th><th>" + escapeHtml(valueLabel) + "</th></tr></thead><tbody>" + bodyRows + "</tbody>";
  wrap.appendChild(table);
  container.appendChild(wrap);
}

async function loadAllVisitsForCustomers(customers, onProgress) {
  const all = [];
  const BATCH = 8;
  for (let i = 0; i < customers.length; i += BATCH) {
    const batch = customers.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((c) => getVisits(c.id).catch(() => [])));
    results.forEach((visits, idx) => {
      const cust = batch[idx];
      visits.forEach((v) => all.push({ ...v, customerId: cust.id, unternehmen: cust.unternehmen }));
    });
    if (onProgress) onProgress(Math.min(i + BATCH, customers.length), customers.length);
  }
  return all;
}

// Klickbare Liste einzelner Kunden unter der Monatstabelle im Dashboard-
// Drilldown, damit man direkt zur Kundenseite springen kann (z.B. um eine
// Aufnahme/einen Termin zu korrigieren/stornieren).
function renderCustomerLinkList(container, entries) {
  if (!entries.length) return;
  const heading = document.createElement("h3");
  heading.className = "stat-detail-sub-heading";
  heading.textContent = "Einzelne Kunden";
  container.appendChild(heading);

  const ul = document.createElement("ul");
  ul.className = "stat-detail-customer-list";
  entries
    .slice()
    .sort((a, b) => b.date - a.date)
    .forEach((e) => {
      const li = document.createElement("li");
      const meta = [e.date.toLocaleDateString("de-DE")];
      if (e.valueText) meta.push(e.valueText);
      li.innerHTML =
        '<a href="?customer=' +
        encodeURIComponent(e.customerId) +
        '" class="open-customer-link" data-customer-id="' +
        escapeHtml(e.customerId) +
        '">' +
        escapeHtml(e.unternehmen) +
        "</a>" +
        '<span class="stat-detail-customer-meta">' +
        escapeHtml(meta.join(" · ")) +
        "</span>";
      ul.appendChild(li);
    });
  container.appendChild(ul);
}

// Wiedervorlagen-Übersicht: komplett aus state.customers (openTodo ist am
// Kundendokument gespiegelt, siehe addVisit in data-store.js) - kein
// Extra-Fetch der Besuchs-Unterdokumente noetig, anders als bei den
// anderen Dashboard-Kacheln. "erledigt" gibt es hier bewusst nicht direkt
// (nur read-only Übersicht) - dafür auf die Kundenseite durchklicken.
function renderTodoOverview(container) {
  const withTodo = state.customers.filter((c) => c.openTodo && c.openTodo.text);
  if (!withTodo.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Keine offenen ToDos.";
    container.appendChild(p);
    return;
  }
  withTodo.sort((a, b) => {
    const da = a.openTodo.dueDate || "9999-99-99";
    const db = b.openTodo.dueDate || "9999-99-99";
    return da < db ? -1 : da > db ? 1 : 0;
  });

  const ul = document.createElement("ul");
  ul.className = "stat-detail-customer-list";
  withTodo.forEach((c) => {
    const li = document.createElement("li");
    const dueLabel = c.openTodo.dueDate ? formatPlainDate(c.openTodo.dueDate) : "ohne Datum";
    li.innerHTML =
      '<a href="?customer=' +
      encodeURIComponent(c.id) +
      '" class="open-customer-link" data-customer-id="' +
      escapeHtml(c.id) +
      '">' +
      escapeHtml(c.unternehmen) +
      "</a>" +
      '<span class="stat-detail-customer-meta">' +
      escapeHtml(dueLabel + " · " + c.openTodo.text) +
      "</span>";
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

async function openStatDetail(stat) {
  els.statDetailTitle.textContent = STAT_LABELS[stat] || stat;
  els.statDetailSubtitle.textContent = state.role === "owner" && state.scopeAll ? "Alle Kollegen · aktueller Stand" : "Eigene Kunden · aktueller Stand";
  els.statDetailBody.innerHTML = "";
  els.statDetailOverlay.classList.remove("hidden");

  if (stat === "customers") {
    const buckets = {};
    const entries = [];
    state.customers.forEach((c) => {
      const d = toJsDate(c.createdAt);
      if (!d) return;
      const key = monthKeyFromDate(d);
      buckets[key] = (buckets[key] || 0) + 1;
      entries.push({ customerId: c.id, unternehmen: c.unternehmen, date: d, valueText: "" });
    });
    renderMonthlyTable(els.statDetailBody, sortedMonthlyRows(buckets), "Kunden", false);
    renderCustomerLinkList(els.statDetailBody, entries);
    return;
  }

  if (stat === "todos") {
    renderTodoOverview(els.statDetailBody);
    return;
  }

  const loading = document.createElement("p");
  loading.className = "hint";
  loading.textContent = "Lade Besuchsdaten …";
  els.statDetailBody.appendChild(loading);

  try {
    const visits = await loadAllVisitsForCustomers(state.customers, (done, total) => {
      loading.textContent = `Lade Besuchsdaten … ${done}/${total} Kunden`;
    });
    const buckets = {};
    const entries = [];
    let isEuro = false;
    let valueLabel = "Anzahl";
    visits.forEach((v) => {
      const d = toJsDate(v.visitedAt);
      if (!d) return;
      const key = monthKeyFromDate(d);
      if (stat === "visits") {
        buckets[key] = (buckets[key] || 0) + 1;
        entries.push({ customerId: v.customerId, unternehmen: v.unternehmen, date: d, valueText: "" });
      } else if (stat === "memberships") {
        if (v.membershipSigned && !v.membershipCancelled) {
          buckets[key] = (buckets[key] || 0) + 1;
          entries.push({ customerId: v.customerId, unternehmen: v.unternehmen, date: d, valueText: "" });
        }
      } else if (stat === "consultations") {
        if (v.consultationRequested && !v.consultationCancelled) {
          buckets[key] = (buckets[key] || 0) + 1;
          entries.push({
            customerId: v.customerId,
            unternehmen: v.unternehmen,
            date: d,
            valueText: v.consultationAt ? "Termin: " + formatPlainDateTime(v.consultationAt) : "",
          });
        }
      } else if (stat === "provision") {
        if (v.provisionAmount) {
          buckets[key] = (buckets[key] || 0) + v.provisionAmount;
          entries.push({ customerId: v.customerId, unternehmen: v.unternehmen, date: d, valueText: formatEuroPrecise(v.provisionAmount) });
        }
        isEuro = true;
        valueLabel = "Provision";
      }
    });
    els.statDetailBody.innerHTML = "";
    if (stat === "visits") {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = "Zählt jeden eingetragenen Besuch, auch Mehrfachbesuche beim gleichen Kunden.";
      els.statDetailBody.appendChild(note);
    }
    renderMonthlyTable(els.statDetailBody, sortedMonthlyRows(buckets), valueLabel, isEuro);
    renderCustomerLinkList(els.statDetailBody, entries);
  } catch (err) {
    els.statDetailBody.innerHTML = "";
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Fehler beim Laden: " + err.message;
    els.statDetailBody.appendChild(p);
  }
}

// ---------- Kundenseite (Klick auf Kundennamen oder ?customer=ID per QR-Code) ----------
//
// Erreichbar entweder per Direktlink (z.B. gescannter QR-Code auf einem
// Ausdruck) oder per Klick auf einen Kundennamen irgendwo in der App
// (Suche, Tourenplaner, offene Termine). Navigation passiert client-seitig
// (history.pushState) statt per Seiten-Reload.

function openCustomerPage(id) {
  const meta = state.customers.find((c) => c.id === id);
  if (!meta) return;
  history.pushState({ customerId: id }, "", "?customer=" + encodeURIComponent(id));
  state.openCustomerId = id;
  state.customerPageScrolled = false;
  renderCustomerPage(meta);
}

function closeCustomerPage() {
  history.pushState({}, "", location.pathname);
  state.openCustomerId = null;
  els.deeplinkPanel.classList.add("hidden");
  els.deeplinkBody.innerHTML = "";
}

function refreshCustomerPage() {
  if (!state.openCustomerId) {
    els.deeplinkPanel.classList.add("hidden");
    return;
  }
  const meta = state.customers.find((c) => c.id === state.openCustomerId);
  if (!meta) {
    els.deeplinkPanel.classList.add("hidden");
    return;
  }
  renderCustomerPage(meta);
}

async function renderCustomerPage(meta) {
  if (state.canSeeFinancials && meta.financials === undefined) {
    try {
      meta.financials = (await getFinancials(meta.id)) || null;
    } catch (e) {
      meta.financials = null; // Finanzkennzahlen optional - Fehler ignorieren
    }
  }

  els.deeplinkBody.innerHTML = "";
  const detailsDiv = document.createElement("div");
  detailsDiv.innerHTML = buildCustomerDetailsHtml(meta);
  els.deeplinkBody.appendChild(detailsDiv);

  if (state.role === "owner") {
    detailsDiv.appendChild(buildPensionToggle(meta));
  }

  els.deeplinkBody.appendChild(buildTodoSection(meta));
  els.deeplinkBody.appendChild(buildTagsSection(meta));
  els.deeplinkBody.appendChild(buildContactsSection(meta));
  els.deeplinkBody.appendChild(buildVisitControls(meta));

  const historyBox = document.createElement("div");
  historyBox.className = "visit-history-full";
  historyBox.textContent = "Lade Verlauf …";
  els.deeplinkBody.appendChild(historyBox);

  els.deeplinkPanel.classList.remove("hidden");
  if (!state.customerPageScrolled) {
    state.customerPageScrolled = true;
    els.deeplinkPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  try {
    const visits = await getVisits(meta.id);
    renderVisitHistoryFull(historyBox, meta, visits);
  } catch (err) {
    historyBox.textContent = "Fehler beim Laden des Verlaufs: " + err.message;
  }
}

function formatPlainDateTime(s) {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("de-DE") + " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// Fuer reine Datums-Strings ("YYYY-MM-DD", z.B. todoDueDate) - baut das
// Datum aus den Teilen statt ueber new Date(s), damit es unabhaengig von
// der Zeitzone des Browsers immer der eingegebene Tag bleibt.
function formatPlainDate(s) {
  if (!s) return "";
  const parts = String(s).split("-").map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return s;
  const [y, m, d] = parts;
  return new Date(y, m - 1, d).toLocaleDateString("de-DE");
}

function renderVisitHistoryFull(container, meta, visits) {
  container.innerHTML = "";
  const heading = document.createElement("h3");
  heading.textContent = "Besuche & Termine";
  container.appendChild(heading);

  if (!visits.length) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "Noch keine Besuche eingetragen.";
    container.appendChild(p);
    return;
  }

  const ul = document.createElement("ul");
  ul.className = "visit-history-list";
  visits.forEach((v) => {
    const li = document.createElement("li");
    const parts = [formatDate(v.visitedAt)];
    if (v.confirmedByCustomer) parts.push("✓ vom Kunden bestätigt");
    parts.push("– " + (v.byName || "?"));
    if (v.visitedWith) parts.push("(mit " + v.visitedWith + ")");
    if (v.note) parts.push(": " + v.note);
    const line = document.createElement("div");
    line.textContent = parts.join(" ");
    li.appendChild(line);

    if (v.todoText) {
      const todoLine = document.createElement("div");
      todoLine.className = "visit-todo-line" + (v.todoDone ? " done" : "");
      todoLine.textContent =
        (v.todoDone ? "✓ ToDo erledigt: " : "ToDo offen: ") + v.todoText + (v.todoDueDate ? " (Wiedervorlage " + formatPlainDate(v.todoDueDate) + ")" : "");
      li.appendChild(todoLine);
    }

    const badgesDiv = document.createElement("div");
    badgesDiv.className = "visit-badges";

    if (v.membershipSigned) {
      const span = document.createElement("span");
      span.className = "visit-badge-item";
      if (v.membershipCancelled) {
        span.classList.add("cancelled");
        span.textContent = "Mitgliedschaft storniert";
      } else {
        span.textContent = "Mitgliedschaft abgeschlossen";
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "cancel-link";
        cancelBtn.textContent = "Stornieren";
        cancelBtn.addEventListener("click", () => openCancelOverlay(meta, v, "membership"));
        span.appendChild(cancelBtn);
      }
      badgesDiv.appendChild(span);
    }

    if (v.consultationRequested) {
      const span = document.createElement("span");
      span.className = "visit-badge-item";
      if (v.consultationCancelled) {
        span.classList.add("cancelled");
        span.textContent = "Beratungstermin storniert";
      } else {
        span.textContent = "Beratungstermin vereinbart" + (v.consultationAt ? " für " + formatPlainDateTime(v.consultationAt) : "");
        const cancelBtn = document.createElement("button");
        cancelBtn.type = "button";
        cancelBtn.className = "cancel-link";
        cancelBtn.textContent = "Stornieren";
        cancelBtn.addEventListener("click", () => openCancelOverlay(meta, v, "consultation"));
        span.appendChild(cancelBtn);
      }
      badgesDiv.appendChild(span);
    }

    if (v.provisionAmount) {
      const span = document.createElement("span");
      span.className = "visit-badge-item";
      span.textContent = "Provision: " + formatEuroPrecise(v.provisionAmount);
      badgesDiv.appendChild(span);
    }

    if (badgesDiv.children.length) li.appendChild(badgesDiv);
    ul.appendChild(li);
  });
  container.appendChild(ul);
}

// ---------- Aufnahme/Beratungstermin stornieren (Provisionskorrektur) ----------

function openCancelOverlay(meta, visit, field) {
  const membershipActive = visit.membershipSigned && !visit.membershipCancelled;
  const consultationActive = visit.consultationRequested && !visit.consultationCancelled;
  let newAmount;
  if (field === "membership") {
    newAmount = consultationActive ? CONSULT_NO_AMOUNT : 0;
  } else {
    newAmount = membershipActive ? MEMBERSHIP_DEFAULT_AMOUNT : 0;
  }
  state.pendingCancel = { customerId: meta.id, visitId: visit.id, field };
  els.cancelLabel.textContent = field === "membership" ? "Mitgliedschaft stornieren bei" : "Beratungstermin stornieren bei";
  els.cancelCompany.textContent = meta.unternehmen;
  els.cancelAmount.value = newAmount;
  els.cancelOverlay.classList.remove("hidden");
}

function closeCancelOverlay() {
  state.pendingCancel = null;
  els.cancelOverlay.classList.add("hidden");
}

async function onCancelConfirmClick() {
  if (!state.pendingCancel) return;
  const { customerId, visitId, field } = state.pendingCancel;
  const newAmount = parseFloat(String(els.cancelAmount.value).replace(",", ".")) || 0;
  els.cancelConfirmBtn.disabled = true;
  try {
    await cancelVisitOutcome(customerId, visitId, field, newAmount);
    closeCancelOverlay();
    refreshDashboard();
  } catch (err) {
    alert("Konnte Stornierung nicht speichern: " + err.message);
  } finally {
    els.cancelConfirmBtn.disabled = false;
  }
}

// Offenes ToDo (Wiedervorlage) auf der Kundenseite - Info kommt aus der
// Spiegelung meta.openTodo (siehe addVisit in data-store.js), daher ohne
// zusaetzlichen Firestore-Zugriff. "erledigt" räumt das ToDo per
// completeTodo() ab; die Kundenliste ist live abonniert, die Seite baut
// sich danach automatisch neu auf (siehe subscribeToCustomers).
function buildTodoSection(meta) {
  const wrap = document.createElement("div");
  wrap.className = "todo-section";
  if (!meta.openTodo || !meta.openTodo.text) return wrap;

  const text = document.createElement("span");
  text.className = "todo-text";
  text.textContent = "ToDo" + (meta.openTodo.dueDate ? " (Wiedervorlage " + formatPlainDate(meta.openTodo.dueDate) + ")" : "") + ": " + meta.openTodo.text;
  wrap.appendChild(text);

  const doneBtn = document.createElement("button");
  doneBtn.type = "button";
  doneBtn.className = "link-btn";
  doneBtn.textContent = "✓ erledigt";
  doneBtn.addEventListener("click", async () => {
    doneBtn.disabled = true;
    try {
      await completeTodo(meta.id, meta.openTodo.visitId);
    } catch (err) {
      alert("Konnte ToDo nicht als erledigt markieren: " + err.message);
      doneBtn.disabled = false;
    }
  });
  wrap.appendChild(doneBtn);

  return wrap;
}

function buildContactsSection(meta) {
  const wrap = document.createElement("div");
  wrap.className = "contacts-section";
  const heading = document.createElement("h3");
  heading.textContent = "Ansprechpartner";
  wrap.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "contacts-list";

  const fixed = [];
  if (meta.inhaber) fixed.push(meta.inhaber + " (Inhaber)");
  [meta.vertreter1, meta.vertreter2, meta.vertreter3].filter(Boolean).forEach((v) => fixed.push(v + " (Geschäftsführer)"));
  fixed.forEach((label) => {
    const li = document.createElement("li");
    li.textContent = label;
    list.appendChild(li);
  });

  const extra = Array.isArray(meta.contacts) ? meta.contacts : [];
  extra.forEach((c, idx) => {
    const li = document.createElement("li");
    const labelSpan = document.createElement("span");
    labelSpan.textContent = [c.name, c.rolle, c.telefon].filter(Boolean).join(" · ");
    li.appendChild(labelSpan);
    const removeBtn = document.createElement("span");
    removeBtn.className = "tag-remove";
    removeBtn.textContent = "×";
    removeBtn.title = "Ansprechpartner entfernen";
    removeBtn.addEventListener("click", async () => {
      try {
        await removeContact(meta.id, idx);
      } catch (err) {
        alert("Konnte Ansprechpartner nicht entfernen: " + err.message);
      }
    });
    li.appendChild(removeBtn);
    list.appendChild(li);
  });

  if (!fixed.length && !extra.length) {
    const li = document.createElement("li");
    li.className = "hint";
    li.textContent = "Noch kein Ansprechpartner hinterlegt.";
    list.appendChild(li);
  }
  wrap.appendChild(list);

  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.className = "link-btn";
  toggleBtn.textContent = "+ Ansprechpartner hinzufügen";
  wrap.appendChild(toggleBtn);

  const form = document.createElement("div");
  form.className = "contact-add-form hidden";
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "Name *";
  const roleInput = document.createElement("input");
  roleInput.type = "text";
  roleInput.placeholder = "Rolle (optional)";
  const phoneInput = document.createElement("input");
  phoneInput.type = "text";
  phoneInput.placeholder = "Telefon (optional)";
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "secondary small";
  saveBtn.textContent = "Speichern";
  form.appendChild(nameInput);
  form.appendChild(roleInput);
  form.appendChild(phoneInput);
  form.appendChild(saveBtn);
  wrap.appendChild(form);

  toggleBtn.addEventListener("click", () => form.classList.toggle("hidden"));
  saveBtn.addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    saveBtn.disabled = true;
    try {
      await addContact(meta.id, { name, rolle: roleInput.value.trim(), telefon: phoneInput.value.trim() });
      nameInput.value = "";
      roleInput.value = "";
      phoneInput.value = "";
      form.classList.add("hidden");
    } catch (err) {
      alert("Konnte Ansprechpartner nicht speichern: " + err.message);
    } finally {
      saveBtn.disabled = false;
    }
  });

  return wrap;
}

// ---------- Provisionen für ältere Einträge nachtragen (Dashboard) ----------

async function onBackfillProvisionsClick() {
  els.backfillProvisionsBtn.disabled = true;
  els.backfillProvisionsStatus.textContent = "Prüfe bestehende Einträge …";
  try {
    const result = await backfillMissingProvisions(state.customers, (done, total) => {
      els.backfillProvisionsStatus.textContent = `Prüfe … ${done}/${total}`;
    });
    els.backfillProvisionsStatus.textContent =
      result.checked === 0
        ? "Keine älteren Einträge gefunden."
        : `Fertig: ${result.updated} von ${result.checked} Kunden ergänzt.`;
  } catch (err) {
    els.backfillProvisionsStatus.textContent = "Fehler: " + err.message;
  } finally {
    els.backfillProvisionsBtn.disabled = false;
  }
}

// ---------- Nachtraeglicher Tag-Backfill (Kunden Import) ----------

async function onBackfillClick() {
  els.backfillBtn.disabled = true;
  els.backfillStatus.textContent = "Prüfe bestehende Kunden …";
  try {
    const result = await backfillSourceTag("northdata", "North Data", (done, total) => {
      els.backfillStatus.textContent = `Trage nach … ${done}/${total}`;
    });
    els.backfillStatus.textContent = `Fertig: ${result.updated} Kunden ergänzt (${result.alreadyTagged} hatten den Tag schon).`;
  } catch (err) {
    els.backfillStatus.textContent = "Fehler: " + err.message;
  } finally {
    els.backfillBtn.disabled = false;
  }
}

// ---------- Komplette Kundenliste einer Person ausdrucken ----------
//
// Fuer Kollegen, die die App nicht selbst nutzen koennen: liefert eine
// druckbare Liste ALLER Kunden dieser Person, sortiert nach Ort/PLZ/
// Straße statt einer optimierten Route (keine Geokodierung/Karte noetig,
// nutzt aber sonst dieselbe Kartendarstellung wie die Tourenplanung
// inkl. QR-Code). Enthaelt bewusst keine Finanzkennzahlen, auch wenn
// "owner" die Liste erstellt - die Zielgruppe ist die/der Kollege/Kollegin.
async function onPrintListClick() {
  const targetUid = els.printListUser.value;
  if (!targetUid) {
    els.printListStatus.textContent = "Bitte eine Person auswählen.";
    return;
  }
  els.printListBtn.disabled = true;
  els.printListStatus.textContent = "Lade Kundenliste …";
  try {
    const customers = await getCustomersForOwner(targetUid);
    if (!customers.length) {
      els.printListStatus.textContent = "Diese Person hat noch keine Kunden.";
      return;
    }
    customers.sort((a, b) => {
      const ort = (a.ort || "").localeCompare(b.ort || "", "de");
      if (ort) return ort;
      const plz = (a.plz || "").localeCompare(b.plz || "", "de");
      if (plz) return plz;
      return (a.strasse || "").localeCompare(b.strasse || "", "de");
    });
    const label = els.printListUser.options[els.printListUser.selectedIndex].textContent;
    renderCustomerListForPrint(customers, label);
    showWelcomeBanner(label);
    els.printListStatus.textContent = `Fertig: ${customers.length} Kunden. Weiter unten über "Drucken / PDF" ausdrucken.`;
  } catch (err) {
    els.printListStatus.textContent = "Fehler: " + err.message;
  } finally {
    els.printListBtn.disabled = false;
  }
}

function renderCustomerListForPrint(customers, label) {
  els.resultsPanel.classList.remove("hidden");
  els.mapDiv.classList.add("hidden");
  els.mapsLinksToggle.classList.add("hidden");
  els.mapsLinks.classList.add("hidden");
  els.resultsTitle.textContent = "Kundenliste " + label + ": " + customers.length + " Kunden (nach Ort, PLZ, Straße)";

  els.stopList.innerHTML = "";
  customers.forEach((meta, i) => {
    const li = document.createElement("li");
    const idxSpan = document.createElement("span");
    idxSpan.className = "stop-index" + (meta.lastVisitedAt ? " visited" : "");
    idxSpan.textContent = String(i + 1);
    li.appendChild(idxSpan);

    const body = document.createElement("div");
    body.className = "stop-body";
    body.innerHTML = buildCustomerDetailsHtml(meta);
    body.appendChild(buildTagsSection(meta));
    body.appendChild(buildVisitControls(meta));
    body.appendChild(buildCustomerQrCode(meta));
    li.appendChild(body);

    els.stopList.appendChild(li);
  });

  els.unresolved.classList.add("hidden");
  els.resultsPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Kunde hinzufügen ----------

function populateTagCheckboxes() {
  els.ncTagsOptions.innerHTML = "";
  TAG_OPTIONS.forEach((tag) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = tag;
    if (tag === "Akquise") {
      input.checked = true;
      input.defaultChecked = true;
      input.disabled = true;
    }
    label.appendChild(input);
    label.appendChild(document.createTextNode(tag));
    els.ncTagsOptions.appendChild(label);
  });
}

function selectedTagCheckboxes(container) {
  return Array.from(container.querySelectorAll("input[type=checkbox]:checked")).map((c) => c.value);
}

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
    tags: selectedTagCheckboxes(els.ncTagsOptions),
  };
  if (!fields.unternehmen || !fields.strasse || !fields.plz || !fields.ort || !fields.inhaber) {
    els.addCustomerStatus.textContent =
      "Bitte Unternehmen, Ansprechpartner, Straße, PLZ und Ort angeben (sonst funktioniert die Routenberechnung nicht).";
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
  const previous = new Set(selectedCities());
  const cities = Object.keys(state.byCity).sort((a, b) => a.localeCompare(b, "de"));
  const frag = document.createDocumentFragment();
  cities.forEach((city) => {
    const n = state.byCity[city].length;
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = city;
    if (previous.has(city)) input.checked = true;
    label.appendChild(input);
    label.appendChild(document.createTextNode(` ${city} (${n} ${n === 1 ? "Adresse" : "Adressen"})`));
    frag.appendChild(label);
  });
  els.citySelect.innerHTML = "";
  els.citySelect.appendChild(frag);
}

function selectedCities() {
  return Array.from(els.citySelect.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
}

function currentStartMode() {
  const checked = document.querySelector('input[name="start-mode"]:checked');
  return checked ? checked.value : "first";
}

function streetKey(a) {
  return (a.strasse || "") + "|" + (a.plz || "");
}

function onCityChange() {
  populateStreetSelect();
  refreshStartAddressOptions();
}

function populateStreetSelect() {
  const cities = selectedCities();
  const addresses = cities.flatMap((c) => state.byCity[c] || []).filter((a) => a.hasAddress);
  const byKey = new Map();
  addresses.forEach((a) => {
    const key = streetKey(a);
    if (!byKey.has(key)) byKey.set(key, { strasse: a.strasse, plz: a.plz, count: 0 });
    byKey.get(key).count++;
  });
  const entries = Array.from(byKey.entries()).sort((a, b) => a[1].strasse.localeCompare(b[1].strasse, "de"));
  els.streetSelect.innerHTML = "";
  entries.forEach(([key, info]) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = key;
    label.appendChild(input);
    label.appendChild(document.createTextNode(` ${info.strasse} (${info.plz}) – ${info.count} ${info.count === 1 ? "Kunde" : "Kunden"}`));
    els.streetSelect.appendChild(label);
  });
}

function selectedStreetKeys() {
  return Array.from(els.streetSelect.querySelectorAll("input[type=checkbox]:checked")).map((cb) => cb.value);
}

// Adressen des gewaehlten Orts, optional weiter eingeschraenkt auf die
// ausgewaehlten Straßen (leere Auswahl = keine Einschraenkung).
function filteredCityAddresses() {
  const cities = selectedCities();
  const all = cities.flatMap((c) => state.byCity[c] || []);
  const keys = selectedStreetKeys();
  if (!keys.length) return all;
  const keySet = new Set(keys);
  return all.filter((a) => keySet.has(streetKey(a)));
}

function refreshStartAddressOptions() {
  const addresses = filteredCityAddresses().filter((a) => a.hasAddress);
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
  els.startFreeAddress.classList.toggle("hidden", mode !== "frei");
  els.gpsStatus.classList.toggle("hidden", mode !== "gps");
  if (mode === "gps") requestGpsLocation();
}

function onDestinationToggle() {
  const enabled = els.destinationEnabled.checked;
  els.destinationAddress.classList.toggle("hidden", !enabled);
  els.destinationHint.classList.toggle("hidden", !enabled);
  els.returnToStartField.classList.toggle("hidden", enabled);
  if (enabled) els.returnToStart.checked = false;
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

// Freie Adresse (Start Punkt A oder Ziel Punkt B), nicht an einen Kunden
// gebunden - daher kein Firestore-Cache wie bei geocodeOne.
async function geocodeFreeText(query) {
  const url = NOMINATIM_URL + "?format=jsonv2&limit=1&countrycodes=de&q=" + encodeURIComponent(query);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = await res.json();
  if (!json || !json.length) return null;
  return { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) };
}

// Platzhalter-"Kunde" fuer Start-/Zielpunkte, die keine echten Kunden sind
// (GPS-Standort, frei eingegebene Start-Adresse, festes Ziel). `waypoint`
// unterscheidet sie in der Ergebnisliste/Karte von echten Kundenstopps.
function makeWaypointMeta(label, role) {
  return { waypoint: true, role, label };
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

// `end` (optional): Index, der als letzter Stopp reserviert wird (festes
// Ziel Punkt B). Wird beim Aufbau der Tour ausgeklammert und erst ganz zum
// Schluss angehängt; twoOptImprove laesst Anfang und Ende einer offenen
// Tour ohnehin unangetastet, dadurch bleibt das Ziel fixiert.
function nearestNeighborTour(cost, n, start, end) {
  const visited = new Array(n).fill(false);
  const tour = [start];
  visited[start] = true;
  const hasFixedEnd = end !== null && end !== undefined;
  if (hasFixedEnd) visited[end] = true;
  const stepsBeforeEnd = n - 1 - (hasFixedEnd ? 1 : 0);
  for (let step = 0; step < stepsBeforeEnd; step++) {
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
  if (hasFixedEnd) tour.push(end);
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

function solveTour(cost, n, fixedStart, closed, fixedEnd) {
  const end = fixedEnd === undefined ? null : fixedEnd;
  let starts;
  if (fixedStart !== null) {
    starts = [fixedStart];
  } else if (n <= MAX_MULTISTART_N) {
    starts = Array.from({ length: n }, (_, i) => i).filter((i) => i !== end);
  } else {
    starts = [end === 0 ? 1 : 0];
  }
  let bestTour = null;
  let bestCost = Infinity;
  starts.forEach((s) => {
    let tour = nearestNeighborTour(cost, n, s, end);
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

function formatEuroPrecise(n) {
  const num = typeof n === "number" ? n : 0;
  return num.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
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
  if (f.pensionsrueckstellungen) bits.push("Pensionsrückstellungen vorhanden");
  if (!bits.length) return "";
  return '<span class="label">Nur für dich:</span><ul class="financials-list">' + bits.map((b) => "<li>" + escapeHtml(b) + "</li>").join("") + "</ul>";
}

// Pensionsrückstellungen kommen nicht aus dem North-Data-Import und
// muessen manuell erfasst werden - deshalb eigenes, "owner"-only
// editierbares Kontrollkaestchen auf der Kundenseite (Lesen ist über
// buildFinancialsText/financialsAccess auch für freigegebene Kolleg:innen
// möglich, Schreiben bleibt "owner" vorbehalten, siehe firestore.rules).
function buildPensionToggle(meta) {
  const wrap = document.createElement("label");
  wrap.className = "checkbox pension-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(meta.financials && meta.financials.pensionsrueckstellungen);
  input.addEventListener("change", async () => {
    input.disabled = true;
    try {
      await setPensionsrueckstellungen(meta.id, input.checked);
      meta.financials = { ...(meta.financials || {}), pensionsrueckstellungen: input.checked };
      renderCustomerPage(meta);
    } catch (err) {
      alert("Konnte nicht gespeichert werden: " + err.message);
      input.checked = !input.checked;
      input.disabled = false;
    }
  });
  wrap.appendChild(input);
  wrap.appendChild(document.createTextNode(" Pensionsrückstellungen vorhanden (nur für dich sichtbar/änderbar)"));
  return wrap;
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
  const cities = selectedCities();
  if (!cities.length) {
    alert("Bitte zuerst mindestens einen Ort auswählen.");
    return;
  }
  const city = cities.join(", ");
  const mode = currentStartMode();
  if (mode === "gps" && !state.gpsCoords) {
    alert("Standort noch nicht verfügbar. Bitte GPS-Freigabe im Browser erlauben und erneut versuchen.");
    return;
  }
  const startFreeText = els.startFreeAddress.value.trim();
  if (mode === "frei" && !startFreeText) {
    alert("Bitte eine Start-Adresse eingeben (z. B. PLZ + Ort + Straße).");
    return;
  }
  const destinationOn = els.destinationEnabled.checked;
  const destinationText = els.destinationAddress.value.trim();
  if (destinationOn) {
    if (mode === "first") {
      alert('Für ein festes Ziel bitte zuerst oben einen Startpunkt wählen (nicht "Beliebig").');
      return;
    }
    if (!destinationText) {
      alert("Bitte eine Ziel-Adresse eingeben.");
      return;
    }
  }

  els.computeBtn.disabled = true;
  els.resultsPanel.classList.add("hidden");

  try {
    const all = filteredCityAddresses();
    const withAddress = all.filter((a) => a.hasAddress);
    const withoutAddress = all.filter((a) => !a.hasAddress);

    if (withAddress.length === 0) {
      hideProgress();
      renderNoRoute(city, withoutAddress);
      return;
    }

    setProgress(0, "Start-/Zieladresse werden geokodiert …");
    const startFreeCoords = mode === "frei" ? await geocodeFreeText(startFreeText) : null;
    if (mode === "frei" && !startFreeCoords) {
      hideProgress();
      alert("Die Start-Adresse konnte nicht gefunden werden. Bitte präzisieren (PLZ, Ort, Straße).");
      return;
    }
    const destinationCoords = destinationOn ? await geocodeFreeText(destinationText) : null;
    if (destinationOn && !destinationCoords) {
      hideProgress();
      alert("Die Ziel-Adresse konnte nicht gefunden werden. Bitte präzisieren (PLZ, Ort, Straße).");
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
      stopMeta.push(makeWaypointMeta("Mein Standort (Startpunkt)", "start"));
      fixedStartIndex = 0;
    } else if (mode === "frei") {
      points.push(startFreeCoords);
      stopMeta.push(makeWaypointMeta("Start: " + startFreeText, "start"));
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

    let fixedEndIndex = null;
    if (destinationOn) {
      points.push(destinationCoords);
      stopMeta.push(makeWaypointMeta("Ziel: " + destinationText, "end"));
      fixedEndIndex = points.length - 1;
    }

    const n = points.length;
    const matrix = await fetchDurationMatrix(points);

    const closed = destinationOn ? false : els.returnToStart.checked;
    const result = solveTour(matrix.durations, n, fixedStartIndex, closed, fixedEndIndex);
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

    // Umweg je Zwischenstopp ggue. dem direkten Weg vom vorherigen zum
    // naechsten Punkt - zeigt, wer wirklich "auf dem Weg" liegt, wenn ein
    // festes Ziel vorgegeben ist.
    let detours = null;
    let directDuration = null;
    let directDistance = null;
    if (fixedEndIndex !== null) {
      directDuration = matrix.durations[fixedStartIndex][fixedEndIndex];
      directDistance = matrix.distances[fixedStartIndex][fixedEndIndex];
      detours = new Array(orderIdx.length).fill(null);
      for (let k = 1; k < orderIdx.length - 1; k++) {
        const prev = orderIdx[k - 1];
        const cur = orderIdx[k];
        const next = orderIdx[k + 1];
        detours[k] = matrix.durations[prev][cur] + matrix.durations[cur][next] - matrix.durations[prev][next];
      }
    }

    let routeGeometry = null;
    try {
      const routePoints = closed ? orderedPoints.concat([orderedPoints[0]]) : orderedPoints;
      const route = await fetchRouteGeometry(routePoints);
      routeGeometry = route.geometry;
    } catch (e) {
      routeGeometry = null;
    }

    if (state.canSeeFinancials) {
      setProgress(1, "Lade Finanzkennzahlen …");
      await Promise.all(
        orderedMeta.map(async (meta) => {
          if (!meta || meta.waypoint) return;
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
      detours,
      directDuration,
      directDistance,
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
  els.resultsDirectHint.classList.add("hidden");
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

  const stopCount = r.orderedMeta.filter((m) => m && !m.waypoint).length;
  els.resultsTitle.textContent =
    r.city + ": " + stopCount + " Stopps – " + formatDistance(r.totalDistance) + " · " + formatDuration(r.totalDuration) + (r.closed ? " (Rundtour)" : "");

  if (typeof r.directDuration === "number") {
    const extra = r.totalDuration - r.directDuration;
    els.resultsDirectHint.textContent =
      "Direkt vom Start zum Ziel (ohne Zwischenstopps): " +
      formatDistance(r.directDistance) +
      " · " +
      formatDuration(r.directDuration) +
      " – mit allen Stopps dazwischen " +
      (extra > 1 ? "+" + formatDuration(extra) + " Umweg" : "praktisch kein Umweg");
    els.resultsDirectHint.classList.remove("hidden");
  } else {
    els.resultsDirectHint.classList.add("hidden");
  }

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
    const isEnd = Boolean(meta && meta.waypoint && meta.role === "end");
    const isVisited = Boolean(meta && !meta.waypoint && meta.lastVisitedAt);
    const label = isStart ? "Start" : isEnd ? "Ziel" : String(i);
    const color = isStart ? "#2c9e6b" : isEnd ? "#b6316c" : isVisited ? "#b45309" : "#1a5fb4";
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
    const popupText =
      meta && meta.waypoint
        ? escapeHtml(meta.label)
        : meta
        ? "<strong>" + escapeHtml(meta.unternehmen) + "</strong><br>" + escapeHtml(meta.strasse)
        : "Mein Standort";
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
    const isEnd = Boolean(meta && meta.waypoint && meta.role === "end");
    const isVisited = Boolean(meta && !meta.waypoint && meta.lastVisitedAt);

    const idxSpan = document.createElement("span");
    idxSpan.className = "stop-index" + (isStart ? " start" : isEnd ? " end" : isVisited ? " visited" : "");
    idxSpan.textContent = isStart ? "S" : isEnd ? "Z" : String(i);
    li.appendChild(idxSpan);

    const body = document.createElement("div");
    body.className = "stop-body";

    if (meta && meta.waypoint) {
      body.innerHTML = '<div class="company">' + escapeHtml(meta.label) + "</div>";
    } else {
      body.innerHTML = buildCustomerDetailsHtml(meta);
      body.appendChild(buildTagsSection(meta));
      body.appendChild(buildVisitControls(meta));
      body.appendChild(buildCustomerQrCode(meta));
    }

    if (i > 0) {
      const leg = document.createElement("div");
      leg.className = "leg";
      let legText = "→ " + formatDistance(r.legDistances[i - 1]) + ", " + formatDuration(r.legDurations[i - 1]) + " ab vorherigem Stopp";
      if (r.detours && typeof r.detours[i] === "number" && r.detours[i] > 1) {
        legText += " · Umweg ggü. direkter Strecke: +" + formatDuration(r.detours[i]);
      }
      leg.textContent = legText;
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

// QR-Code je Kunde: verlinkt zurueck in die App (fuer Ausdrucke/PDF), damit
// man nach einem Besuch direkt zum Kunden springen und ihn eintragen kann.
function buildCustomerQrCode(meta) {
  const wrap = document.createElement("div");
  wrap.className = "qr-code";
  try {
    const url = location.origin + location.pathname + "?customer=" + encodeURIComponent(meta.id);
    const qr = window.qrcode(0, "M");
    qr.addData(url);
    qr.make();
    wrap.innerHTML = qr.createSvgTag({ cellSize: 3, margin: 2 });
  } catch (e) {
    console.error("QR-Code konnte nicht erzeugt werden", e);
  }
  return wrap;
}

function buildCustomerDetailsHtml(meta) {
  const isVisited = Boolean(meta.lastVisitedAt);
  const addrLine = [meta.strasse, [meta.plz, meta.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  let html =
    '<div class="company"><a href="?customer=' +
    encodeURIComponent(meta.id) +
    '" class="open-customer-link" data-customer-id="' +
    escapeHtml(meta.id) +
    '">' +
    escapeHtml(meta.unternehmen) +
    "</a></div>";
  html += '<div class="address">' + escapeHtml(addrLine) + "</div>";

  // Reihenfolge (Absprache mit Matthias): Adresse, Kontaktdaten,
  // Geschäftsführer - jeweils mit sichtbarem Abstand dazwischen (siehe CSS
  // .contact/.geschaeftsfuehrer margin-top).
  const contactBits = [];
  if (meta.telefon) contactBits.push(escapeHtml(meta.telefon));
  if (meta.email) contactBits.push(escapeHtml(meta.email));
  if (meta.website) contactBits.push(escapeHtml(meta.website));
  if (contactBits.length) html += '<div class="contact">' + contactBits.join(" · ") + "</div>";

  // "Ges. Vertreter" aus North Data sind i.d.R. die Geschäftsführer -
  // deshalb einheitlich so benannt statt "Vertretung". Pipe als Trenner
  // (statt Komma), damit mehrere Namen klar auseinanderzuhalten sind.
  const vertreter = [meta.vertreter1, meta.vertreter2, meta.vertreter3].filter(Boolean);
  if (vertreter.length) {
    html += '<div class="geschaeftsfuehrer">Geschäftsführer: ' + vertreter.map(escapeHtml).join(" | ") + "</div>";
  } else if (meta.inhaber) {
    html += '<div class="geschaeftsfuehrer">Inhaber: ' + escapeHtml(meta.inhaber) + "</div>";
  }

  if (isVisited) {
    html +=
      '<div class="visited-badge">✓ ' +
      (meta.lastVisitConfirmed ? "Vom Kunden bestätigt" : "Besucht") +
      " am " +
      escapeHtml(formatDate(meta.lastVisitedAt)) +
      (meta.lastVisitNote ? ": " + escapeHtml(meta.lastVisitNote) : "") +
      "</div>";
  }
  if (meta.openTodo && meta.openTodo.text) {
    html +=
      '<div class="todo-badge">ToDo' +
      (meta.openTodo.dueDate ? " (Wiedervorlage " + escapeHtml(formatPlainDate(meta.openTodo.dueDate)) + ")" : "") +
      ": " +
      escapeHtml(meta.openTodo.text) +
      "</div>";
  }
  if (meta.financials) {
    const financialsHtml = buildFinancialsText(meta.financials);
    if (financialsHtml) html += '<div class="financials">' + financialsHtml + "</div>";
  }
  return html;
}

function buildTagsSection(meta) {
  const wrap = document.createElement("div");
  wrap.className = "tags-section";

  const pillRow = document.createElement("div");
  pillRow.className = "tags";
  wrap.appendChild(pillRow);

  const currentTags = Array.isArray(meta.tags) ? meta.tags.slice() : [];

  function renderPills() {
    pillRow.innerHTML = "";
    currentTags.forEach((tag) => {
      const pill = document.createElement("span");
      pill.className = "tag-pill";
      const label = document.createElement("span");
      label.textContent = tag;
      pill.appendChild(label);
      const remove = document.createElement("span");
      remove.className = "tag-remove";
      remove.textContent = "×";
      remove.title = "Tag entfernen";
      remove.addEventListener("click", async () => {
        try {
          await removeTag(meta.id, tag);
          const idx = currentTags.indexOf(tag);
          if (idx !== -1) currentTags.splice(idx, 1);
          meta.tags = currentTags.slice();
          renderPills();
        } catch (err) {
          alert("Konnte Tag nicht entfernen: " + err.message);
        }
      });
      pill.appendChild(remove);
      pillRow.appendChild(pill);
    });

    const remaining = TAG_OPTIONS.filter((t) => !currentTags.includes(t));
    if (remaining.length) {
      const addBtn = document.createElement("span");
      addBtn.className = "link-btn";
      addBtn.style.cursor = "pointer";
      addBtn.textContent = "+ Tag";
      addBtn.addEventListener("click", () => {
        populateSelect();
        form.classList.toggle("hidden");
      });
      pillRow.appendChild(addBtn);
    }
  }

  const form = document.createElement("div");
  form.className = "tag-add-form hidden";
  const select = document.createElement("select");
  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "secondary small";
  saveBtn.textContent = "Hinzufügen";
  form.appendChild(select);
  form.appendChild(saveBtn);
  wrap.appendChild(form);

  function populateSelect() {
    select.innerHTML = "";
    TAG_OPTIONS.filter((t) => !currentTags.includes(t)).forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t;
      opt.textContent = t;
      select.appendChild(opt);
    });
  }

  saveBtn.addEventListener("click", async () => {
    const tag = select.value;
    if (!tag) return;
    saveBtn.disabled = true;
    try {
      await addTag(meta.id, tag);
      if (!currentTags.includes(tag)) currentTags.push(tag);
      meta.tags = currentTags.slice();
      form.classList.add("hidden");
      renderPills();
    } catch (err) {
      alert("Konnte Tag nicht hinzufügen: " + err.message);
    } finally {
      saveBtn.disabled = false;
    }
  });

  renderPills();
  return wrap;
}

// ---------- Kunden-Suche ----------

const SEARCH_FIELDS = ["unternehmen", "ort", "strasse", "plz", "vertreter1", "vertreter2", "vertreter3", "inhaber"];
const SEARCH_RESULT_LIMIT = 30;

function onSearchInput() {
  state.activeSearchFilter = null;
  applySearchFiltersAndRender();
}

function onFilterChipClick(filter) {
  state.activeSearchFilter = state.activeSearchFilter === filter ? null : filter;
  if (state.activeSearchFilter) els.searchInput.value = "";
  applySearchFiltersAndRender();
}

function applySearchFiltersAndRender() {
  els.filterMembersBtn.classList.toggle("active", state.activeSearchFilter === "members");
  els.filterConsultationsBtn.classList.toggle("active", state.activeSearchFilter === "consultations");

  if (state.activeSearchFilter === "members") {
    const matches = state.customers.filter((c) => c.membershipSigned).sort((a, b) => (a.unternehmen || "").localeCompare(b.unternehmen || "", "de"));
    renderSearchResults(matches.slice(0, SEARCH_RESULT_LIMIT), matches.length);
    return;
  }
  if (state.activeSearchFilter === "consultations") {
    const matches = state.customers.filter((c) => c.consultationRequested).sort((a, b) => (a.unternehmen || "").localeCompare(b.unternehmen || "", "de"));
    renderSearchResults(matches.slice(0, SEARCH_RESULT_LIMIT), matches.length);
    return;
  }

  const q = els.searchInput.value.trim().toLowerCase();
  if (!q) {
    els.searchResults.classList.add("hidden");
    els.searchResults.innerHTML = "";
    els.searchEmpty.classList.add("hidden");
    return;
  }
  const matches = state.customers
    .filter((c) => SEARCH_FIELDS.some((f) => (c[f] || "").toLowerCase().includes(q)))
    .sort((a, b) => (a.unternehmen || "").localeCompare(b.unternehmen || "", "de"));
  renderSearchResults(matches.slice(0, SEARCH_RESULT_LIMIT), matches.length);
}

function renderSearchResults(results, totalCount) {
  els.searchResults.innerHTML = "";
  if (!results.length) {
    els.searchResults.classList.add("hidden");
    els.searchEmpty.classList.remove("hidden");
    return;
  }
  els.searchEmpty.classList.add("hidden");
  els.searchResults.classList.remove("hidden");

  results.forEach((meta) => {
    const li = document.createElement("li");
    li.className = "search-result";

    const summary = document.createElement("div");
    summary.className = "search-result-summary";
    const isVisited = Boolean(meta.lastVisitedAt);
    const addrLine = [meta.strasse, [meta.plz, meta.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    summary.innerHTML =
      '<span class="stop-index' +
      (isVisited ? " visited" : "") +
      '">' +
      (isVisited ? "✓" : "") +
      "</span>" +
      '<div><div class="company">' +
      escapeHtml(meta.unternehmen) +
      '</div><div class="address">' +
      escapeHtml(addrLine) +
      "</div></div>";
    li.appendChild(summary);

    summary.addEventListener("click", () => openCustomerPage(meta.id));

    els.searchResults.appendChild(li);
  });

  if (totalCount > results.length) {
    const hint = document.createElement("li");
    hint.className = "hint";
    hint.style.padding = "0.5rem 0.2rem";
    hint.textContent = totalCount + " Treffer, zeige die ersten " + results.length + " - bitte genauer eingrenzen.";
    els.searchResults.appendChild(hint);
  }
}

// Kleines Label+Eingabefeld-Paar fuer das Besuchsformular (Besuch am /
// Gesprochen mit / Gesprächsnotizen / ToDo / Wiedervorlage am).
function buildLabeledField(labelText, type, placeholder) {
  const wrap = document.createElement("label");
  wrap.className = "visit-field";
  const span = document.createElement("span");
  span.textContent = labelText;
  wrap.appendChild(span);
  const input = type === "textarea" ? document.createElement("textarea") : document.createElement("input");
  if (type === "textarea") {
    input.rows = 2;
  } else {
    input.type = type;
  }
  if (placeholder) input.placeholder = placeholder;
  wrap.appendChild(input);
  return { wrap, input };
}

function todayIsoDate() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
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

  const dateField = buildLabeledField("Besuch am", "date");
  const withField = buildLabeledField("Gesprochen mit", "text", "Name der Ansprechperson");
  const noteField = buildLabeledField("Gesprächsnotizen", "textarea", "z. B. Gesprächsinhalt");
  const todoField = buildLabeledField("ToDo", "text", "z. B. Unterlagen nachreichen (optional)");
  const todoDateField = buildLabeledField("Wiedervorlage am", "date");
  form.appendChild(dateField.wrap);
  form.appendChild(withField.wrap);
  form.appendChild(noteField.wrap);
  form.appendChild(todoField.wrap);
  form.appendChild(todoDateField.wrap);

  const actions = document.createElement("div");
  actions.className = "visit-form-actions";

  const selfReportBtn = document.createElement("button");
  selfReportBtn.type = "button";
  selfReportBtn.className = "secondary small";
  selfReportBtn.textContent = "Besuch selbst eintragen";
  actions.appendChild(selfReportBtn);

  const confirmOpenBtn = document.createElement("button");
  confirmOpenBtn.type = "button";
  confirmOpenBtn.className = "primary small";
  confirmOpenBtn.textContent = "Vom Kunden bestätigen lassen";
  actions.appendChild(confirmOpenBtn);

  form.appendChild(actions);
  const formHint = document.createElement("p");
  formHint.className = "hint";
  formHint.textContent = "„Besuch selbst eintragen“ reicht. „Vom Kunden bestätigen lassen“ zusätzlich, wenn der Kunde den Besuch direkt auf deinem Handy bestätigen soll.";
  form.appendChild(formHint);
  wrap.appendChild(form);

  const historyBox = document.createElement("div");
  historyBox.className = "visit-history hidden";
  wrap.appendChild(historyBox);

  function resetForm() {
    dateField.input.value = "";
    withField.input.value = "";
    noteField.input.value = "";
    todoField.input.value = "";
    todoDateField.input.value = "";
  }

  function collectDetails() {
    return {
      visitedAt: dateField.input.value || todayIsoDate(),
      visitedWith: withField.input.value.trim(),
      note: noteField.input.value.trim(),
      todoText: todoField.input.value.trim(),
      todoDueDate: todoDateField.input.value || null,
    };
  }

  toggleBtn.addEventListener("click", () => {
    if (form.classList.contains("hidden") && !dateField.input.value) dateField.input.value = todayIsoDate();
    form.classList.toggle("hidden");
  });

  confirmOpenBtn.addEventListener("click", () => {
    openConfirmOverlay(meta, collectDetails());
    form.classList.add("hidden");
    resetForm();
  });

  selfReportBtn.addEventListener("click", () => {
    startSelfReportVisit(meta, collectDetails());
    form.classList.add("hidden");
    resetForm();
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
        const bits = [formatDate(v.visitedAt)];
        if (v.confirmedByCustomer) bits.push("✓ vom Kunden bestätigt");
        bits.push("– " + (v.byName || "?"));
        if (v.visitedWith) bits.push("(mit " + v.visitedWith + ")");
        li.textContent = bits.join(" ") + (v.note ? ": " + v.note : "");
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
      label:
        meta && meta.waypoint
          ? meta.label
          : meta
          ? meta.unternehmen + ", " + meta.strasse + ", " + [meta.plz, meta.ort].filter(Boolean).join(" ")
          : "Mein Standort",
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

function resetYesNoToggles() {
  els.yesnoToggles.forEach((toggle) => {
    toggle.querySelectorAll(".yesno-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === "false");
    });
  });
  els.consultationDatetime.classList.add("hidden");
  els.consultationDate.value = "";
  els.consultationTime.value = "";
  els.provisionAmountField.classList.add("hidden");
  els.provisionAmount.value = "";
}

function openConfirmOverlay(meta, details) {
  state.pendingConfirm = { customerId: meta.id, meta, details, visitId: null };
  els.confirmCompany.textContent = meta.unternehmen;
  els.confirmStepVisit.classList.remove("hidden");
  els.confirmStepOutcome.classList.add("hidden");
  resetYesNoToggles();
  els.confirmOverlay.classList.remove("hidden");
}

function closeConfirmOverlay() {
  state.pendingConfirm = null;
  els.confirmOverlay.classList.add("hidden");
}

async function startSelfReportVisit(meta, details) {
  state.pendingConfirm = { customerId: meta.id, meta, details, visitId: null };
  try {
    const visitId = await addVisit(meta.id, { ...details, byUid: state.user.uid, byName: state.user.email, confirmedByCustomer: false });
    state.pendingConfirm.visitId = visitId;
    els.confirmCompany2.textContent = meta.unternehmen;
    resetYesNoToggles();
    els.confirmStepVisit.classList.add("hidden");
    els.confirmStepOutcome.classList.remove("hidden");
    els.confirmOverlay.classList.remove("hidden");
  } catch (err) {
    alert("Konnte Besuch nicht eintragen: " + err.message);
    state.pendingConfirm = null;
  }
}

async function onConfirmVisitClick() {
  if (!state.pendingConfirm) return;
  const { customerId, details } = state.pendingConfirm;
  els.confirmBtn.disabled = true;
  try {
    const visitId = await addVisit(customerId, { ...details, byUid: state.user.uid, byName: state.user.email, confirmedByCustomer: true });
    state.pendingConfirm.visitId = visitId;
    els.confirmCompany2.textContent = state.pendingConfirm.meta.unternehmen;
    els.confirmStepVisit.classList.add("hidden");
    els.confirmStepOutcome.classList.remove("hidden");
  } catch (err) {
    alert("Konnte Besuch nicht bestätigen: " + err.message);
  } finally {
    els.confirmBtn.disabled = false;
  }
}

function onYesNoClick(toggle, btn) {
  toggle.querySelectorAll(".yesno-btn").forEach((b) => b.classList.toggle("active", b === btn));
  if (toggle.dataset.field === "consultation") {
    els.consultationDatetime.classList.toggle("hidden", btn.dataset.value !== "true");
  }
  if (toggle.dataset.field === "membership" || toggle.dataset.field === "consultation") {
    updateProvisionField();
  }
}

// Provision wird direkt beim Speichern des Besuchsergebnisses verbucht -
// kein spaeterer Schritt fuer den vereinbarten Termin noetig. Der
// Vorschlagsbetrag richtet sich nach der Kombination aus beiden Toggles,
// bleibt aber editierbar.
function updateProvisionField() {
  const membership = yesNoValue("membership");
  const consultation = yesNoValue("consultation");
  if (!membership && !consultation) {
    els.provisionAmountField.classList.add("hidden");
    return;
  }
  els.provisionAmountField.classList.remove("hidden");
  els.provisionAmount.value = membership && consultation ? CONSULT_YES_AMOUNT : membership ? MEMBERSHIP_DEFAULT_AMOUNT : CONSULT_NO_AMOUNT;
}

function yesNoValue(field) {
  const toggle = document.querySelector('.yesno-toggle[data-field="' + field + '"]');
  const active = toggle.querySelector(".yesno-btn.active");
  return active ? active.dataset.value === "true" : false;
}

async function onOutcomeSaveClick() {
  if (!state.pendingConfirm || !state.pendingConfirm.visitId) return;
  const { customerId, visitId } = state.pendingConfirm;
  const membershipSigned = yesNoValue("membership");
  const consultationRequested = yesNoValue("consultation");
  let consultationAt = null;
  if (consultationRequested && els.consultationDate.value) {
    consultationAt = els.consultationDate.value + "T" + (els.consultationTime.value || "00:00") + ":00";
  }
  let provisionAmount = 0;
  if (membershipSigned || consultationRequested) {
    provisionAmount = parseFloat(String(els.provisionAmount.value).replace(",", ".")) || 0;
  }
  els.outcomeSaveBtn.disabled = true;
  try {
    await updateVisitOutcome(customerId, visitId, { membershipSigned, consultationRequested, consultationAt, provisionAmount });
    closeConfirmOverlay();
    refreshDashboard();
  } catch (err) {
    alert("Konnte Angaben nicht speichern: " + err.message);
  } finally {
    els.outcomeSaveBtn.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
