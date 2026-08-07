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
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

import { db } from "./firebase-app.js?v=20260807a";
import { buildAddressMeta } from "./address-utils.js?v=20260807a";

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
    tags: normalizeTags(fields.tags),
    hasAddress: meta.hasAddress,
    geocodeQuery: meta.geocodeQuery,
  };
}

// Liefert laufend (Realtime) die Kundenliste. scope.all=true liefert alle
// Kunden aller Kollegen (nur fuer die Rolle "owner" von den Sicherheits-
// regeln erlaubt), sonst nur die eigenen (ownerUid = eigene uid).
export function subscribeCustomers(scope, onChange, onError) {
  const col = collection(db, CUSTOMERS);
  const q = scope.all ? query(col) : query(col, where("ownerUid", "==", scope.ownerUid));
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onChange(rows);
    },
    onError
  );
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

export async function addVisit(customerId, { note, byUid, byName, confirmedByCustomer }) {
  const visitRef = await addDoc(collection(db, CUSTOMERS, customerId, "visits"), {
    note: note || "",
    byUid,
    byName,
    confirmedByCustomer: Boolean(confirmedByCustomer),
    membershipSigned: false,
    membershipCancelled: false,
    consultationRequested: false,
    consultationAt: null,
    consultationCancelled: false,
    provisionAmount: null,
    visitedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, CUSTOMERS, customerId), {
    lastVisitedAt: serverTimestamp(),
    lastVisitNote: note || "",
    lastVisitConfirmed: Boolean(confirmedByCustomer),
  });
  return visitRef.id;
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
      createdBy: ownerUid,
      createdAt: serverTimestamp(),
    });
    imported++;
    if (onProgress) onProgress(imported, staticRecords.length);
  }
  return imported;
}

// Import fuer einen Kollegen durch "owner": legt Kunden im Namen von
// targetOwnerUid an (von den Sicherheitsregeln nur fuer "owner" erlaubt)
// und speichert optionale Finanzkennzahlen in einer separaten, nur fuer
// "owner" lesbaren Unter-Sammlung.
export async function importRecordsForColleague(targetOwnerUid, createdByUid, records, onProgress) {
  let imported = 0;
  for (const rec of records) {
    const docRef = await addDoc(collection(db, CUSTOMERS), {
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
      source: rec.source || "import",
      ownerUid: targetOwnerUid,
      createdBy: createdByUid,
      createdAt: serverTimestamp(),
    });
    if (rec.financials && Object.values(rec.financials).some((v) => v !== null && v !== undefined)) {
      await setDoc(doc(db, CUSTOMERS, docRef.id, "financials", FINANCIALS_DOC), rec.financials);
    }
    imported++;
    if (onProgress) onProgress(imported, records.length);
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
  const q = query(collection(db, CUSTOMERS), where("ownerUid", "==", ownerUid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// Liste aller registrierten Nutzer - Sicherheitsregeln erlauben das
// nur fuer die Rolle "owner" (z.B. fuer die Auswahl beim Kunden Import).
export async function listUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
