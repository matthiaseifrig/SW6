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
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

import { db } from "./firebase-app.js";
import { buildAddressMeta } from "./address-utils.js";

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
  await addDoc(collection(db, CUSTOMERS, customerId, "visits"), {
    note: note || "",
    byUid,
    byName,
    confirmedByCustomer: Boolean(confirmedByCustomer),
    visitedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, CUSTOMERS, customerId), {
    lastVisitedAt: serverTimestamp(),
    lastVisitNote: note || "",
    lastVisitConfirmed: Boolean(confirmedByCustomer),
  });
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
