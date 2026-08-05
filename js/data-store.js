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

import { db } from "./firebase-app.js?v=20260805c";
import { buildAddressMeta } from "./address-utils.js?v=20260805c";

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
    pendingConsultation: null,
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
    membershipAmount: null,
    consultationRequested: false,
    consultationAt: null,
    consultationOutcome: null,
    consultationAmount: null,
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
// Provisionslogik (Stand: Absprache mit Matthias):
// - Mitgliedschaft direkt beim Besuch (nicht ueber einen separat
//   vereinbarten Beratungstermin) -> membershipAmount, Standard 150 EUR
//   netto, editierbar (z.B. bei hoeherem Mitgliedsbeitrag).
// - Ein separat vereinbarter Beratungstermin wird zunaechst nur als
//   "offen" auf dem Kundendokument gemerkt (pendingConsultation). Das
//   Ergebnis (Aufnahme ja/nein, 200 EUR bzw. 112,50 EUR) wird erst
//   spaeter ueber resolveConsultation() erfasst, wenn der Termin
//   stattgefunden hat.
export async function updateVisitOutcome(customerId, visitId, { membershipSigned, membershipAmount, consultationRequested, consultationAt }) {
  const amount = membershipSigned ? Number(membershipAmount) || 0 : null;
  const outcome = {
    membershipSigned: Boolean(membershipSigned),
    membershipAmount: amount,
    consultationRequested: Boolean(consultationRequested),
    consultationAt: consultationAt || null,
  };
  await updateDoc(doc(db, CUSTOMERS, customerId, "visits", visitId), outcome);

  const customerUpdate = { ...outcome };
  if (membershipSigned && amount) {
    customerUpdate.totalProvision = increment(amount);
  }
  customerUpdate.pendingConsultation = consultationRequested && consultationAt ? { visitId, at: consultationAt } : null;
  await updateDoc(doc(db, CUSTOMERS, customerId), customerUpdate);
}

// Traegt das Ergebnis eines zuvor vereinbarten Beratungstermins nach, sobald
// er stattgefunden hat (siehe pendingConsultation auf dem Kundendokument).
export async function resolveConsultation(customerId, visitId, { membershipSigned, amount }) {
  const amt = Number(amount) || 0;
  const outcome = {
    consultationOutcome: membershipSigned ? "membership" : "none",
    consultationAmount: amt,
  };
  await updateDoc(doc(db, CUSTOMERS, customerId, "visits", visitId), outcome);

  const customerUpdate = {
    pendingConsultation: null,
    totalProvision: increment(amt),
  };
  if (membershipSigned) customerUpdate.membershipSigned = true;
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

// Migriert Beratungstermine, die vor Einfuehrung von pendingConsultation /
// "Offene Beratungstermine" vereinbart wurden: sucht je Kunde den
// juengsten Besuch mit consultationRequested=true ohne Ergebnis und traegt
// ihn als pendingConsultation nach, damit er in der Liste auftaucht und
// sein Ergebnis (und damit die Provision) nachtraeglich erfasst werden
// kann. Bereits als "offen" bekannte oder bereits abgeschlossene Termine
// werden nicht angefasst.
export async function backfillPendingConsultations(ownerUid, onProgress) {
  const q = query(collection(db, CUSTOMERS), where("ownerUid", "==", ownerUid), where("consultationRequested", "==", true));
  const snap = await getDocs(q);
  const candidates = snap.docs.filter((d) => !d.data().pendingConsultation);
  let updated = 0;
  let checked = 0;
  for (const custDoc of candidates) {
    checked++;
    if (onProgress) onProgress(checked, candidates.length);
    const visitsSnap = await getDocs(query(collection(db, CUSTOMERS, custDoc.id, "visits"), orderBy("visitedAt", "desc")));
    const openVisit = visitsSnap.docs.find((v) => v.data().consultationRequested && !v.data().consultationOutcome);
    if (!openVisit) continue;
    const at = openVisit.data().consultationAt || custDoc.data().consultationAt;
    if (!at) continue;
    await updateDoc(custDoc.ref, { pendingConsultation: { visitId: openVisit.id, at } });
    updated++;
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
      pendingConsultation: null,
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
      pendingConsultation: null,
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

// Liste aller registrierten Nutzer - Sicherheitsregeln erlauben das
// nur fuer die Rolle "owner" (z.B. fuer die Auswahl beim Kunden Import).
export async function listUsers() {
  const snap = await getDocs(collection(db, "users"));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
}
