// "Meine Termine" (BdSt-Werber / Makler): Termine wahrnehmen, als
// durchgefuehrt / verschoben / abgesagt eintragen, Ergebnis erfassen
// (Mitglied gewonnen bzw. Abschluss + Sparte), Folgetermin Werber ->
// Makler vereinbaren. Dazu die Auswertung "Termine & Ergebnisse".
import { getAppointmentsFor, updateAppointment, createAppointment, fsIncrement, fsArrayUnion, FsTimestamp } from "./data-store.js?v=20261110a";
import { periodStart, toDate, deDate, esc, todayIso, addDaysIso, TYPE_LABELS, STATUS_LABELS, telHref, loadUsers } from "./calls-ui.js?v=20261110a";

// Kennzahlen Werber (nur Uebersicht, keine Abrechnung) - wie bisher in
// der App und im BdSt-Vertriebscockpit hinterlegt.
export const KENNZAHL_MITGLIED = 150;
export const KENNZAHL_MITGLIED_UND_TERMIN = 200;
export const KENNZAHL_NUR_TERMIN = 112.5;
export const SPARTEN = ["bAV", "PKV", "Immobilie", "Geldanlage", "Sonstiges"];
const OPEN = ["geplant", "verschoben"];

let ctx = null;
const els = {};
const ap = { list: [], current: null, period: "monat", showAll: false };

export function initAppointments(context) {
  ctx = context;
  ["appt-view", "appt-lists", "appt-card", "appt-all", "appt-all-label", "appt-stats", "appt-stat-grid", "appt-table-wrap", "appt-table-body", "tile-termine-count"].forEach(
    (id) => (els[id] = document.getElementById(id))
  );
  els["appt-all"].addEventListener("change", () => {
    ap.showAll = els["appt-all"].checked;
    reload();
  });
  document.querySelectorAll(".appt-period").forEach((b) =>
    b.addEventListener("click", () => {
      ap.period = b.dataset.period;
      document.querySelectorAll(".appt-period").forEach((x) => x.classList.toggle("active", x === b));
      renderApptStats();
    })
  );
}

function me() {
  return ctx.state.user;
}

function apptDateTime(a) {
  return (a.date || "") + " " + (a.time || "");
}

async function reload() {
  els["appt-lists"].innerHTML = '<p class="hint">Lade Termine …</p>';
  try {
    ap.list = await getAppointmentsFor(ap.showAll ? null : me().uid);
  } catch (err) {
    els["appt-lists"].innerHTML = '<p class="hint">Termine konnten nicht geladen werden: ' + esc(err.message) + "</p>";
    return;
  }
  updateTileCount();
  renderLists();
}

// Kachel auf der Startseite: "2 heute · 1 Ergebnis fehlt"
export async function refreshTileCount() {
  if (!ctx || !ctx.state.user) return;
  try {
    ap.list = await getAppointmentsFor(me().uid);
    updateTileCount();
  } catch (err) {
    console.error(err);
  }
}

function updateTileCount() {
  const today = todayIso();
  const mine = ap.list.filter((a) => a.forUid === me().uid && OPEN.includes(a.status));
  const nToday = mine.filter((a) => a.date === today).length;
  const nMissing = mine.filter((a) => a.date < today).length;
  const parts = [];
  if (nToday) parts.push(nToday + " heute");
  if (nMissing) parts.push(nMissing + " Ergebnis fehlt");
  const el = els["tile-termine-count"];
  el.textContent = parts.join(" · ");
  el.classList.toggle("hidden", !parts.length);
}

export function onEnterApptView() {
  els["appt-all-label"].classList.toggle("hidden", ctx.state.role !== "owner");
  closeCard();
  reload();
}

function closeCard() {
  ap.current = null;
  els["appt-card"].classList.add("hidden");
  els["appt-card"].innerHTML = "";
  els["appt-lists"].classList.remove("hidden");
  document.querySelector(".appt-toolbar").classList.remove("hidden");
}

function renderLists() {
  const box = els["appt-lists"];
  box.innerHTML = "";
  const today = todayIso();
  const open = ap.list.filter((a) => OPEN.includes(a.status)).sort((a, b) => apptDateTime(a).localeCompare(apptDateTime(b)));
  const missing = open.filter((a) => a.date < today);
  const todays = open.filter((a) => a.date === today);
  const later = open.filter((a) => a.date > today);
  const done = ap.list
    .filter((a) => !OPEN.includes(a.status))
    .sort((a, b) => apptDateTime(b).localeCompare(apptDateTime(a)))
    .slice(0, 30);

  const group = (title, items, cls, hint) => {
    const sec = document.createElement("section");
    sec.className = "appt-group " + (cls || "");
    const h = document.createElement("h3");
    h.innerHTML = esc(title) + ' <span class="call-tab-count">' + items.length + "</span>";
    sec.appendChild(h);
    if (hint) {
      const p = document.createElement("p");
      p.className = "hint";
      p.textContent = hint;
      sec.appendChild(p);
    }
    const ul = document.createElement("ul");
    ul.className = "callback-list";
    if (!items.length) ul.innerHTML = '<li class="empty-hint">Keine.</li>';
    items.forEach((a) => ul.appendChild(apptItem(a, cls)));
    sec.appendChild(ul);
    box.appendChild(sec);
  };
  if (missing.length) group("Bitte Ergebnis eintragen", missing, "overdue", "Diese Termine liegen in der Vergangenheit. Bitte eintragen, ob sie stattgefunden haben.");
  group("Heute", todays, "today");
  group("Demnächst", later, "later");
  if (done.length) {
    const d = document.createElement("details");
    d.className = "appt-done";
    d.innerHTML = "<summary>Erledigt (" + done.length + ")</summary>";
    const ul = document.createElement("ul");
    ul.className = "callback-list";
    done.forEach((a) => ul.appendChild(apptItem(a, "done")));
    d.appendChild(ul);
    box.appendChild(d);
  }
}

function apptItem(a, cls) {
  const li = document.createElement("li");
  li.className = "callback-item " + (cls || "");
  const when = (a.date === todayIso() ? "Heute" : deDate(a.date)) + (a.time ? ", " + a.time + " Uhr" : "");
  const who = ap.showAll ? " · für " + (a.forName || "?") : "";
  const status = OPEN.includes(a.status) ? (a.status === "verschoben" ? " · verschoben" : "") : " · " + (STATUS_LABELS[a.status] || a.status) + outcomeText(a);
  li.innerHTML =
    '<button type="button" class="callback-main">' +
    '<span class="callback-when">' + esc(when) + esc(status) + "</span>" +
    '<span class="callback-firm">' + esc(a.firmName) + "</span>" +
    '<span class="callback-place">' + esc([a.plz, a.ort].filter(Boolean).join(" ")) + " · " + esc(TYPE_LABELS[a.type] || a.type) + esc(who) + "</span>" +
    '<span class="callback-note">vereinbart von ' + esc(a.setByName || "?") + (a.contactName ? " · Ansprechpartner: " + esc(a.contactName) : "") + "</span>" +
    "</button>" +
    '<a href="?customer=' + encodeURIComponent(a.customerId) + '" class="open-customer-link callback-open" data-customer-id="' + esc(a.customerId) + '">Firma öffnen</a>';
  li.querySelector(".callback-main").addEventListener("click", () => openCard(a));
  return li;
}

function outcomeText(a) {
  const o = a.outcome || {};
  if (a.status !== "durchgefuehrt") return a.cancelReason === "uns" ? " (von uns)" : "";
  if (a.type === "bdst") return o.memberWon ? " · Mitglied gewonnen" : " · kein Mitglied";
  return o.deal ? " · Abschluss " + (o.sparte || "") : " · kein Abschluss";
}

// ---------- Termin-Bildschirm ----------

function canEdit(a) {
  return ctx.state.role === "owner" || a.forUid === me().uid;
}

function openCard(a) {
  ap.current = a;
  els["appt-lists"].classList.add("hidden");
  document.querySelector(".appt-toolbar").classList.add("hidden");
  const card = els["appt-card"];
  card.classList.remove("hidden");
  card.innerHTML = "";
  window.scrollTo(0, 0);

  const head = document.createElement("div");
  head.className = "call-card-head";
  head.innerHTML =
    '<span class="kennung">' + esc(TYPE_LABELS[a.type] || a.type) + " · " + esc(STATUS_LABELS[a.status] || a.status) + "</span>" +
    "<h3>" + esc(a.firmName) + "</h3>" +
    '<p class="call-address">' + esc([a.strasse, [a.plz, a.ort].filter(Boolean).join(" ")].filter(Boolean).join(", ")) + "</p>" +
    '<p class="appt-when">' + esc(deDate(a.date)) + (a.time ? ", " + esc(a.time) + " Uhr" : "") + "</p>" +
    '<p class="call-people">' +
    (a.contactName ? "<strong>Ansprechpartner:</strong> " + esc(a.contactName) + "<br>" : "") +
    "<strong>Vereinbart von:</strong> " + esc(a.setByName || "?") +
    (ctx.state.role === "owner" ? " · <strong>für:</strong> " + esc(a.forName || "?") : "") +
    "</p>";
  card.appendChild(head);

  const links = document.createElement("div");
  links.className = "appt-links";
  const tel = telHref(a.telefon);
  if (tel) links.insertAdjacentHTML("beforeend", '<a class="secondary-link" href="' + esc(tel) + '">Anrufen: ' + esc(a.telefon) + "</a>");
  const addr = [a.strasse, a.plz, a.ort].filter(Boolean).join(" ");
  if (addr) links.insertAdjacentHTML("beforeend", '<a class="secondary-link" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr) + '">Route in Google Maps</a>');
  links.insertAdjacentHTML("beforeend", '<a href="?customer=' + encodeURIComponent(a.customerId) + '" class="open-customer-link secondary-link" data-customer-id="' + esc(a.customerId) + '">Firma öffnen</a>');
  card.appendChild(links);

  const area = document.createElement("div");
  area.id = "appt-action-area";
  card.appendChild(area);
  if (OPEN.includes(a.status) && canEdit(a)) renderMainButtons(area);
  else if (!OPEN.includes(a.status)) area.innerHTML = '<p class="call-info">Erledigt: ' + esc(STATUS_LABELS[a.status] || a.status) + esc(outcomeText(a)) + "</p>";
  else area.innerHTML = '<p class="hint">Das Ergebnis trägt ' + esc(a.forName || "die Person") + " ein, die den Termin wahrnimmt.</p>";

  const foot = document.createElement("div");
  foot.className = "call-foot";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "link-btn";
  back.textContent = "Zur Terminliste";
  back.addEventListener("click", () => {
    closeCard();
    renderLists();
  });
  foot.appendChild(back);
  card.appendChild(foot);
  const msg = document.createElement("p");
  msg.id = "appt-msg";
  msg.className = "call-msg";
  card.appendChild(msg);
}

function showMsg(text, isError) {
  const m = document.getElementById("appt-msg");
  if (m) {
    m.textContent = text;
    m.classList.toggle("error", Boolean(isError));
  }
}

function setBusy(b) {
  els["appt-card"].querySelectorAll("button, input").forEach((x) => (x.disabled = b));
}

function renderMainButtons(area) {
  area.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "call-results";
  [
    ["done", "Durchgeführt", "result-termin"],
    ["moved", "Verschoben", ""],
    ["cancel", "Abgesagt / nicht angetroffen", ""],
  ].forEach(([key, label, cls]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "result-btn " + cls;
    b.textContent = label;
    b.addEventListener("click", () => (key === "done" ? renderDoneForm(area) : key === "moved" ? renderMoveForm(area) : renderCancelForm(area)));
    grid.appendChild(b);
  });
  area.appendChild(grid);
}

function yesNo(container, onPick) {
  const row = document.createElement("div");
  row.className = "choice-row yesno-row";
  [["ja", "Ja"], ["nein", "Nein"]].forEach(([v, l]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "choice-btn";
    b.textContent = l;
    b.addEventListener("click", () => {
      row.querySelectorAll(".choice-btn").forEach((x) => x.classList.toggle("active", x === b));
      onPick(v === "ja");
    });
    row.appendChild(b);
  });
  container.appendChild(row);
  return row;
}

function step(container, text) {
  const p = document.createElement("p");
  p.className = "call-step";
  p.textContent = text;
  container.appendChild(p);
  return p;
}

function backLink(form, area) {
  const actions = document.createElement("div");
  actions.className = "call-subform-actions";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "primary big-btn";
  save.textContent = "Speichern";
  const back = document.createElement("button");
  back.type = "button";
  back.className = "link-btn";
  back.textContent = "Zurück";
  back.addEventListener("click", () => renderMainButtons(area));
  actions.appendChild(save);
  actions.appendChild(back);
  form.appendChild(actions);
  return save;
}

function subform(area, title) {
  area.innerHTML = "";
  const form = document.createElement("div");
  form.className = "call-subform";
  form.innerHTML = "<h4>" + esc(title) + "</h4>";
  area.appendChild(form);
  return form;
}

// Durchgefuehrt: Werber -> Mitglied? + Makler-Termin?; Makler -> Abschluss? + Sparte
async function renderDoneForm(area) {
  const a = ap.current;
  const form = subform(area, "Termin durchgeführt");
  const sel = { member: null, followUp: null, deal: null, sparte: null, fuForUid: null, fuForName: null };

  if (a.type === "bdst") {
    step(form, "1. Mitglied gewonnen?");
    yesNo(form, (v) => (sel.member = v));
    step(form, "2. Termin für einen Makler (Steuerthema) vereinbart?");
    const fuBox = document.createElement("div");
    fuBox.className = "followup hidden";
    yesNo(form, (v) => {
      sel.followUp = v;
      fuBox.classList.toggle("hidden", !v);
    });
    form.appendChild(fuBox);
    const users = await loadUsers();
    let makler = users.filter((u) => (u.functions || []).includes("makler"));
    if (!makler.length) makler = users;
    const p = document.createElement("p");
    p.className = "call-step";
    p.textContent = "Für welchen Makler?";
    fuBox.appendChild(p);
    const row = document.createElement("div");
    row.className = "choice-row";
    makler.forEach((u) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "choice-btn";
      b.textContent = u.name || u.email;
      b.addEventListener("click", () => {
        sel.fuForUid = u.uid;
        sel.fuForName = u.name || u.email;
        row.querySelectorAll(".choice-btn").forEach((x) => x.classList.toggle("active", x === b));
      });
      row.appendChild(b);
    });
    fuBox.appendChild(row);
    fuBox.insertAdjacentHTML(
      "beforeend",
      '<div class="call-field-row"><label class="call-field"><span>Datum</span><input type="date" id="fu-date" min="' + todayIso() + '"></label>' +
        '<label class="call-field"><span>Uhrzeit</span><input type="time" id="fu-time" step="900"></label></div>'
    );
  } else {
    step(form, "1. Abschluss?");
    const spBox = document.createElement("div");
    spBox.className = "hidden";
    yesNo(form, (v) => {
      sel.deal = v;
      spBox.classList.toggle("hidden", !v);
    });
    form.appendChild(spBox);
    step(spBox, "2. Welche Sparte?");
    const row = document.createElement("div");
    row.className = "choice-row";
    SPARTEN.forEach((sp) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "choice-btn";
      b.textContent = sp;
      b.addEventListener("click", () => {
        sel.sparte = sp;
        row.querySelectorAll(".choice-btn").forEach((x) => x.classList.toggle("active", x === b));
      });
      row.appendChild(b);
    });
    spBox.appendChild(row);
  }
  form.insertAdjacentHTML("beforeend", '<label class="call-field"><span>Notiz (optional)</span><input type="text" id="done-note"></label>');

  const save = backLink(form, area);
  save.addEventListener("click", async () => {
    const note = form.querySelector("#done-note").value.trim();
    const user = me();
    if (a.type === "bdst") {
      if (sel.member === null) return showMsg("Bitte wählen: Mitglied gewonnen ja oder nein.", true);
      if (sel.followUp === null) return showMsg("Bitte wählen: Makler-Termin vereinbart ja oder nein.", true);
      if (sel.followUp) {
        const d = form.querySelector("#fu-date").value;
        const t = form.querySelector("#fu-time").value;
        if (!sel.fuForUid || !d || !t) return showMsg("Bitte Makler, Datum und Uhrzeit für den Folgetermin angeben.", true);
        sel.fuDate = d;
        sel.fuTime = t;
      }
    } else {
      if (sel.deal === null) return showMsg("Bitte wählen: Abschluss ja oder nein.", true);
      if (sel.deal && !sel.sparte) return showMsg("Bitte die Sparte wählen.", true);
    }
    setBusy(true);
    try {
      const outcome = {};
      const firmUpdate = { zustaendigUid: a.forUid, zustaendigName: a.forName || "" };
      if (a.type === "bdst") {
        const kennzahl = sel.member && sel.followUp ? KENNZAHL_MITGLIED_UND_TERMIN : sel.member ? KENNZAHL_MITGLIED : sel.followUp ? KENNZAHL_NUR_TERMIN : 0;
        Object.assign(outcome, { memberWon: sel.member, maklerTermin: sel.followUp, kennzahl });
        if (sel.member) {
          Object.assign(firmUpdate, { membershipSigned: true, isBdStMember: true, memberSince: a.date, memberWonBy: a.forName || "", stage: "mitglied" });
        }
        if (sel.followUp) firmUpdate.consultationRequested = true;
        if (kennzahl) firmUpdate.totalProvision = fsIncrement(kennzahl);
      } else {
        Object.assign(outcome, { deal: sel.deal, sparte: sel.deal ? sel.sparte : null });
        if (sel.deal) Object.assign(firmUpdate, { isMaklerKunde: true, sparten: fsArrayUnion(sel.sparte), stage: "kunde" });
      }
      if (note) outcome.note = note;
      await updateAppointment(
        a,
        { status: "durchgefuehrt", outcome, doneAt: new Date().toISOString(), doneByUid: user.uid },
        { byUid: user.uid, byName: user.name || user.email, action: "durchgefuehrt" },
        firmUpdate,
        { clearNext: true }
      );
      let msg = "Gespeichert: " + a.firmName + " – durchgeführt" + outcomeText({ ...a, status: "durchgefuehrt", outcome }) + ".";
      if (a.type === "bdst" && sel.followUp) {
        await createAppointment(
          { id: a.customerId, unternehmen: a.firmName, strasse: a.strasse, plz: a.plz, ort: a.ort, telefon: a.telefon },
          {
            type: "makler",
            forUid: sel.fuForUid,
            forName: sel.fuForName,
            date: sel.fuDate,
            time: sel.fuTime,
            contactName: a.contactName,
            setByUid: user.uid,
            setByName: user.name || user.email,
            setByFunction: "werber",
          }
        );
        msg += " Makler-Termin am " + deDate(sel.fuDate) + " für " + sel.fuForName + " eingetragen.";
      }
      ctx.toast(msg);
      closeCard();
      reload();
    } catch (err) {
      setBusy(false);
      showMsg("Fehler beim Speichern: " + err.message, true);
    }
  });
}

function renderMoveForm(area) {
  const a = ap.current;
  const form = subform(area, "Termin verschieben");
  form.insertAdjacentHTML(
    "beforeend",
    '<div class="call-field-row"><label class="call-field"><span>Neues Datum</span><input type="date" id="mv-date" min="' + todayIso() + '"></label>' +
      '<label class="call-field"><span>Neue Uhrzeit</span><input type="time" id="mv-time" step="900" value="' + esc(a.time || "") + '"></label></div>' +
      '<label class="call-field"><span>Grund (optional)</span><input type="text" id="mv-note"></label>'
  );
  const save = backLink(form, area);
  save.addEventListener("click", async () => {
    const date = form.querySelector("#mv-date").value;
    const time = form.querySelector("#mv-time").value;
    if (!date || !time) return showMsg("Bitte neues Datum und neue Uhrzeit eintragen.", true);
    const user = me();
    setBusy(true);
    try {
      const when = new Date(date + "T" + time + ":00");
      await updateAppointment(
        a,
        { status: "verschoben", date, time, at: FsTimestamp.fromDate(when) },
        { byUid: user.uid, byName: user.name || user.email, action: "verschoben", from: a.date + " " + (a.time || ""), to: date + " " + time, note: form.querySelector("#mv-note").value.trim() },
        null,
        { setNext: { id: a.id, at: FsTimestamp.fromDate(when), date, time, forUid: a.forUid, forName: a.forName, type: a.type, setByName: a.setByName } }
      );
      ctx.toast("Verschoben: " + a.firmName + " auf " + deDate(date) + " um " + time + " Uhr.");
      closeCard();
      reload();
    } catch (err) {
      setBusy(false);
      showMsg("Fehler beim Speichern: " + err.message, true);
    }
  });
}

function renderCancelForm(area) {
  const a = ap.current;
  const form = subform(area, "Termin abgesagt");
  step(form, "Was ist passiert?");
  const sel = { reason: null };
  const row = document.createElement("div");
  row.className = "choice-row";
  [
    ["firma", "Firma hat abgesagt"],
    ["nicht_angetroffen", "Nicht angetroffen"],
    ["uns", "Wir haben abgesagt"],
  ].forEach(([key, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "choice-btn";
    b.textContent = label;
    b.addEventListener("click", () => {
      sel.reason = key;
      row.querySelectorAll(".choice-btn").forEach((x) => x.classList.toggle("active", x === b));
    });
    row.appendChild(b);
  });
  form.appendChild(row);
  form.insertAdjacentHTML(
    "beforeend",
    '<p class="hint">Die Firma kommt mit einer Wiedervorlage in einer Woche zurück zu ' + esc(a.setByName || "der Person, die den Termin vereinbart hat") + ", um neu zu vereinbaren.</p>" +
      '<label class="call-field"><span>Notiz (optional)</span><input type="text" id="cc-note"></label>'
  );
  const save = backLink(form, area);
  save.addEventListener("click", async () => {
    if (!sel.reason) return showMsg("Bitte wählen, was passiert ist.", true);
    const user = me();
    const note = form.querySelector("#cc-note").value.trim();
    setBusy(true);
    try {
      const status = sel.reason === "nicht_angetroffen" ? "nicht_angetroffen" : "abgesagt";
      const firmUpdate = {
        callback: {
          date: addDaysIso(7),
          time: "",
          note: "Termin " + deDate(a.date) + " " + (sel.reason === "nicht_angetroffen" ? "– nicht angetroffen" : "abgesagt") + (note ? ": " + note : "") + " – bitte neu vereinbaren",
          byUid: a.setByUid,
          byName: a.setByName || "",
        },
        stage: "presales",
      };
      await updateAppointment(
        a,
        { status, cancelReason: sel.reason, outcome: note ? { note } : {} },
        { byUid: user.uid, byName: user.name || user.email, action: status, reason: sel.reason, note },
        firmUpdate,
        { clearNext: true }
      );
      ctx.toast("Gespeichert: " + a.firmName + " – " + (STATUS_LABELS[status] || status) + ". Wiedervorlage für " + (a.setByName || "?") + " in einer Woche.");
      closeCard();
      reload();
    } catch (err) {
      setBusy(false);
      showMsg("Fehler beim Speichern: " + err.message, true);
    }
  });
}

// ---------- Auswertung Termine & Ergebnisse ----------

function sumAppts(list) {
  const done = list.filter((a) => a.status === "durchgefuehrt");
  const bdst = done.filter((a) => a.type === "bdst");
  const makler = done.filter((a) => a.type === "makler");
  const members = bdst.filter((a) => a.outcome && a.outcome.memberWon).length;
  const fu = bdst.filter((a) => a.outcome && a.outcome.maklerTermin).length;
  const deals = makler.filter((a) => a.outcome && a.outcome.deal).length;
  const bySparte = {};
  makler.forEach((a) => {
    if (a.outcome && a.outcome.deal && a.outcome.sparte) bySparte[a.outcome.sparte] = (bySparte[a.outcome.sparte] || 0) + 1;
  });
  const kennzahl = bdst.reduce((s, a) => s + ((a.outcome && a.outcome.kennzahl) || 0), 0);
  return {
    done: done.length,
    bdst: bdst.length,
    makler: makler.length,
    members,
    fu,
    deals,
    bySparte,
    kennzahl,
    cancelled: list.filter((a) => a.status === "abgesagt" || a.status === "nicht_angetroffen").length,
    memberQuote: bdst.length ? members / bdst.length : 0,
    dealQuote: makler.length ? deals / makler.length : 0,
  };
}

const pct = (x) => (x * 100).toLocaleString("de-DE", { maximumFractionDigits: 1 }) + " %";
const euro = (n) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

export async function renderApptStats() {
  const f = ctx.state.functions || [];
  const isOwner = ctx.state.role === "owner";
  const relevant = isOwner || f.includes("werber") || f.includes("makler");
  els["appt-stats"].classList.toggle("hidden", !relevant);
  if (!relevant) return;
  const grid = els["appt-stat-grid"];
  grid.innerHTML = '<p class="hint">Lade Zahlen …</p>';
  try {
    const all = await getAppointmentsFor(isOwner ? null : me().uid);
    const from = periodStart(ap.period);
    // Zeitraum nach Termindatum
    const list = all.filter((a) => {
      const d = toDate(a.at) || (a.date ? new Date(a.date + "T12:00:00") : null);
      return d && d >= from && d <= new Date(Date.now() + 1000);
    });
    const s = sumAppts(list);
    const showBdst = isOwner || f.includes("werber");
    const showMakler = isOwner || f.includes("makler");
    const tiles = [[s.done, "Termine wahrgenommen"]];
    if (showBdst) tiles.push([s.members, "Mitglieder gewonnen"], [pct(s.memberQuote), "Quote Mitglied je BdSt-Termin"], [s.fu, "Makler-Termine vereinbart"]);
    if (showMakler) tiles.push([s.deals, "Abschlüsse"], [pct(s.dealQuote), "Quote Abschluss je Termin"]);
    tiles.push([s.cancelled, "Abgesagt / nicht angetroffen"]);
    grid.innerHTML = "";
    tiles.forEach(([v, l]) => {
      const d = document.createElement("div");
      d.className = "stat-tile static";
      d.innerHTML = '<div class="stat-value">' + esc(String(v)) + '</div><div class="stat-label">' + esc(l) + "</div>";
      grid.appendChild(d);
    });
    if (showMakler && Object.keys(s.bySparte).length) {
      const d = document.createElement("div");
      d.className = "stat-tile static wide";
      d.innerHTML =
        '<div class="stat-label">Abschlüsse je Sparte</div><div class="sparten-list">' +
        Object.entries(s.bySparte).map(([k, v]) => "<span><strong>" + esc(String(v)) + "</strong> " + esc(k) + "</span>").join("") +
        "</div>";
      grid.appendChild(d);
    }
    if (showBdst) {
      const k = document.createElement("div");
      k.className = "stat-tile static wide";
      k.innerHTML = '<div class="stat-value">' + esc(euro(s.kennzahl)) + '</div><div class="stat-label">Kennzahl Werber (netto) · 150 € Mitglied, 200 € Mitglied + Makler-Termin</div>';
      grid.appendChild(k);
    }

    els["appt-table-wrap"].classList.toggle("hidden", !isOwner);
    if (isOwner) {
      const people = new Map();
      list.forEach((a) => {
        if (!people.has(a.forUid)) people.set(a.forUid, { name: a.forName, list: [] });
        people.get(a.forUid).list.push(a);
      });
      const body = els["appt-table-body"];
      body.innerHTML = "";
      if (!people.size) body.innerHTML = '<tr><td colspan="7" class="hint">Im gewählten Zeitraum keine Termine.</td></tr>';
      people.forEach((p) => {
        const x = sumAppts(p.list);
        const quote = x.bdst ? pct(x.memberQuote) : x.makler ? pct(x.dealQuote) : "–";
        const tr = document.createElement("tr");
        tr.innerHTML =
          "<td>" + esc(p.name || "?") + "</td><td>" + x.done + "</td><td>" + x.members + "</td><td>" + x.fu + "</td><td>" + x.deals + "</td><td>" + esc(quote) + "</td><td>" + esc(euro(x.kennzahl)) + "</td>";
        body.appendChild(tr);
      });
    }
  } catch (err) {
    grid.innerHTML = '<p class="hint">Zahlen konnten nicht geladen werden: ' + esc(err.message) + "</p>";
  }
}
