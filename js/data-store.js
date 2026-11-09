// Alle Firestore-Zugriffe rund um Kunden/Adressen, Besuche und
// Finanzkennzahlen an einer Stelle gebuendelt.
import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  increment,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

import { db } from "./firebase-app.js?v=20261109f";
import { buildAddressMeta } from "./address-utils.js?v=20261109f";
import { normalizeFunctions } from "./roles.js?v=20261109f";
import { buildDedupKeys, fillEmptyFields } from "./dedup.js?v=20261109f";

const CUSTOMERS = "customers";
const FINANCIALS_DOC = "summary";
const DEFAULT_TAG = "Akquise";

// Jeder neu angelegte/importierte Kunde bekommt automatisch den Tag
// "Akquise" - zusaetzliche Tags (z.B. "LinkedIn") kommen dazu.
function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : [];
  const cleaned = list.map((t) => String(t).trim()).filter(Boolean);
  return Array.from(new Set([DEFAULT_TAG, ...cleaned]));
}

function customerCoreFields(fields) {
  const meta = buildAddressMeta(fields);
  return {
    unternehmen: fields.unternehmen || "",
    strasse: fields.strasse || "",
    plz: fields.plz || "",
    ort: fields.ort || "",
    inhaber: fields.inhaber || "",
    vertreter1: fields.vertreter1 || "",
    vertreter2: fields.vertreter2 || "",
    vertreter3: fields.vertreter3 || "",
    telefon: fields.telefon || "",
    email: fields.email || "",
    website: fields.website || "",
    rechtsform: fields.rechtsform || "",
    registerGericht: fields.registerGericht || "",
    registerId: fields.registerId || "",
    registerNr: fields.registerNr || "",
    branche: fields.branche || "",
    northDataUrl: fields.northDataUrl || "",
    tags: normalizeTags(fields.tags),
    dedupKeys: buildDedupKeys(fields),
    hasAddress: meta.hasAddress,
    geocodeQuery: meta.geocodeQuery,
  };
}

// Liefert laufend (Realtime) die Kundenliste. scope.all=true liefert alle
// Kunden aller Kollegen (nur fuer die Rolle "owner" von den Sicherheits-
// regeln erlaubt), sonst nur die eigenen (ownerUid = eigene uid).
// "Eigene" Firmen = Firmen, die einem gehoeren (ownerUid) ODER in deren
// Adresspool man aufgenommen ist (poolUids, z. B. dieselbe Firma bei
// Pre-Sales und Werber). Zwei Live-Abfragen, zusammengefuehrt.
export function subscribeCustomers(scope, onChange, onError) {
  const col = collection(db, CUSTOMERS);
  if (scope.all) {
    return onSnapshot(
      query(col),
      (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      onError
    );
  }
  const parts = { owner: null, pool: null };
  const emit = () => {
    if (!parts.owner || !parts.pool) return;
    const byId = new Map();
    [...parts.owner, ...parts.pool].forEach((r) => byId.set(r.id, r));
    onChange(Array.from(byId.values()));
  };
  const un1 = onSnapshot(
    query(col, where("ownerUid", "==", scope.ownerUid)),
    (snap) => {
      parts.owner = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    },
    onError
  );
  const un2 = onSnapshot(
    query(col, where("poolUids", "array-contains", scope.ownerUid)),
    (snap) => {
      parts.pool = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    },
    onError
  );
  return () => {
    un1();
    un2();
  };
}

export async function addCustomer(fields, ownerUid) {
  const docRef = await addDoc(collection(db, CUSTOMERS), {
    ...customerCoreFields(fields),
    lat: null,
    lon: null,
    lastVisitedAt: null,
    lastVisitNote: "",
    lastVisitConfirmed: false,
    membershipSigned: false,
    consultationRequested: false,
    consultationAt: null,
    contacts: [],
    totalProvision: 0,
    source: "manual",
    ownerUid,
    poolUids: [ownerUid],
    createdBy: ownerUid,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function updateCustomer(customerId, fields) {
  const meta = buildAddressMeta(fields);
  await updateDoc(doc(db, CUSTOMERS, customerId), {
    ...fields,
    hasAddress: meta.hasAddress,
    geocodeQuery: meta.geocodeQuery,
    // Adresse geaendert -> alten Geokodierungs-Treffer verwerfen
    lat: null,
    lon: null,
  });
}

export async function deleteCustomer(customerId) {
  await deleteDoc(doc(db, CUSTOMERS, customerId));
}

export async function addTag(customerId, tag) {
  const clean = String(tag).trim();
  if (!clean) return;
  await updateDoc(doc(db, CUSTOMERS, customerId), { tags: arrayUnion(clean) });
}

export async function removeTag(customerId, tag) {
  await updateDoc(doc(db, CUSTOMERS, customerId), { tags: arrayRemove(tag) });
}

export async function saveGeocodeResult(customerId, coords) {
  await updateDoc(doc(db, CUSTOMERS, customerId), {
    lat: coords ? coords.lat : null,
    lon: coords ? coords.lon : null,
  });
}

// visitedAt: optionales Datum "YYYY-MM-DD" (Besuch nachtraeglich erfasst) -
// ohne Angabe zaehlt der aktuelle Zeitpunkt. todoText/todoDueDate landen
// zusaetzlich (nur wenn todoText gesetzt ist) als "offenes ToDo" auf dem
// Kundendokument (openTodo), damit das Dashboard sie ohne Extra-Abfrage
// über alle Besuchs-Unterdokumente hinweg auflisten kann - siehe
// completeTodo() zum Abschliessen.
export async function addVisit(customerId, { note, visitedWith, visitedAt, todoText, todoDueDate, byUid, byName, confirmedByCustomer }) {
  const visitTimestamp = visitedAt ? Timestamp.fromDate(new Date(visitedAt + "T12:00:00")) : serverTimestamp();
  const visitRef = await addDoc(collection(db, CUSTOMERS, customerId, "visits"), {
    note: note || "",
    visitedWith: visitedWith || "",
    byUid,
    byName,
    confirmedByCustomer: Boolean(confirmedByCustomer),
    membershipSigned: false,
    membershipCancelled: false,
    consultationRequested: false,
    consultationAt: null,
    consultationCancelled: false,
    provisionAmount: null,
    todoText: todoText || "",
    todoDueDate: todoDueDate || null,
    todoDone: false,
    visitedAt: visitTimestamp,
  });
  const customerUpdate = {
    lastVisitedAt: visitTimestamp,
    lastVisitNote: note || "",
    lastVisitConfirmed: Boolean(confirmedByCustomer),
  };
  if (todoText) {
    customerUpdate.openTodo = { text: todoText, dueDate: todoDueDate || null, visitId: visitRef.id };
  }
  await updateDoc(doc(db, CUSTOMERS, customerId), customerUpdate);
  return visitRef.id;
}

// Markiert das ToDo eines Besuchs als erledigt (visitId null bei einem
// freien ToDo ohne Besuch, siehe setOpenTodo). Loescht die Spiegelung
// "openTodo" am Kundendokument nur, wenn sie noch auf genau dieses ToDo
// zeigt (sonst gibt es inzwischen ein neueres offenes ToDo, das bestehen
// bleiben soll).
export async function completeTodo(customerId, visitId) {
  if (visitId) {
    await updateDoc(doc(db, CUSTOMERS, customerId, "visits", visitId), { todoDone: true });
  }
  const snap = await getDoc(doc(db, CUSTOMERS, customerId));
  const openTodo = snap.exists() ? snap.data().openTodo : null;
  if (openTodo && (openTodo.visitId || null) === (visitId || null)) {
    await updateDoc(doc(db, CUSTOMERS, customerId), { openTodo: null });
  }
}

// Freies ToDo direkt am Kunden setzen/aendern/loeschen (value.text leer =
// loeschen) - unabhaengig von einem Besuch, damit sich eine Wiedervorlage
// auch nachtraeglich eintragen laesst, ohne dass gleichzeitig ein Besuch
// protokolliert werden muss. visitId bleibt dabei immer null, siehe
// completeTodo() zum Abschliessen.
export async function setOpenTodo(customerId, { text, dueDate }) {
  const clean = String(text || "").trim();
  await updateDoc(doc(db, CUSTOMERS, customerId), {
    openTodo: clean ? { text: clean, dueDate: dueDate || null, visitId: null } : null,
  });
}

// Pensionsrückstellungen sind (anders als die per North-Data-Import
// gesetzten Kennzahlen) manuell erfasst, da North Data dieses Feld nicht
// liefert. Nur "owner" darf schreiben (siehe firestore.rules).
export async function setPensionsrueckstellungen(customerId, value) {
  await setDoc(doc(db, CUSTOMERS, customerId, "financials", FINANCIALS_DOC), { pensionsrueckstellungen: Boolean(value) }, { merge: true });
}

// Ergaenzt einen bestehenden Besuch nachtraeglich um Mitgliedsaufnahme /
// Beratungstermin-Wunsch (vom Vertriebsmitarbeiter selbst erfasst, nicht
// vom Kunden bestaetigt). Wird zusaetzlich am Kundendokument gespiegelt,
// damit das Dashboard ohne separate Abfrage/Index direkt aus der schon
// geladenen Kundenliste zaehlen kann.
//
// Provisionslogik (Stand: Absprache mit Matthias) - die Provision wird
// sofort beim Eintragen des Besuchs fest verbucht (kein spaeterer
// "Ergebnis nachtragen"-Schritt fuer den vereinbarten Termin):
// - Nur Mitgliedschaft (kein Termin) -> Standard 150 EUR netto, editierbar
//   (z.B. bei hoeherem Mitgliedsbeitrag).
// - Nur Beratungstermin vereinbart (keine Mitgliedschaft) -> 112,50 EUR.
// - Beratungstermin UND direkt eine Mitgliedschaft -> 200 EUR.
// provisionAmount kommt bereits fertig berechnet (und ggf. manuell
// angepasst) aus app.js.
export async function updateVisitOutcome(customerId, visitId, { membershipSigned, consultationRequested, consultationAt, provisionAmount }) {
  const amount = membershipSigned || consultationRequested ? Number(provisionAmount) || 0 : 0;
  const outcome = {
    membershipSigned: Boolean(membershipSigned),
    consultationRequested: Boolean(consultationRequested),
    consultationAt: consultationAt || null,
    provisionAmount: amount,
  };
  await updateDoc(doc(db, CUSTOMERS, customerId, "visits", visitId), outcome);

  const customerUpdate = { ...outcome };
  if (amount) {
    customerUpdate.totalProvision = increment(amount);
  }
  await updateDoc(doc(db, CUSTOMERS, customerId), customerUpdate);
}

// Storniert eine Mitgliedschaft oder einen Beratungstermin, die/der bei
// einem einzelnen Besuch eingetragen wurde (z.B. weil der Kunde die
// Aufnahme rueckgaengig macht oder einen Termin absagt). Die
// urspruenglichen Felder (membershipSigned/consultationRequested) bleiben
// als historischer Fakt stehen - membershipCancelled/consultationCancelled
// markieren nur die Stornierung, damit im Verlauf sichtbar bleibt, dass es
// sie einmal gab. provisionAmount kommt bereits fertig (neu) berechnet aus
// app.js (0, oder bei kombinierten Besuchen der jeweils andere
// Standardbetrag) und ersetzt den alten Betrag; die Differenz wird von
// totalProvision am Kunden abgezogen.
//
// Hinweis: aktualisiert membershipSigned/consultationRequested am
// Kundendokument direkt (wie updateVisitOutcome) - falls es danach schon
// einen neueren Besuch mit eigenem Stand gab, wird dessen Stand hier
// ueberschrieben. Fuer den ueblichen Fall (Stornierung kurz nach dem
// betroffenen Besuch) ist das korrekt.
export async function cancelVisitOutcome(customerId, visitId, field, newAmount) {
  const visitRef = doc(db, CUSTOMERS, customerId, "visits", visitId);
  const snap = await getDoc(visitRef);
  if (!snap.exists()) throw new Error("Besuch nicht gefunden.");
  const oldAmount = Number(snap.data().provisionAmount) || 0;
  const amount = Number(newAmount) || 0;
  const delta = amount - oldAmount;

  const visitUpdate = { provisionAmount: amount };
  const customerUpdate = { provisionAmount: amount, totalProvision: increment(delta) };
  if (field === "membership") {
    visitUpdate.membershipCancelled = true;
    customerUpdate.membershipSigned = false;
  } else if (field === "consultation") {
    visitUpdate.consultationCancelled = true;
    customerUpdate.consultationRequested = false;
  }

  await updateDoc(visitRef, visitUpdate);
  await updateDoc(doc(db, CUSTOMERS, customerId), customerUpdate);
}

// Weitere Ansprechpartner zusaetzlich zu Inhaber/gesetzlichen Vertretern
// (z.B. bei Firmen mit mehreren Kontaktpersonen).
export async function addContact(customerId, contact) {
  await updateDoc(doc(db, CUSTOMERS, customerId), {
    contacts: arrayUnion({ name: contact.name || "", rolle: contact.rolle || "", telefon: contact.telefon || "" }),
  });
}

export async function removeContact(customerId, index) {
  const snap = await getDoc(doc(db, CUSTOMERS, customerId));
  const contacts = (snap.exists() && snap.data().contacts) || [];
  contacts.splice(index, 1);
  await updateDoc(doc(db, CUSTOMERS, customerId), { contacts });
}

// Traegt einen Tag nachtraeglich bei allen Kunden mit der angegebenen
// "source" nach (z.B. "North Data" bei bereits importierten
// North-Data-Kunden, die den Tag noch nicht hatten).
export async function backfillSourceTag(source, tag, onProgress) {
  const q = query(collection(db, CUSTOMERS), where("source", "==", source));
  const snap = await getDocs(q);
  const missing = snap.docs.filter((d) => !(d.data().tags || []).includes(tag));
  let done = 0;
  for (const d of missing) {
    await updateDoc(d.ref, { tags: arrayUnion(tag) });
    done++;
    if (onProgress) onProgress(done, missing.length);
  }
  return { updated: done, alreadyTagged: snap.size - missing.length };
}

// Traegt bei Besuchen mit Mitgliedschaft und/oder Beratungstermin, die vor
// Einfuehrung der sofortigen Provisionsberechnung eingetragen wurden (und
// deshalb noch kein provisionAmount haben), die Provision nachtraeglich
// ein: nur Mitgliedschaft = 150 EUR, nur Termin = 112,50 EUR, beides
// zusammen = 200 EUR. Bereits verbuchte Besuche (provisionAmount gesetzt)
// werden nicht angefasst, die Funktion ist also gefahrlos mehrfach
// ausfuehrbar.
//
// "customers" ist die bereits geladene, nach Scope gefilterte Kundenliste
// (state.customers) - so deckt die Migration bei "owner" mit aktiviertem
// "Alle Kollegen anzeigen" auch Kunden ab, die einem Kollegen gehoeren
// (ownerUid != eigene uid), statt nur die eigenen.
export async function backfillMissingProvisions(customers, onProgress) {
  const candidates = customers.filter((c) => c.membershipSigned || c.consultationRequested);
  let updated = 0;
  let checked = 0;
  for (const cust of candidates) {
    checked++;
    if (onProgress) onProgress(checked, candidates.length);
    const visitsSnap = await getDocs(query(collection(db, CUSTOMERS, cust.id, "visits"), orderBy("visitedAt", "desc")));
    let customerTotal = 0;
    for (const v of visitsSnap.docs) {
      const data = v.data();
      if (!data.membershipSigned && !data.consultationRequested) continue;
      if (data.provisionAmount) continue;
      const amount = data.membershipSigned && data.consultationRequested ? 200 : data.membershipSigned ? 150 : 112.5;
      await updateDoc(v.ref, { provisionAmount: amount });
      customerTotal += amount;
    }
    if (customerTotal > 0) {
      await updateDoc(doc(db, CUSTOMERS, cust.id), { totalProvision: increment(customerTotal) });
      updated++;
    }
  }
  return { checked: candidates.length, updated };
}

export async function getVisits(customerId) {
  const col = collection(db, CUSTOMERS, customerId, "visits");
  const q = query(col, orderBy("visitedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Einmaliger Import der urspruenglichen Excel-Liste (window.ADDRESS_DATA)
// in Firestore, unter der eigenen ownerUid. Nur sinnvoll, solange die
// eigene Kundenliste noch leer ist.
export async function importStaticAddresses(ownerUid, staticRecords, onProgress) {
  let imported = 0;
  for (const rec of staticRecords) {
    await addDoc(collection(db, CUSTOMERS), {
      ...customerCoreFields(rec),
      lat: null,
      lon: null,
      lastVisitedAt: null,
      lastVisitNote: "",
      lastVisitConfirmed: false,
      membershipSigned: false,
      consultationRequested: false,
      consultationAt: null,
      contacts: [],
      totalProvision: 0,
      source: "excel",
      ownerUid,
      poolUids: [ownerUid],
      createdBy: ownerUid,
      createdAt: serverTimestamp(),
    });
    imported++;
    if (onProgress) onProgress(imported, staticRecords.length);
  }
  return imported;
}

export async function getFinancials(customerId) {
  const snap = await getDoc(doc(db, CUSTOMERS, customerId, "financials", FINANCIALS_DOC));
  return snap.exists() ? snap.data() : null;
}

export async function countOwnCustomers(ownerUid) {
  const q = query(collection(db, CUSTOMERS), where("ownerUid", "==", ownerUid));
  const snap = await getDocs(q);
  return snap.size;
}

// Einmaliger (nicht live) Abruf aller Kunden einer Person - z.B. fuer
// einen Komplett-Ausdruck fuer Kollegen, die die App nicht selbst
// nutzen koennen.
export async function getCustomersForOwner(ownerUid) {
  const col = collection(db, CUSTOMERS);
  const [a, b] = await Promise.all([
    getDocs(query(col, where("ownerUid", "==", ownerUid))),
    getDocs(query(col, where("poolUids", "array-contains", ownerUid))),
  ]);
  const byId = new Map();
  [...a.docs, ...b.docs].forEach((d) => byId.set(d.id, { id: d.id, ...d.data() }));
  return Array.from(byId.values());
}

// Liste aller registrierten Nutzer - Sicherheitsregeln erlauben das
// nur fuer die Rolle "owner" (z.B. fuer die Auswahl beim Kunden Import).
export async function listUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}

// Name und Funktionen (presales/werber/makler) einer Person setzen - nur
// "owner" (siehe firestore.rules). Rolle und financialsAccess bleiben
// bewusst Sache der Firebase-Konsole.
export async function updateUserProfile(uid, { name, functions }) {
  await updateDoc(doc(db, "users", uid), {
    name: String(name || "").trim(),
    functions: normalizeFunctions(functions),
  });
}


// ---------- Dublettenschutz ----------

// Alle Firmen einmalig (nicht live) laden - Grundlage fuer die
// Dublettenpruefung beim Anlegen, beim Import und fuers Zusammenfuehren.
export async function getAllCustomers() {
  const snap = await getDocs(collection(db, CUSTOMERS));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function getCustomer(customerId) {
  const snap = await getDoc(doc(db, CUSTOMERS, customerId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Nur Kennzahlen mit Wert uebernehmen (null/leer ueberschreibt nichts).
function nonEmptyValues(obj) {
  const out = {};
  Object.entries(obj || {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  });
  return out;
}

// Ergaenzt eine vorhandene Firma um die Angaben eines neuen Datensatzes:
// leere Felder werden gefuellt, Vorhandenes nie ueberschrieben, Tags
// zusammengefuehrt. Finanzkennzahlen (nur "owner", z. B. beim
// North-Data-Import) werden aktualisiert - dabei kommen u. a. die
// Pensionsrueckstellungen als Betrag dazu. Liefert die Liste der
// ergaenzten Felder.
export async function mergeIntoCustomer(existing, incoming, { withFinancials = false, addPoolUid = null } = {}) {
  const update = fillEmptyFields(existing, incoming);
  if (addPoolUid && existing.ownerUid !== addPoolUid && !(existing.poolUids || []).includes(addPoolUid)) {
    update.poolUids = arrayUnion(addPoolUid);
  }
  const merged = { ...existing, ...update };
  const tags = Array.from(new Set([...(existing.tags || []), ...((incoming.tags || []).filter(Boolean))]));
  if (tags.length !== (existing.tags || []).length) update.tags = tags;
  update.dedupKeys = buildDedupKeys(merged);
  if (update.strasse || update.plz || update.ort) {
    const meta = buildAddressMeta(merged);
    update.hasAddress = meta.hasAddress;
    update.geocodeQuery = meta.geocodeQuery;
    update.lat = null;
    update.lon = null;
  }
  update.lastMergedAt = serverTimestamp();
  await updateDoc(doc(db, CUSTOMERS, existing.id), update);

  const changed = Object.keys(update).filter((k) => !["dedupKeys", "lastMergedAt", "hasAddress", "geocodeQuery", "lat", "lon", "poolUids"].includes(k));
  if (withFinancials && incoming.financials) {
    const fin = nonEmptyValues(incoming.financials);
    if (Object.keys(fin).length) {
      await setDoc(doc(db, CUSTOMERS, existing.id, "financials", FINANCIALS_DOC), fin, { merge: true });
      changed.push("Finanzkennzahlen");
    }
  }
  return changed;
}

// Fuehrt einen vorbereiteten Import-Plan aus (siehe app.js):
// [{ action: "new" | "merge" | "skip", rec, target }]
export async function runImportPlan(plan, targetOwnerUid, createdByUid, onProgress) {
  const result = { created: 0, merged: 0, skipped: 0 };
  let done = 0;
  for (const item of plan) {
    if (item.action === "new") {
      const docRef = await addDoc(collection(db, CUSTOMERS), {
        ...customerCoreFields(item.rec),
        lat: null,
        lon: null,
        lastVisitedAt: null,
        lastVisitNote: "",
        lastVisitConfirmed: false,
        membershipSigned: false,
        consultationRequested: false,
        consultationAt: null,
        contacts: [],
        totalProvision: 0,
        source: item.rec.source || "import",
        ownerUid: targetOwnerUid,
        poolUids: [targetOwnerUid],
        createdBy: createdByUid,
        createdAt: serverTimestamp(),
        importedAt: serverTimestamp(),
      });
      if (item.rec.financials && Object.keys(nonEmptyValues(item.rec.financials)).length) {
        await setDoc(doc(db, CUSTOMERS, docRef.id, "financials", FINANCIALS_DOC), nonEmptyValues(item.rec.financials));
      }
      result.created++;
    } else if (item.action === "merge" && item.target) {
      await mergeIntoCustomer(item.target, item.rec, { withFinancials: true, addPoolUid: targetOwnerUid });
      result.merged++;
    } else {
      result.skipped++;
    }
    done++;
    if (onProgress) onProgress(done, plan.length);
  }
  return result;
}

function tsMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === "function") return ts.toMillis();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

// Fuehrt Dubletten zusammen (nur "owner"): alles von den Neben-Firmen
// wandert auf die Haupt-Firma - Besuche, ToDo, Ansprechpartner, Tags,
// Mitgliedschaft/Termin-Stand, Kennzahl-Summe, Finanzkennzahlen, Anrufe und
// Termine. Danach werden die Neben-Firmen geloescht.
export async function mergeDuplicateFirms(primary, secondaries) {
  const merged = { ...primary };
  const update = {};
  const contactKey = (c) => (c.name || "") + "|" + (c.telefon || "");
  const contacts = [...(primary.contacts || [])];
  const tags = new Set(primary.tags || []);
  let fin = (await getFinancials(primary.id)) || {};

  for (const sec of secondaries) {
    Object.assign(update, fillEmptyFields(merged, sec));
    Object.assign(merged, update);
    (sec.tags || []).forEach((t) => tags.add(t));
    (sec.contacts || []).forEach((c) => {
      if (!contacts.some((x) => contactKey(x) === contactKey(c))) contacts.push(c);
    });
    if (sec.membershipSigned) update.membershipSigned = true;
    if (sec.consultationRequested) {
      update.consultationRequested = true;
      if (!merged.consultationAt && sec.consultationAt) update.consultationAt = sec.consultationAt;
    }
    if (sec.totalProvision) update.totalProvision = (merged.totalProvision || 0) + sec.totalProvision;
    Object.assign(merged, update);
    if (tsMillis(sec.lastVisitedAt) > tsMillis(merged.lastVisitedAt)) {
      update.lastVisitedAt = sec.lastVisitedAt;
      update.lastVisitNote = sec.lastVisitNote || "";
      update.lastVisitConfirmed = Boolean(sec.lastVisitConfirmed);
      Object.assign(merged, update);
    }
    if (!(merged.openTodo && merged.openTodo.text) && sec.openTodo && sec.openTodo.text) {
      update.openTodo = sec.openTodo;
      merged.openTodo = sec.openTodo;
    }

    // Besuche umziehen (gleiche Dokument-ID behalten)
    const visits = await getDocs(collection(db, CUSTOMERS, sec.id, "visits"));
    for (const v of visits.docs) {
      await setDoc(doc(db, CUSTOMERS, primary.id, "visits", v.id), v.data());
    }
    // Finanzkennzahlen: Haupt-Firma hat Vorrang, fehlende Werte ergaenzen
    const secFin = await getFinancials(sec.id);
    if (secFin) fin = { ...nonEmptyValues(secFin), ...nonEmptyValues(fin) };
    // Anrufe und Termine auf die Haupt-Firma umhaengen
    for (const colName of ["calls", "appointments"]) {
      const snap = await getDocs(query(collection(db, colName), where("customerId", "==", sec.id)));
      for (const d of snap.docs) await updateDoc(d.ref, { customerId: primary.id });
    }
  }

  update.tags = Array.from(tags);
  update.contacts = contacts;
  update.dedupKeys = buildDedupKeys(merged);
  update.mergedFrom = arrayUnion(...secondaries.map((s) => s.id));
  update.lastMergedAt = serverTimestamp();
  if (update.strasse || update.plz || update.ort) {
    const meta = buildAddressMeta(merged);
    update.hasAddress = meta.hasAddress;
    update.geocodeQuery = meta.geocodeQuery;
    update.lat = null;
    update.lon = null;
  }
  await updateDoc(doc(db, CUSTOMERS, primary.id), update);
  if (Object.keys(fin).length) {
    await setDoc(doc(db, CUSTOMERS, primary.id, "financials", FINANCIALS_DOC), fin);
  }

  // Neben-Firmen samt Unterdokumenten loeschen
  for (const sec of secondaries) {
    const visits = await getDocs(collection(db, CUSTOMERS, sec.id, "visits"));
    for (const v of visits.docs) await deleteDoc(v.ref);
    await deleteDoc(doc(db, CUSTOMERS, sec.id, "financials", FINANCIALS_DOC));
    await deleteDoc(doc(db, CUSTOMERS, sec.id));
  }
}

// Zwei Firmen als "keine Dublette" markieren, damit sie im Werkzeug
// "Dubletten zusammenfuehren" nicht mehr vorgeschlagen werden.
export async function markNotDuplicate(ids) {
  for (const id of ids) {
    const others = ids.filter((x) => x !== id);
    await updateDoc(doc(db, CUSTOMERS, id), { notDuplicateWith: arrayUnion(...others) });
  }
}

// ---------- Telefonakquise (Pre-Sales) ----------

const CALLS = "calls";
const APPOINTMENTS = "appointments";

// Ergebnis eines Anrufs speichern. result:
//   "nicht_erreicht" | "rueckruf" | "kein_interesse" | "termin" |
//   "falsche_nummer" | "nicht_mehr_anrufen"
// Am Firmendokument werden letzter Anruf, Anzahl Anrufe, Wiedervorlage
// (callback) und ggf. "Nicht mehr anrufen" gespiegelt, damit Listen ohne
// Extra-Abfrage auskommen.
export async function logCall(firm, { result, spokeWith, note, callback, appointmentId, byUid, byName }) {
  const callRef = await addDoc(collection(db, CALLS), {
    customerId: firm.id,
    firmName: firm.unternehmen || "",
    plz: firm.plz || "",
    ort: firm.ort || "",
    byUid,
    byName,
    at: serverTimestamp(),
    result,
    spokeWith: spokeWith || "",
    note: note || "",
    callbackDate: callback ? callback.date : null,
    appointmentId: appointmentId || null,
  });
  const update = {
    lastCall: { at: Timestamp.now(), byUid, byName, result, spokeWith: spokeWith || "" },
    callCount: increment(1),
    // Wiedervorlage: nur bei "Spaeter nochmal" neu setzen, sonst erledigt
    callback: callback
      ? { date: callback.date, time: callback.time || "", note: callback.note || "", byUid, byName }
      : null,
  };
  if (result === "nicht_mehr_anrufen") update.doNotCall = true;
  if (result === "kein_interesse") update.stage = "kein_interesse";
  else if (result === "termin") update.stage = "termin";
  await updateDoc(doc(db, CUSTOMERS, firm.id), update);
  return callRef.id;
}

// Termin vereinbaren (von Pre-Sales oder Werber fuer eine/n Kolleg:in).
// type: "bdst" (Mitgliedschaft) | "makler" (Steuerthema)
export async function createAppointment(firm, { type, forUid, forName, date, time, contactName, setByUid, setByName, setByFunction }) {
  const when = new Date(date + "T" + (time || "09:00") + ":00");
  const ref = await addDoc(collection(db, APPOINTMENTS), {
    customerId: firm.id,
    firmName: firm.unternehmen || "",
    strasse: firm.strasse || "",
    plz: firm.plz || "",
    ort: firm.ort || "",
    telefon: firm.telefon || "",
    type,
    setByUid,
    setByName,
    setByFunction: setByFunction || "",
    forUid,
    forName,
    at: Timestamp.fromDate(when),
    date,
    time: time || "",
    contactName: contactName || "",
    status: "geplant",
    history: [{ at: new Date().toISOString(), byUid: setByUid, byName: setByName, action: "vereinbart", date, time: time || "" }],
    createdAt: serverTimestamp(),
  });
  await updateDoc(doc(db, CUSTOMERS, firm.id), {
    nextAppointment: { id: ref.id, at: Timestamp.fromDate(when), date, time: time || "", forUid, forName, type, setByName },
  });
  return ref.id;
}

// Anrufe einer Person (oder aller, uid = null; nur "owner") - fuer die
// Auswertung. Zeitraum wird in der App gefiltert.
export async function getCalls(uid) {
  const col = collection(db, CALLS);
  const snap = await getDocs(uid ? query(col, where("byUid", "==", uid)) : col);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Termine, die eine Person vereinbart hat (oder alle, uid = null).
export async function getAppointmentsSetBy(uid) {
  const col = collection(db, APPOINTMENTS);
  const snap = await getDocs(uid ? query(col, where("setByUid", "==", uid)) : col);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Verlauf einer Firma: Anrufe und Termine.
export async function getFirmActivity(customerId) {
  const [calls, appts] = await Promise.all([
    getDocs(query(collection(db, CALLS), where("customerId", "==", customerId))),
    getDocs(query(collection(db, APPOINTMENTS), where("customerId", "==", customerId))),
  ]);
  return {
    calls: calls.docs.map((d) => ({ id: d.id, ...d.data() })),
    appointments: appts.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
}

// Adresspool zuweisen (nur "owner"): Firmen einer anderen Person geben.
export async function assignFirms(customerIds, targetUid, onProgress) {
  let done = 0;
  for (const id of customerIds) {
    await updateDoc(doc(db, CUSTOMERS, id), { poolUids: arrayUnion(targetUid) });
    done++;
    if (onProgress) onProgress(done, customerIds.length);
  }
  return done;
}

// Offene Wiedervorlagen (Rueckrufe) einer Person - unabhaengig davon, ob
// die Firma im eigenen Pool liegt.
export async function getMyCallbacks(uid) {
  const snap = await getDocs(query(collection(db, CUSTOMERS), where("callback.byUid", "==", uid)));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------- Termine wahrnehmen (Werber / Makler) ----------

// Termine, die eine Person wahrnimmt (forUid) - oder alle (uid = null).
export async function getAppointmentsFor(uid) {
  const col = collection(db, APPOINTMENTS);
  const snap = await getDocs(uid ? query(col, where("forUid", "==", uid)) : col);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Termin aendern (durchgefuehrt / verschoben / abgesagt) mit Eintrag im
// Verlauf; optional zugleich die Firma fortschreiben. "nextAppointment"
// an der Firma wird nur geleert, wenn es noch auf diesen Termin zeigt.
export async function updateAppointment(appt, update, historyEntry, firmUpdate, { clearNext = false, setNext = null } = {}) {
  const data = { ...update };
  if (historyEntry) data.history = arrayUnion({ ...historyEntry, at: new Date().toISOString() });
  await updateDoc(doc(db, APPOINTMENTS, appt.id), data);
  const fu = { ...(firmUpdate || {}) };
  if (clearNext || setNext) {
    const snap = await getDoc(doc(db, CUSTOMERS, appt.customerId));
    const next = snap.exists() ? snap.data().nextAppointment : null;
    if (setNext) fu.nextAppointment = setNext;
    else if (next && next.id === appt.id) fu.nextAppointment = null;
  }
  if (Object.keys(fu).length) await updateDoc(doc(db, CUSTOMERS, appt.customerId), fu);
}

export { increment as fsIncrement, arrayUnion as fsArrayUnion, Timestamp as FsTimestamp };


// Liegt eine Firma im Pool einer Person (Besitzer oder poolUids)?
export function inPoolOf(firm, uid) {
  return Boolean(firm) && (firm.ownerUid === uid || (firm.poolUids || []).includes(uid));
}
