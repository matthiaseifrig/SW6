// Telefonakquise (Pre-Sales): Wiedervorlagen, Anrufliste nach PLZ/Ort,
// Anruf-Bildschirm (eine Firma pro Bildschirm, fuers Handy), Termin
// vereinbaren, Auswertung und "Adresspool zuweisen" fuer den Admin.
//
// Bekommt den App-Zustand und einige Helfer aus app.js per initCalls()
// uebergeben (ctx), damit hier keine zweite Datenhaltung entsteht.
import {
  logCall,
  createAppointment,
  getCalls,
  getAppointmentsSetBy,
  getFirmActivity,
  getAllCustomers,
  assignFirms,
  listUsers,
  inPoolOf,
} from "./data-store.js?v=20261109i";

let ctx = null;
const els = {};
const call = {
  tab: "wv",
  queue: [], // Firmen-IDs fuer "Neue Firmen"
  queueIndex: 0,
  callbacks: [],
  current: null, // aktuelle Firma im Anruf-Bildschirm
  source: null, // "neu" | "wv" | "einzeln"
  users: null,
  period: "monat",
  assignCandidates: [],
};

export const RESULT_LABELS = {
  nicht_erreicht: "nicht erreicht",
  rueckruf: "später nochmal",
  kein_interesse: "kein Interesse",
  termin: "Termin vereinbart",
  falsche_nummer: "falsche Nummer",
  nicht_mehr_anrufen: "nicht mehr anrufen",
};
const TYPE_LABELS = { bdst: "BdSt-Mitgliedschaft", makler: "Steuerthema (Makler)" };
const STATUS_LABELS = {
  geplant: "geplant",
  verschoben: "verschoben",
  durchgefuehrt: "durchgeführt",
  abgesagt: "abgesagt",
  nicht_angetroffen: "nicht angetroffen",
};
export const KENNZAHL_PRESALES = 50;
export { periodStart, toDate, deDate, deDateTime, esc, todayIso, addDaysIso, TYPE_LABELS, STATUS_LABELS, telHref, loadUsers };

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function todayIso() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function addDaysIso(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function deDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return d + "." + m + "." + y;
}
function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d;
}
function deDateTime(ts) {
  const d = toDate(ts);
  if (!d) return "";
  return d.toLocaleDateString("de-DE") + ", " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " Uhr";
}
function telHref(tel) {
  let t = String(tel || "").replace(/[^\d+]/g, "");
  return t ? "tel:" + t : "";
}

export function initCalls(context) {
  ctx = context;
  ["call-view", "call-wv-pane", "call-new-pane", "callback-list", "call-filter", "call-new-info", "call-start-btn", "call-card",
   "wv-count", "neu-count", "presales-stats", "presales-stat-grid", "presales-table-wrap", "presales-table-body",
   "assign-from", "assign-to", "assign-filter", "assign-only-fresh", "assign-preview-btn", "assign-btn", "assign-status",
   "tile-anrufen-count"].forEach((id) => {
    els[id] = document.getElementById(id);
  });
  els.tabs = document.querySelectorAll(".call-tab");
  els.periodBtns = document.querySelectorAll(".period-btn:not(.appt-period)");

  els.tabs.forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.calltab)));
  els["call-filter"].addEventListener("input", refreshNewPane);
  els["call-start-btn"].addEventListener("click", startQueue);
  els.periodBtns.forEach((b) =>
    b.addEventListener("click", () => {
      call.period = b.dataset.period;
      els.periodBtns.forEach((x) => x.classList.toggle("active", x === b));
      renderPresalesStats();
    })
  );
  els["assign-preview-btn"].addEventListener("click", onAssignPreview);
  els["assign-btn"].addEventListener("click", onAssignRun);
  ["assign-from", "assign-filter", "assign-only-fresh"].forEach((id) =>
    els[id].addEventListener("input", () => {
      els["assign-btn"].disabled = true;
      els["assign-status"].textContent = "";
    })
  );
}

// ---------- Pool + Listen ----------

function myPool() {
  const uid = ctx.state.user.uid;
  return ctx.state.customers.filter((c) => inPoolOf(c, uid));
}

function isFresh(c) {
  return !c.lastCall && !c.doNotCall && !c.membershipSigned && !c.nextAppointment && !(c.callback && c.callback.date) && !c.lastVisitedAt;
}

function matchesArea(c, filter) {
  const f = String(filter || "").trim().toLowerCase();
  if (!f) return true;
  if (/^\d+$/.test(f)) return String(c.plz || "").startsWith(f);
  return String(c.ort || "").toLowerCase().includes(f);
}

function newFirms() {
  const filter = els["call-filter"].value;
  return myPool()
    .filter(isFresh)
    .filter((c) => matchesArea(c, filter))
    .sort((a, b) =>
      (a.plz || "").localeCompare(b.plz || "", "de") ||
      (a.ort || "").localeCompare(b.ort || "", "de") ||
      (a.strasse || "").localeCompare(b.strasse || "", "de")
    );
}

// Wird von app.js bei jeder Aenderung der Kundenliste aufgerufen.
export function onCustomersChanged() {
  if (!ctx || !ctx.state.user) return;
  // Wiedervorlagen aus der Live-Liste aktualisieren (Firmen ausserhalb
  // der geladenen Liste kommen per getMyCallbacks beim Oeffnen dazu).
  const uid = ctx.state.user.uid;
  const byId = new Map(call.callbacks.map((c) => [c.id, c]));
  ctx.state.customers.forEach((c) => {
    if (c.callback && c.callback.byUid === uid) byId.set(c.id, c);
    else if (byId.has(c.id)) byId.delete(c.id);
  });
  call.callbacks = Array.from(byId.values());
  updateCounts();
  if (ctx.currentView() === "anrufen" && !call.current) {
    renderCallbackList();
    refreshNewPane();
  }
}

function dueCallbacks() {
  const today = todayIso();
  return call.callbacks.filter((c) => c.callback && c.callback.date && c.callback.date <= today);
}

function updateCounts() {
  els["wv-count"].textContent = String(call.callbacks.length);
  els["neu-count"].textContent = String(newFirms().length);
  const due = dueCallbacks().length;
  els["tile-anrufen-count"].textContent = due ? due + " Wiedervorlage" + (due === 1 ? "" : "n") + " fällig" : "";
  els["tile-anrufen-count"].classList.toggle("hidden", !due);
}

async function reloadCallbacks() {
  try {
    // Wiedervorlagen nur aus den eigenen (sichtbaren) Firmen
    const uid = ctx.state.user.uid;
    call.callbacks = ctx.state.customers.filter((c) => c.callback && c.callback.byUid === uid && c.callback.date);
  } catch (err) {
    console.error(err);
  }
  updateCounts();
  renderCallbackList();
}

// Beim Oeffnen des Bildschirms "Anrufen"
export function onEnterCallView() {
  loadUsers();
  if (ctx.state.pendingCallFirm) {
    const firm = ctx.state.pendingCallFirm;
    ctx.state.pendingCallFirm = null;
    openCard(firm, "einzeln");
    return;
  }
  if (!call.current) {
    showLists();
  }
  reloadCallbacks();
  refreshNewPane();
}

function switchTab(tab) {
  call.tab = tab;
  els.tabs.forEach((b) => b.classList.toggle("active", b.dataset.calltab === tab));
  els["call-wv-pane"].classList.toggle("hidden", tab !== "wv");
  els["call-new-pane"].classList.toggle("hidden", tab !== "neu");
}

function showLists() {
  call.current = null;
  els["call-card"].classList.add("hidden");
  els["call-card"].innerHTML = "";
  document.querySelector(".call-tabs").classList.remove("hidden");
  switchTab(call.tab);
  renderCallbackList();
  refreshNewPane();
}

function renderCallbackList() {
  const ul = els["callback-list"];
  ul.innerHTML = "";
  const today = todayIso();
  const list = call.callbacks
    .filter((c) => c.callback && c.callback.date)
    .sort((a, b) => (a.callback.date + (a.callback.time || "")).localeCompare(b.callback.date + (b.callback.time || "")));
  if (!list.length) {
    ul.innerHTML = '<li class="empty-hint">Keine Wiedervorlagen. Bei „Später nochmal“ eingetragene Rückrufe erscheinen hier.</li>';
    return;
  }
  list.forEach((c) => {
    const li = document.createElement("li");
    const cb = c.callback;
    const state = cb.date < today ? "overdue" : cb.date === today ? "today" : "later";
    li.className = "callback-item " + state;
    const when = (state === "today" ? "Heute" : deDate(cb.date)) + (cb.time ? ", " + cb.time + " Uhr" : "") + (state === "overdue" ? " – überfällig" : "");
    li.innerHTML =
      '<button type="button" class="callback-main">' +
      '<span class="callback-when">' + esc(when) + "</span>" +
      '<span class="callback-firm">' + esc(c.unternehmen) + "</span>" +
      '<span class="callback-place">' + esc([c.plz, c.ort].filter(Boolean).join(" ")) + (c.telefon ? " · " + esc(c.telefon) : "") + "</span>" +
      (cb.note ? '<span class="callback-note">' + esc(cb.note) + "</span>" : "") +
      "</button>" +
      '<a href="?customer=' + encodeURIComponent(c.id) + '" class="open-customer-link callback-open" data-customer-id="' + esc(c.id) + '">Firma öffnen</a>';
    li.querySelector(".callback-main").addEventListener("click", () => openCard(c, "wv"));
    ul.appendChild(li);
  });
}

function refreshNewPane() {
  const list = newFirms();
  els["neu-count"].textContent = String(list.length);
  const filter = els["call-filter"].value.trim();
  els["call-new-info"].textContent = list.length
    ? list.length + (list.length === 1 ? " Firma" : " Firmen") + " in deinem Adresspool" + (filter ? " für „" + filter + "“" : "") + " noch nicht angerufen."
    : myPool().length
      ? "Keine noch nicht angerufenen Firmen" + (filter ? " für „" + filter + "“" : "") + "."
      : "Dein Adresspool ist noch leer. Der Admin kann dir Firmen zuweisen oder für dich importieren.";
  els["call-start-btn"].disabled = !list.length;
}

function startQueue() {
  call.queue = newFirms().map((c) => c.id);
  call.queueIndex = 0;
  if (!call.queue.length) return;
  openCard(findFirm(call.queue[0]), "neu");
}

function findFirm(id) {
  return ctx.state.customers.find((c) => c.id === id) || call.callbacks.find((c) => c.id === id) || null;
}

// ---------- Anruf-Bildschirm ----------

// Von aussen (Firmen-Seite): eine bestimmte Firma anrufen.
export function callFirm(firm) {
  ctx.state.pendingCallFirm = firm;
  ctx.navigate("anrufen");
}

function openCard(firm, source) {
  if (!firm) return;
  // aktuellsten Stand aus der Live-Liste nehmen
  firm = ctx.state.customers.find((c) => c.id === firm.id) || firm;
  call.current = firm;
  call.source = source;
  document.querySelector(".call-tabs").classList.add("hidden");
  els["call-wv-pane"].classList.add("hidden");
  els["call-new-pane"].classList.add("hidden");
  const card = els["call-card"];
  card.classList.remove("hidden");
  card.innerHTML = "";
  window.scrollTo(0, 0);

  const head = document.createElement("div");
  head.className = "call-card-head";
  const pos =
    source === "neu"
      ? "Firma " + (call.queueIndex + 1) + " von " + call.queue.length
      : source === "wv"
        ? "Wiedervorlage"
        : "Anruf";
  head.innerHTML =
    '<span class="kennung">' + esc(pos) + "</span>" +
    "<h3>" + esc(firm.unternehmen) + "</h3>" +
    '<p class="call-address">' + esc([firm.strasse, [firm.plz, firm.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ")) + "</p>";
  const people = [firm.vertreter1, firm.vertreter2, firm.vertreter3].filter(Boolean);
  if (!people.length && firm.inhaber) people.push(firm.inhaber);
  (firm.contacts || []).forEach((p) => people.push(p.name + (p.rolle ? " (" + p.rolle + ")" : "")));
  if (people.length) {
    const p = document.createElement("p");
    p.className = "call-people";
    p.innerHTML = "<strong>Ansprechpartner:</strong> " + people.map(esc).join(" | ");
    head.appendChild(p);
  }
  card.appendChild(head);

  // Hinweise: schon angerufen / Mitglied / Termin / nicht anrufen
  const warn = buildWarnings(firm);
  if (warn) card.appendChild(warn);

  const tel = telHref(firm.telefon);
  if (tel) {
    const a = document.createElement("a");
    a.className = "call-phone";
    a.href = tel;
    a.innerHTML = '<span class="call-phone-label">Anrufen</span><span class="call-phone-number">' + esc(firm.telefon) + "</span>";
    a.addEventListener("click", () => {
      card.classList.add("dialed");
      // Nach dem Auflegen direkt zu den Ergebnis-Knoepfen
      setTimeout(() => {
        const r = card.querySelector(".call-results");
        if (r) r.scrollIntoView({ block: "center" });
      }, 400);
    });
    card.appendChild(a);
  } else {
    const p = document.createElement("p");
    p.className = "call-warning";
    p.textContent = "Keine Telefonnummer hinterlegt. Bitte über „Firma öffnen“ ergänzen.";
    card.appendChild(p);
  }

  const spoke = document.createElement("label");
  spoke.className = "call-field";
  spoke.innerHTML = '<span>Gesprochen mit (Name)</span><input type="text" id="call-spoke" autocomplete="off">';
  card.appendChild(spoke);

  const area = document.createElement("div");
  area.id = "call-action-area";
  card.appendChild(area);
  renderResultButtons(area);

  const foot = document.createElement("div");
  foot.className = "call-foot";
  const link = document.createElement("a");
  link.href = "?customer=" + encodeURIComponent(firm.id);
  link.className = "open-customer-link";
  link.dataset.customerId = firm.id;
  link.textContent = "Firma öffnen";
  foot.appendChild(link);
  if (source === "neu") {
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "link-btn";
    skip.textContent = "Überspringen";
    skip.addEventListener("click", () => nextInQueue());
    foot.appendChild(skip);
  }
  const back = document.createElement("button");
  back.type = "button";
  back.className = "link-btn";
  back.textContent = "Zur Liste";
  back.addEventListener("click", showLists);
  foot.appendChild(back);
  card.appendChild(foot);

  const msg = document.createElement("p");
  msg.id = "call-msg";
  msg.className = "call-msg";
  card.appendChild(msg);
}

function buildWarnings(firm) {
  const items = [];
  const uid = ctx.state.user.uid;
  if (firm.doNotCall) items.push(["stop", "Nicht mehr anrufen – die Firma möchte keine Anrufe."]);
  const others = sharedWith(firm);
  if (others.length) items.push(["info", "Liegt auch bei " + others.join(", ") + " – deine Eintragungen sieht auch " + (others.length === 1 ? "diese Person" : "jede dieser Personen") + "."]);
  if (firm.membershipSigned) items.push(["info", "Ist bereits BdSt-Mitglied."]);
  if (firm.nextAppointment && firm.nextAppointment.date) {
    const n = firm.nextAppointment;
    items.push(["info", "Termin offen am " + deDate(n.date) + (n.time ? " um " + n.time + " Uhr" : "") + " bei " + (n.forName || "?") + "."]);
  }
  if (firm.lastCall) {
    const l = firm.lastCall;
    const who = l.byUid === uid ? "dir" : l.byName || "?";
    items.push(["call", "Schon angerufen von " + who + " am " + deDateTime(l.at) + " – " + (RESULT_LABELS[l.result] || l.result) + (l.spokeWith ? ", gesprochen mit " + l.spokeWith : "") + (firm.callCount > 1 ? " (" + firm.callCount + " Anrufe)" : "") + "."]);
  }
  if (firm.callback && firm.callback.date) {
    const c = firm.callback;
    items.push(["call", "Wiedervorlage " + deDate(c.date) + (c.time ? " " + c.time + " Uhr" : "") + (c.byName ? " (von " + c.byName + ")" : "") + (c.note ? ": " + c.note : "")]);
  }
  if (firm.lastVisitedAt) items.push(["info", "Zuletzt besucht am " + deDateTime(firm.lastVisitedAt).split(",")[0] + (firm.lastVisitNote ? ": " + firm.lastVisitNote : "")]);
  if (!items.length) return null;
  const box = document.createElement("div");
  box.className = "call-warnings";
  items.forEach(([kind, text]) => {
    const p = document.createElement("p");
    p.className = "call-warn call-warn-" + kind;
    p.textContent = text;
    box.appendChild(p);
  });
  return box;
}

// Namen der anderen Personen, bei denen die Firma liegt (Besitzer + Pool)
function sharedWith(firm) {
  const uid = ctx.state.user.uid;
  const ids = new Set([firm.ownerUid, ...(firm.poolUids || [])].filter((x) => x && x !== uid));
  const users = call.users || [];
  return Array.from(ids).map((id) => {
    const u = users.find((x) => x.uid === id);
    return u ? u.name || u.email : "einer Kollegin / einem Kollegen";
  });
}

function renderResultButtons(area) {
  area.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "call-results";
  [
    ["nicht_erreicht", "Nicht erreicht"],
    ["rueckruf", "Später nochmal"],
    ["kein_interesse", "Kein Interesse"],
    ["termin", "Termin vereinbart"],
  ].forEach(([key, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "result-btn result-" + key;
    b.textContent = label;
    b.addEventListener("click", () => onResult(key, area));
    grid.appendChild(b);
  });
  area.appendChild(grid);
  const more = document.createElement("div");
  more.className = "call-more";
  [
    ["falsche_nummer", "Falsche Nummer"],
    ["nicht_mehr_anrufen", "Nicht mehr anrufen"],
  ].forEach(([key, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "secondary small";
    b.textContent = label;
    b.addEventListener("click", () => onResult(key, area));
    more.appendChild(b);
  });
  area.appendChild(more);
}

function spokeWith() {
  const i = document.getElementById("call-spoke");
  return i ? i.value.trim() : "";
}

async function onResult(key, area) {
  if (key === "rueckruf") return renderCallbackForm(area);
  if (key === "termin") return renderAppointmentForm(area);
  if (key === "nicht_mehr_anrufen" && !confirm("Diese Firma als „Nicht mehr anrufen“ markieren?")) return;
  await saveCall({ result: key });
}

async function saveCall({ result, callback, appointmentId }, extraMsg) {
  const firm = call.current;
  setBusy(true);
  try {
    await logCall(firm, {
      result,
      spokeWith: spokeWith(),
      callback,
      appointmentId,
      byUid: ctx.state.user.uid,
      byName: ctx.state.user.name || ctx.state.user.email,
    });
    // Wiedervorlagen-Liste lokal aktualisieren
    call.callbacks = call.callbacks.filter((c) => c.id !== firm.id);
    if (callback) call.callbacks.push({ ...firm, callback: { ...callback, byUid: ctx.state.user.uid } });
    updateCounts();
    afterSave("Gespeichert: " + firm.unternehmen + " – " + (extraMsg || RESULT_LABELS[result]) + ".");
  } catch (err) {
    setBusy(false);
    showMsg("Fehler beim Speichern: " + err.message, true);
  }
}

function setBusy(busy) {
  els["call-card"].querySelectorAll("button, input, select").forEach((x) => (x.disabled = busy));
}

function showMsg(text, isError) {
  const m = document.getElementById("call-msg");
  if (m) {
    m.textContent = text;
    m.classList.toggle("error", Boolean(isError));
  }
}

function afterSave(message) {
  ctx.toast(message);
  if (call.source === "neu") {
    nextInQueue();
  } else {
    showLists();
  }
}

function nextInQueue() {
  call.queueIndex++;
  // Firmen, die inzwischen jemand anders angerufen hat, ueberspringen
  while (call.queueIndex < call.queue.length) {
    const f = findFirm(call.queue[call.queueIndex]);
    if (f && isFresh(f)) break;
    call.queueIndex++;
  }
  if (call.queueIndex >= call.queue.length) {
    ctx.toast("Liste fertig – alle Firmen dieser Auswahl sind bearbeitet.");
    call.tab = "neu";
    showLists();
    return;
  }
  openCard(findFirm(call.queue[call.queueIndex]), "neu");
}

function renderCallbackForm(area) {
  area.innerHTML = "";
  const form = document.createElement("div");
  form.className = "call-subform";
  form.innerHTML =
    "<h4>Später nochmal anrufen</h4>" +
    '<div class="quick-dates">' +
    '<button type="button" class="secondary" data-days="1">Morgen</button>' +
    '<button type="button" class="secondary" data-days="3">In 3 Tagen</button>' +
    '<button type="button" class="secondary" data-days="7">In 1 Woche</button>' +
    "</div>" +
    '<label class="call-field"><span>Datum</span><input type="date" id="cb-date" value="' + addDaysIso(1) + '" min="' + todayIso() + '"></label>' +
    '<label class="call-field"><span>Uhrzeit (optional)</span><input type="time" id="cb-time"></label>' +
    '<label class="call-field"><span>Notiz (optional)</span><input type="text" id="cb-note" placeholder="z. B. Chef ab 14 Uhr da"></label>' +
    '<div class="call-subform-actions"><button type="button" class="primary big-btn" id="cb-save">Wiedervorlage speichern</button>' +
    '<button type="button" class="link-btn" id="cb-cancel">Zurück</button></div>';
  area.appendChild(form);
  form.querySelectorAll("[data-days]").forEach((b) =>
    b.addEventListener("click", () => (form.querySelector("#cb-date").value = addDaysIso(Number(b.dataset.days))))
  );
  form.querySelector("#cb-cancel").addEventListener("click", () => renderResultButtons(area));
  form.querySelector("#cb-save").addEventListener("click", () => {
    const date = form.querySelector("#cb-date").value;
    if (!date) return showMsg("Bitte ein Datum wählen.", true);
    const callback = { date, time: form.querySelector("#cb-time").value, note: form.querySelector("#cb-note").value.trim() };
    saveCall({ result: "rueckruf", callback }, "Wiedervorlage am " + deDate(date) + (callback.time ? " um " + callback.time + " Uhr" : ""));
  });
}

async function loadUsers() {
  if (call.users) return call.users;
  try {
    call.users = await listUsers();
  } catch (err) {
    call.users = [];
  }
  return call.users;
}

async function renderAppointmentForm(area) {
  area.innerHTML = "";
  const users = await loadUsers();
  const form = document.createElement("div");
  form.className = "call-subform";
  form.innerHTML =
    "<h4>Termin vereinbaren</h4>" +
    '<p class="call-step">1. Worum geht es?</p><div class="choice-row" id="appt-type"></div>' +
    '<p class="call-step">2. Für wen?</p><div class="choice-row" id="appt-for"><p class="hint">Bitte zuerst oben wählen, worum es geht.</p></div>' +
    '<p class="call-step">3. Wann?</p>' +
    '<div class="call-field-row"><label class="call-field"><span>Datum</span><input type="date" id="appt-date" min="' + todayIso() + '"></label>' +
    '<label class="call-field"><span>Uhrzeit</span><input type="time" id="appt-time" step="900"></label></div>' +
    '<label class="call-field"><span>Ansprechpartner vor Ort</span><input type="text" id="appt-contact" value="' + esc(spokeWith()) + '"></label>' +
    '<div class="call-subform-actions"><button type="button" class="primary big-btn" id="appt-save">Termin speichern</button>' +
    '<button type="button" class="link-btn" id="appt-cancel">Zurück</button></div>';
  area.appendChild(form);

  const sel = { type: null, forUid: null, forName: null };
  const typeRow = form.querySelector("#appt-type");
  const forRow = form.querySelector("#appt-for");
  Object.entries(TYPE_LABELS).forEach(([key, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "choice-btn";
    b.textContent = label;
    b.addEventListener("click", () => {
      sel.type = key;
      sel.forUid = null;
      typeRow.querySelectorAll(".choice-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderForButtons();
    });
    typeRow.appendChild(b);
  });

  function renderForButtons() {
    forRow.innerHTML = "";
    const wanted = sel.type === "bdst" ? "werber" : "makler";
    let candidates = users.filter((u) => (u.functions || []).includes(wanted));
    if (!candidates.length) candidates = users.filter((u) => u.uid !== ctx.state.user.uid);
    candidates
      .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "de"))
      .forEach((u) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "choice-btn";
        b.textContent = u.name || u.email;
        b.addEventListener("click", () => {
          sel.forUid = u.uid;
          sel.forName = u.name || u.email;
          forRow.querySelectorAll(".choice-btn").forEach((x) => x.classList.toggle("active", x === b));
        });
        forRow.appendChild(b);
      });
    if (!candidates.length) forRow.innerHTML = '<p class="hint">Noch niemand mit dieser Funktion eingerichtet (Admin: „Benutzer“).</p>';
  }

  form.querySelector("#appt-cancel").addEventListener("click", () => renderResultButtons(area));
  form.querySelector("#appt-save").addEventListener("click", async () => {
    const date = form.querySelector("#appt-date").value;
    const time = form.querySelector("#appt-time").value;
    if (!sel.type) return showMsg("Bitte wählen: BdSt-Mitgliedschaft oder Steuerthema.", true);
    if (!sel.forUid) return showMsg("Bitte wählen, für wen der Termin ist.", true);
    if (!date || !time) return showMsg("Bitte Datum und Uhrzeit eintragen.", true);
    const firm = call.current;
    setBusy(true);
    try {
      const apptId = await createAppointment(firm, {
        type: sel.type,
        forUid: sel.forUid,
        forName: sel.forName,
        date,
        time,
        contactName: form.querySelector("#appt-contact").value.trim(),
        setByUid: ctx.state.user.uid,
        setByName: ctx.state.user.name || ctx.state.user.email,
        setByFunction: (ctx.state.functions || []).includes("presales") ? "presales" : (ctx.state.functions || [])[0] || "",
      });
      await saveCall({ result: "termin", appointmentId: apptId }, "Termin am " + deDate(date) + " um " + time + " Uhr für " + sel.forName);
    } catch (err) {
      setBusy(false);
      showMsg("Fehler beim Speichern: " + err.message, true);
    }
  });
}

// ---------- Verlauf auf der Firmen-Seite ----------

export async function buildFirmActivitySection(meta) {
  const box = document.createElement("div");
  box.className = "firm-activity";
  const h = document.createElement("h3");
  h.textContent = "Verlauf: wer hat was gemacht";
  box.appendChild(h);
  if (ctx.canCall()) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "primary";
    btn.textContent = "Anrufen / Ergebnis eintragen";
    btn.addEventListener("click", () => callFirm(meta));
    box.appendChild(btn);
  }
  const chainBox = document.createElement("ol");
  chainBox.className = "chain";
  box.appendChild(chainBox);
  const h2 = document.createElement("h4");
  h2.className = "activity-title";
  h2.textContent = "Alle Einträge";
  box.appendChild(h2);
  const list = document.createElement("ul");
  list.className = "activity-list";
  list.innerHTML = '<li class="hint">Lade …</li>';
  box.appendChild(list);
  try {
    const { calls, appointments } = await getFirmActivity(meta.id);
    renderChain(chainBox, meta, calls, appointments);
    const items = [];
    calls.forEach((c) =>
      items.push({
        t: toDate(c.at) || new Date(0),
        text: "Anruf von " + (c.byName || "?") + ": " + (RESULT_LABELS[c.result] || c.result) + (c.spokeWith ? ", gesprochen mit " + c.spokeWith : "") + (c.callbackDate ? " – Wiedervorlage " + deDate(c.callbackDate) : ""),
      })
    );
    appointments.forEach((a) =>
      items.push({
        t: toDate(a.createdAt) || toDate(a.at) || new Date(0),
        text: "Termin " + (TYPE_LABELS[a.type] || a.type) + " am " + deDate(a.date) + (a.time ? " " + a.time + " Uhr" : "") + " für " + (a.forName || "?") + " (vereinbart von " + (a.setByName || "?") + ") – " + (STATUS_LABELS[a.status] || a.status),
      })
    );
    items.sort((a, b) => b.t - a.t);
    list.innerHTML = "";
    if (!items.length) list.innerHTML = '<li class="hint">Noch keine Anrufe oder Termine.</li>';
    items.forEach((it) => {
      const li = document.createElement("li");
      li.innerHTML = '<span class="activity-date">' + esc(it.t.getTime() ? it.t.toLocaleDateString("de-DE") : "") + "</span> " + esc(it.text);
      list.appendChild(li);
    });
  } catch (err) {
    list.innerHTML = '<li class="hint">Verlauf konnte nicht geladen werden: ' + esc(err.message) + "</li>";
  }
  return box;
}

// Kurzinfo fuer die Firmenkarte (Suche, Tour, Firmen-Seite)
export function firmStatusHtml(meta) {
  const bits = [];
  // Kette: Terminierung (Pre-Sales) -> Aufnahme (Werber) -> Makler-Termin
  if (meta.terminiertVon && meta.terminiertVon.name) bits.push('<span class="status-chip chain">Terminiert: ' + esc(meta.terminiertVon.name) + "</span>");
  if (meta.membershipSigned) bits.push('<span class="status-chip chain">Mitglied' + (meta.memberWonBy ? " · Aufnahme: " + esc(meta.memberWonBy) : "") + "</span>");
  if (meta.maklerTerminVon && meta.maklerTerminVon.name) bits.push('<span class="status-chip chain">Makler-Termin: ' + esc(meta.maklerTerminVon.name) + (meta.maklerTerminVon.forName ? " → " + esc(meta.maklerTerminVon.forName) : "") + "</span>");
  if (meta.isMaklerKunde) bits.push('<span class="status-chip chain">Kunde' + (meta.sparten && meta.sparten.length ? " · " + esc(meta.sparten.join(", ")) : "") + "</span>");
  if (meta.doNotCall) bits.push('<span class="status-chip stop">Nicht mehr anrufen</span>');
  if (meta.nextAppointment && meta.nextAppointment.date) {
    const n = meta.nextAppointment;
    bits.push('<span class="status-chip">Termin ' + esc(deDate(n.date)) + (n.time ? " " + esc(n.time) : "") + " · " + esc(n.forName || "") + "</span>");
  }
  if (meta.callback && meta.callback.date) bits.push('<span class="status-chip">Wiedervorlage ' + esc(deDate(meta.callback.date)) + "</span>");
  if (meta.lastCall) bits.push('<span class="status-chip muted">Angerufen ' + esc(deDateTime(meta.lastCall.at).split(",")[0]) + " · " + esc(meta.lastCall.byName || "") + "</span>");
  return bits.length ? '<div class="status-chips">' + bits.join("") + "</div>" : "";
}

// ---------- Auswertung Telefonakquise ----------

function periodStart(period) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (period === "woche") {
    const day = (d.getDay() + 6) % 7; // Montag = 0
    d.setDate(d.getDate() - day);
  } else if (period === "monat") {
    d.setDate(1);
  } else if (period === "quartal") {
    d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
  } else {
    d.setMonth(0, 1);
  }
  return d;
}

const REACHED = ["rueckruf", "kein_interesse", "termin", "nicht_mehr_anrufen"];

function summarize(calls, allAppts) {
  // Von uns abgesagte Termine zaehlen nicht gegen Pre-Sales
  const appts = allAppts.filter((a) => a.cancelReason !== "uns");
  const reached = calls.filter((c) => REACHED.includes(c.result) || c.spokeWith).length;
  const done = appts.filter((a) => a.status === "durchgefuehrt").length;
  const cancelled = appts.filter((a) => a.status === "abgesagt" || a.status === "nicht_angetroffen").length;
  const open = appts.filter((a) => a.status === "geplant" || a.status === "verschoben").length;
  return {
    calls: calls.length,
    reached,
    set: appts.length,
    done,
    cancelled,
    open,
    quote: calls.length ? appts.length / calls.length : 0,
    doneQuote: appts.length ? done / appts.length : 0,
    kennzahl: done * KENNZAHL_PRESALES,
  };
}

function pct(x) {
  return (x * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " %";
}
function euro(n) {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

export async function renderPresalesStats() {
  const isOwner = ctx.state.role === "owner";
  const isPresales = (ctx.state.functions || []).includes("presales");
  els["presales-stats"].classList.toggle("hidden", !isOwner && !isPresales);
  if (!isOwner && !isPresales) return;
  const grid = els["presales-stat-grid"];
  grid.innerHTML = '<p class="hint">Lade Zahlen …</p>';
  try {
    const uid = isOwner ? null : ctx.state.user.uid;
    const [calls, appts] = await Promise.all([getCalls(uid), getAppointmentsSetBy(uid)]);
    const from = periodStart(call.period);
    const inPeriodCalls = calls.filter((c) => (toDate(c.at) || new Date()) >= from);
    // Termine nach Vereinbarungsdatum; nur von Pre-Sales vereinbarte zaehlen
    const inPeriodAppts = appts.filter((a) => (toDate(a.createdAt) || new Date()) >= from && (!isOwner || a.setByFunction === "presales"));
    const s = summarize(inPeriodCalls, inPeriodAppts);
    const tiles = [
      [s.calls, "Anrufe"],
      [s.reached, "Erreicht"],
      [s.set, "Termine vereinbart"],
      [s.done, "Davon durchgeführt"],
      [s.open, "Noch offen"],
      [s.cancelled, "Abgesagt / nicht angetroffen"],
      [pct(s.quote), "Quote Termin je Anruf"],
      [pct(s.doneQuote), "Quote durchgeführt"],
    ];
    grid.innerHTML = "";
    tiles.forEach(([v, l]) => {
      const d = document.createElement("div");
      d.className = "stat-tile static";
      d.innerHTML = '<div class="stat-value">' + esc(String(v)) + '</div><div class="stat-label">' + esc(l) + "</div>";
      grid.appendChild(d);
    });
    const k = document.createElement("div");
    k.className = "stat-tile static wide";
    k.innerHTML = '<div class="stat-value">' + esc(euro(s.kennzahl)) + '</div><div class="stat-label">Kennzahl (netto) · ' + KENNZAHL_PRESALES + " € je durchgeführtem Termin</div>";
    grid.appendChild(k);

    // Admin: je Person
    els["presales-table-wrap"].classList.toggle("hidden", !isOwner);
    if (isOwner) {
      const people = new Map();
      inPeriodCalls.forEach((c) => {
        if (!people.has(c.byUid)) people.set(c.byUid, { name: c.byName, calls: [], appts: [] });
        people.get(c.byUid).calls.push(c);
      });
      inPeriodAppts.forEach((a) => {
        if (!people.has(a.setByUid)) people.set(a.setByUid, { name: a.setByName, calls: [], appts: [] });
        people.get(a.setByUid).appts.push(a);
      });
      const body = els["presales-table-body"];
      body.innerHTML = "";
      if (!people.size) body.innerHTML = '<tr><td colspan="7" class="hint">Im gewählten Zeitraum noch keine Anrufe.</td></tr>';
      people.forEach((p) => {
        const x = summarize(p.calls, p.appts);
        const tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + esc(p.name || "?") + "</td><td>" + x.calls + "</td><td>" + x.reached + "</td><td>" + x.set + "</td><td>" + x.done +
          "</td><td>" + esc(pct(x.quote)) + "</td><td>" + esc(euro(x.kennzahl)) + "</td>";
        body.appendChild(tr);
      });
    }
  } catch (err) {
    grid.innerHTML = '<p class="hint">Zahlen konnten nicht geladen werden: ' + esc(err.message) + "</p>";
  }
}

// ---------- Adresspool zuweisen (Admin) ----------

export async function populateAssignSelects() {
  let users = [];
  try {
    users = await listUsers();
  } catch (err) {
    console.error(err);
  }
  users.sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "", "de"));
  const from = els["assign-from"];
  const to = els["assign-to"];
  const keepFrom = from.value;
  const keepTo = to.value;
  from.innerHTML = '<option value="">Alle Personen</option>';
  to.innerHTML = "";
  users.forEach((u) => {
    const label = (u.name || u.email) + ((u.functions || []).includes("presales") ? " (Pre-Sales)" : "");
    from.insertAdjacentHTML("beforeend", '<option value="' + esc(u.uid) + '">' + esc(label) + "</option>");
    to.insertAdjacentHTML("beforeend", '<option value="' + esc(u.uid) + '">' + esc(label) + "</option>");
  });
  if (keepFrom) from.value = keepFrom;
  const presales = users.find((u) => (u.functions || []).includes("presales"));
  to.value = keepTo || (presales ? presales.uid : to.value);
}

async function onAssignPreview() {
  els["assign-status"].textContent = "Prüfe …";
  els["assign-btn"].disabled = true;
  try {
    const all = await getAllCustomers();
    const fromUid = els["assign-from"].value;
    const toUid = els["assign-to"].value;
    const filter = els["assign-filter"].value;
    const onlyFresh = els["assign-only-fresh"].checked;
    call.assignCandidates = all.filter(
      (c) =>
        !inPoolOf(c, toUid) &&
        (!fromUid || inPoolOf(c, fromUid)) &&
        matchesArea(c, filter) &&
        !c.membershipSigned &&
        !c.doNotCall &&
        !c.nextAppointment &&
        (!onlyFresh || (!c.lastVisitedAt && !c.lastCall))
    );
    const n = call.assignCandidates.length;
    const toName = els["assign-to"].options[els["assign-to"].selectedIndex].textContent;
    els["assign-status"].textContent = n ? n + " Firmen würden zusätzlich in den Pool von " + toName + " kommen." : "Keine passenden Firmen gefunden.";
    els["assign-btn"].disabled = !n;
  } catch (err) {
    els["assign-status"].textContent = "Fehler: " + err.message;
  }
}

async function onAssignRun() {
  const n = call.assignCandidates.length;
  const toName = els["assign-to"].options[els["assign-to"].selectedIndex].textContent;
  if (!n || !confirm(n + " Firmen in den Pool von " + toName + " aufnehmen? Sie bleiben auch bei der bisherigen Person.")) return;
  els["assign-btn"].disabled = true;
  try {
    await assignFirms(call.assignCandidates.map((c) => c.id), els["assign-to"].value, (done, total) => {
      els["assign-status"].textContent = "Weise zu … " + done + "/" + total;
    });
    els["assign-status"].textContent = "Fertig: " + n + " Firmen im Pool von " + toName + ".";
    call.assignCandidates = [];
  } catch (err) {
    els["assign-status"].textContent = "Fehler: " + err.message;
  }
}


// Kette ①②③: Terminierung (Pre-Sales) -> Termin/Aufnahme (Werber) ->
// Termin nach Aufnahme (Makler). Jede Station zeigt, WER es gemacht hat.
function renderChain(ol, meta, calls, appts) {
  ol.innerHTML = "";
  const byDate = (a, b) => ((a.date || "") + (a.time || "")).localeCompare((b.date || "") + (b.time || ""));
  const bdst = appts.filter((a) => a.type === "bdst").sort(byDate);
  const makler = appts.filter((a) => a.type === "makler").sort(byDate);
  const presalesCalls = calls.slice().sort((a, b) => (toDate(a.at) || 0) - (toDate(b.at) || 0));
  const step = (num, title, lines, state) => {
    const li = document.createElement("li");
    li.className = "chain-step " + (state || "");
    li.innerHTML =
      '<span class="chain-num">' + num + "</span>" +
      '<div class="chain-body"><span class="kennung">' + esc(title) + "</span>" +
      lines.map((l) => "<p>" + l + "</p>").join("") + "</div>";
    ol.appendChild(li);
  };

  // ① Pre-Sales: Anrufe + Terminierung
  const termAppt = appts.filter((a) => a.setByFunction === "presales").sort(byDate)[0];
  const l1 = [];
  if (presalesCalls.length) {
    const callers = Array.from(new Set(presalesCalls.map((c) => c.byName).filter(Boolean)));
    l1.push(esc(presalesCalls.length + " Anruf" + (presalesCalls.length === 1 ? "" : "e")) + " von <strong>" + esc(callers.join(", ")) + "</strong>, zuletzt " + esc(deDateTime(presalesCalls[presalesCalls.length - 1].at).split(",")[0]));
  }
  if (termAppt) {
    l1.push("Terminiert von <strong>" + esc(termAppt.setByName || "?") + "</strong>: " + esc(TYPE_LABELS[termAppt.type] || termAppt.type) + " am " + esc(deDate(termAppt.date)) + (termAppt.time ? " " + esc(termAppt.time) + " Uhr" : "") + " für <strong>" + esc(termAppt.forName || "?") + "</strong>");
  } else if (meta.terminiertVon && meta.terminiertVon.name) {
    l1.push("Terminiert von <strong>" + esc(meta.terminiertVon.name) + "</strong>");
  }
  if (!l1.length) l1.push('<span class="hint">Noch nicht angerufen bzw. terminiert.</span>');
  step("1", "Pre-Sales · Terminierung", l1, termAppt || meta.terminiertVon ? "done" : presalesCalls.length ? "active" : "");

  // ② BdSt-Termin + Aufnahme
  const l2 = [];
  bdst.forEach((a) => {
    let res = STATUS_LABELS[a.status] || a.status;
    if (a.status === "durchgefuehrt") res += a.outcome && a.outcome.memberWon ? " – <strong>Mitglied aufgenommen von " + esc(a.forName || "?") + "</strong>" : " – kein Mitglied";
    l2.push("Termin " + esc(deDate(a.date)) + (a.time ? " " + esc(a.time) + " Uhr" : "") + " bei <strong>" + esc(a.forName || "?") + "</strong>: " + res);
  });
  if (!bdst.length && meta.membershipSigned) l2.push("Mitglied" + (meta.memberWonBy ? " – Aufnahme durch <strong>" + esc(meta.memberWonBy) + "</strong>" : " (aus Besuch)"));
  if (!l2.length) l2.push('<span class="hint">Noch kein BdSt-Termin.</span>');
  step("2", "BdSt-Werber · Termin und Aufnahme", l2, meta.membershipSigned ? "done" : bdst.length ? "active" : "");

  // ③ Termin nach Aufnahme (Makler)
  const l3 = [];
  makler.forEach((a) => {
    let res = STATUS_LABELS[a.status] || a.status;
    if (a.status === "durchgefuehrt") res += a.outcome && a.outcome.deal ? " – <strong>Abschluss " + esc(a.outcome.sparte || "") + "</strong>" : " – kein Abschluss";
    l3.push("Vereinbart von <strong>" + esc(a.setByName || "?") + "</strong> für <strong>" + esc(a.forName || "?") + "</strong>, " + esc(deDate(a.date)) + (a.time ? " " + esc(a.time) + " Uhr" : "") + ": " + res);
  });
  if (!l3.length) l3.push('<span class="hint">Noch kein Makler-Termin.</span>');
  step("3", "Makler · Termin nach Aufnahme", l3, meta.isMaklerKunde ? "done" : makler.length ? "active" : "");
}
