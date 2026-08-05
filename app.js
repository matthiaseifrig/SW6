/* Tourenplaner – Client-seitige App.
 * Login/Daten: Firebase (Authentication + Firestore).
 * Geokodierung via OpenStreetMap Nominatim, Routing/Distanzmatrix via OSRM (project-osrm.org).
 */
import { onAuthChange, login, logout, ensureUserDoc } from "./js/firebase-app.js?v=20260805c";
import {
  subscribeCustomers,
  addCustomer,
  saveGeocodeResult,
  addVisit,
  updateVisitOutcome,
  resolveConsultation,
  backfillPendingConsultations,
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
} from "./js/data-store.js?v=20260805c";
import { parseNorthDataCsv } from "./js/northdata-import.js?v=20260805c";
import { TAG_OPTIONS } from "./js/tags.js?v=20260805c";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const OSRM_TABLE_URL = "https://router.project-osrm.org/table/v1/driving/";
const OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/";
const NOMINATIM_DELAY_MS = 1100; // Nominatim-Nutzungsrichtlinie: max. 1 Anfrage/Sekunde
const MAX_MULTISTART_N = 120;
const GOOGLE_MAPS_CHUNK = 10;

// Provisions-Standardsaetze (netto, editierbar bei der Eingabe):
// - Aufnahme direkt beim Besuch (kein separat vereinbarter Termin)
// - separat vereinbarter Beratungstermin, der stattfindet und zu keiner
//   Aufnahme fuehrt
// - separat vereinbarter Beratungstermin, der direkt zu einer Aufnahme fuehrt
const MEMBERSHIP_DEFAULT_AMOUNT = 150;
const CONSULT_NO_AMOUNT = 112.5;
const CONSULT_YES_AMOUNT = 200;

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
  pendingConfirm: null, // { customerId, note, visitId, outcome }
  pendingConsultationResolve: null, // { customerId, visitId, meta }
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

  els.dashboardPanel = document.getElementById("dashboard-panel");
  els.statCustomers = document.getElementById("stat-customers");
  els.statVisits = document.getElementById("stat-visits");
  els.statMemberships = document.getElementById("stat-memberships");
  els.statConsultations = document.getElementById("stat-consultations");
  els.statProvision = document.getElementById("stat-provision");
  els.dashboardBreakdown = document.getElementById("dashboard-breakdown");
  els.dashboardBreakdownBody = document.getElementById("dashboard-breakdown-body");

  els.openConsultationsPanel = document.getElementById("open-consultations-panel");
  els.openConsultationsList = document.getElementById("open-consultations-list");
  els.openConsultationsEmpty = document.getElementById("open-consultations-empty");
  els.backfillConsultationsBtn = document.getElementById("backfill-consultations-btn");
  els.backfillConsultationsStatus = document.getElementById("backfill-consultations-status");

  els.deeplinkPanel = document.getElementById("deeplink-panel");
  els.deeplinkBackBtn = document.getElementById("deeplink-back-btn");
  els.deeplinkBody = document.getElementById("deeplink-body");

  els.ncTagsOptions = document.getElementById("nc-tags-options");

  els.citySelect = document.getElementById("city-select");
  els.streetSelect = document.getElementById("street-select");
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
  els.confirmStepVisit = document.getElementById("confirm-step-visit");
  els.confirmCompany = document.getElementById("confirm-company");
  els.confirmBtn = document.getElementById("confirm-btn");
  els.confirmCancel = document.getElementById("confirm-cancel");
  els.confirmStepOutcome = document.getElementById("confirm-step-outcome");
  els.confirmCompany2 = document.getElementById("confirm-company-2");
  els.membershipAmountField = document.getElementById("membership-amount-field");
  els.membershipAmount = document.getElementById("membership-amount");
  els.consultationDatetime = document.getElementById("consultation-datetime");
  els.consultationDate = document.getElementById("consultation-date");
  els.consultationTime = document.getElementById("consultation-time");
  els.outcomeSaveBtn = document.getElementById("outcome-save-btn");
  els.outcomeSkipBtn = document.getElementById("outcome-skip-btn");
  els.yesnoToggles = document.querySelectorAll(".yesno-toggle");

  els.consultationResolveOverlay = document.getElementById("consultation-resolve-overlay");
  els.crCompany = document.getElementById("cr-company");
  els.crWhen = document.getElementById("cr-when");
  els.crToggle = document.getElementById("cr-toggle");
  els.crAmount = document.getElementById("cr-amount");
  els.crSaveBtn = document.getElementById("cr-save-btn");
  els.crCancelBtn = document.getElementById("cr-cancel-btn");
}

function bindStaticEvents() {
  els.loginForm.addEventListener("submit", onLoginSubmit);
  els.logoutBtn.addEventListener("click", () => logout());
  els.scopeToggle.addEventListener("change", onScopeToggle);

  els.searchInput.addEventListener("input", onSearchInput);

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

  els.citySelect.addEventListener("change", onCityChange);
  els.streetSelect.addEventListener("change", refreshStartAddressOptions);
  els.startModeRadios.forEach((r) => r.addEventListener("change", onStartModeChange));
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

  els.crSaveBtn.addEventListener("click", onCrSaveClick);
  els.crCancelBtn.addEventListener("click", closeConsultationResolve);
  els.backfillConsultationsBtn.addEventListener("click", onBackfillConsultationsClick);

  els.deeplinkBackBtn.addEventListener("click", closeCustomerPage);

  document.addEventListener("click", (ev) => {
    const link = ev.target.closest(".open-customer-link");
    if (!link) return;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
    ev.preventDefault();
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
      if (selectedCities().length) onCityChange();
      maybeShowImportPanel();
      refreshDashboard();
      refreshOpenConsultations();
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
  els.deeplinkBody.innerHTML = "";
  const detailsDiv = document.createElement("div");
  detailsDiv.innerHTML = buildCustomerDetailsHtml(meta);
  els.deeplinkBody.appendChild(detailsDiv);

  if (state.role === "owner" && !meta.financials) {
    try {
      const fin = await getFinancials(meta.id);
      if (fin) {
        const finDiv = document.createElement("div");
        finDiv.className = "financials";
        finDiv.innerHTML = buildFinancialsText(fin);
        detailsDiv.appendChild(finDiv);
      }
    } catch (e) {
      /* Finanzkennzahlen optional - Fehler ignorieren */
    }
  }

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

function renderVisitHistoryFull(container, meta, visits) {
  container.innerHTML = "";
  const heading = document.createElement("h3");
  heading.textContent = "Besuche & Termine";
  container.appendChild(heading);

  if (meta.pendingConsultation) {
    const pending = document.createElement("div");
    pending.className = "pending-consultation";
    pending.innerHTML = "<strong>Offener Beratungstermin</strong> am " + escapeHtml(formatPlainDateTime(meta.pendingConsultation.at));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "primary small";
    btn.textContent = "Ergebnis eintragen";
    btn.addEventListener("click", () => openConsultationResolve(meta));
    pending.appendChild(document.createElement("br"));
    pending.appendChild(btn);
    container.appendChild(pending);
  }

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
    if (v.note) parts.push(": " + v.note);

    const badges = [];
    if (v.membershipSigned) badges.push("Aufnahme direkt beim Besuch (" + formatEuroPrecise(v.membershipAmount) + ")");
    if (v.consultationRequested) {
      if (v.consultationOutcome === "membership") badges.push("Termin → Aufnahme (" + formatEuroPrecise(v.consultationAmount) + ")");
      else if (v.consultationOutcome === "none") badges.push("Termin → keine Aufnahme (" + formatEuroPrecise(v.consultationAmount) + ")");
      else badges.push("Termin vereinbart für " + escapeHtml(formatPlainDateTime(v.consultationAt)) + " (Ergebnis offen)");
    }

    li.innerHTML = escapeHtml(parts.join(" ")) + (badges.length ? '<div class="visit-badges">' + badges.map(escapeHtml).join(" · ") + "</div>" : "");
    ul.appendChild(li);
  });
  container.appendChild(ul);
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
  [meta.vertreter1, meta.vertreter2, meta.vertreter3].filter(Boolean).forEach((v) => fixed.push(v + " (Vertretung)"));
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

// ---------- Offene Beratungstermine (Dashboard) ----------

function refreshOpenConsultations() {
  const pending = state.customers.filter((c) => c.pendingConsultation);
  els.openConsultationsList.classList.toggle("hidden", pending.length === 0);
  els.openConsultationsEmpty.classList.toggle("hidden", pending.length > 0);
  els.openConsultationsList.innerHTML = "";
  pending
    .sort((a, b) => new Date(a.pendingConsultation.at) - new Date(b.pendingConsultation.at))
    .forEach((meta) => {
      const li = document.createElement("li");
      li.className = "search-result";
      const summary = document.createElement("div");
      summary.className = "search-result-summary";
      summary.innerHTML =
        '<div><div class="company"><a href="?customer=' +
        encodeURIComponent(meta.id) +
        '" class="open-customer-link" data-customer-id="' +
        escapeHtml(meta.id) +
        '">' +
        escapeHtml(meta.unternehmen) +
        '</a></div><div class="address">Termin am ' +
        escapeHtml(formatPlainDateTime(meta.pendingConsultation.at)) +
        "</div></div>";
      li.appendChild(summary);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "primary small";
      btn.textContent = "Ergebnis eintragen";
      btn.addEventListener("click", () => openConsultationResolve(meta));
      li.appendChild(btn);
      els.openConsultationsList.appendChild(li);
    });
}

function openConsultationResolve(meta) {
  if (!meta.pendingConsultation) return;
  state.pendingConsultationResolve = { customerId: meta.id, visitId: meta.pendingConsultation.visitId };
  els.crCompany.textContent = meta.unternehmen;
  els.crWhen.textContent = "Termin am " + formatPlainDateTime(meta.pendingConsultation.at);
  els.crToggle.querySelectorAll(".yesno-btn").forEach((b) => b.classList.toggle("active", b.dataset.value === "false"));
  els.crAmount.value = CONSULT_NO_AMOUNT;
  els.consultationResolveOverlay.classList.remove("hidden");
}

function closeConsultationResolve() {
  state.pendingConsultationResolve = null;
  els.consultationResolveOverlay.classList.add("hidden");
}

async function onCrSaveClick() {
  if (!state.pendingConsultationResolve) return;
  const { customerId, visitId } = state.pendingConsultationResolve;
  const active = els.crToggle.querySelector(".yesno-btn.active");
  const membershipSigned = active ? active.dataset.value === "true" : false;
  const amount = parseFloat(String(els.crAmount.value).replace(",", ".")) || 0;
  els.crSaveBtn.disabled = true;
  try {
    await resolveConsultation(customerId, visitId, { membershipSigned, amount });
    closeConsultationResolve();
    refreshDashboard();
  } catch (err) {
    alert("Konnte Ergebnis nicht speichern: " + err.message);
  } finally {
    els.crSaveBtn.disabled = false;
  }
}

async function onBackfillConsultationsClick() {
  els.backfillConsultationsBtn.disabled = true;
  els.backfillConsultationsStatus.textContent = "Prüfe bestehende Termine …";
  try {
    const result = await backfillPendingConsultations(state.user.uid, (done, total) => {
      els.backfillConsultationsStatus.textContent = `Prüfe … ${done}/${total}`;
    });
    els.backfillConsultationsStatus.textContent =
      result.checked === 0
        ? "Keine älteren Termine gefunden."
        : `Fertig: ${result.updated} von ${result.checked} älteren Terminen jetzt in der Liste sichtbar.`;
  } catch (err) {
    els.backfillConsultationsStatus.textContent = "Fehler: " + err.message;
  } finally {
    els.backfillConsultationsBtn.disabled = false;
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
    const opt = document.createElement("option");
    opt.value = city;
    const n = state.byCity[city].length;
    opt.textContent = `${city} (${n} ${n === 1 ? "Adresse" : "Adressen"})`;
    if (previous.has(city)) opt.selected = true;
    frag.appendChild(opt);
  });
  els.citySelect.innerHTML = "";
  els.citySelect.appendChild(frag);
}

function selectedCities() {
  return Array.from(els.citySelect.selectedOptions).map((o) => o.value);
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
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${info.strasse} (${info.plz}) – ${info.count} ${info.count === 1 ? "Kunde" : "Kunden"}`;
    els.streetSelect.appendChild(opt);
  });
}

function selectedStreetKeys() {
  return Array.from(els.streetSelect.selectedOptions).map((o) => o.value);
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
      body.innerHTML = buildCustomerDetailsHtml(meta);
      body.appendChild(buildTagsSection(meta));
      body.appendChild(buildVisitControls(meta));
      body.appendChild(buildCustomerQrCode(meta));
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

  form.appendChild(textarea);
  form.appendChild(actions);
  const formHint = document.createElement("p");
  formHint.className = "hint";
  formHint.textContent = "„Besuch selbst eintragen“ reicht als Notiz. „Vom Kunden bestätigen lassen“ ist optional, wenn der Kunde den Besuch zusätzlich direkt auf deinem Handy bestätigen soll.";
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

  selfReportBtn.addEventListener("click", () => {
    startSelfReportVisit(meta, textarea.value.trim());
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

function resetYesNoToggles() {
  els.yesnoToggles.forEach((toggle) => {
    toggle.querySelectorAll(".yesno-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === "false");
    });
  });
  els.consultationDatetime.classList.add("hidden");
  els.consultationDate.value = "";
  els.consultationTime.value = "";
  els.membershipAmountField.classList.add("hidden");
  els.membershipAmount.value = MEMBERSHIP_DEFAULT_AMOUNT;
}

function openConfirmOverlay(meta, note) {
  state.pendingConfirm = { customerId: meta.id, meta, note, visitId: null };
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

async function startSelfReportVisit(meta, note) {
  state.pendingConfirm = { customerId: meta.id, meta, note, visitId: null };
  try {
    const visitId = await addVisit(meta.id, { note, byUid: state.user.uid, byName: state.user.email, confirmedByCustomer: false });
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
  const { customerId, note } = state.pendingConfirm;
  els.confirmBtn.disabled = true;
  try {
    const visitId = await addVisit(customerId, { note, byUid: state.user.uid, byName: state.user.email, confirmedByCustomer: true });
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
  if (toggle.dataset.field === "membership") {
    els.membershipAmountField.classList.toggle("hidden", btn.dataset.value !== "true");
  }
  if (toggle.dataset.field === "cr-membership") {
    els.crAmount.value = btn.dataset.value === "true" ? CONSULT_YES_AMOUNT : CONSULT_NO_AMOUNT;
  }
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
  let membershipAmount = null;
  if (membershipSigned) {
    membershipAmount = parseFloat(String(els.membershipAmount.value).replace(",", ".")) || 0;
  }
  els.outcomeSaveBtn.disabled = true;
  try {
    await updateVisitOutcome(customerId, visitId, { membershipSigned, membershipAmount, consultationRequested, consultationAt });
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
