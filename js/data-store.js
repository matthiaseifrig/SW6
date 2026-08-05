// Alle Firestore-Zugriffe rund um Kunden/Adressen und Besuche an einer
// Stelle gebuendelt.
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  onSnapshot,
  getDocs,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

import { db } from "./firebase-app.js";
import { buildAddressMeta } from "./address-utils.js";

const CUSTOMERS = "customers";

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
  const meta = buildAddressMeta(fields);
  const docRef = await addDoc(collection(db, CUSTOMERS), {
    unternehmen: fields.unternehmen || "",
    strasse: fields.strasse || "",
    plz: fields.plz || "",
    ort: fields.ort || "",
    inhaber: fields.inhaber || "",
    telefon: fields.telefon || "",
    email: fields.email || "",
    website: fields.website || "",
    hasAddress: meta.hasAddress,
    geocodeQuery: meta.geocodeQuery,
    lat: null,
    lon: null,
    lastVisitedAt: null,
    lastVisitNote: "",
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

export async function saveGeocodeResult(customerId, coords) {
  await updateDoc(doc(db, CUSTOMERS, customerId), {
    lat: coords ? coords.lat : null,
    lon: coords ? coords.lon : null,
  });
}

export async function addVisit(customerId, { note, byUid, byName }) {
  await addDoc(collection(db, CUSTOMERS, customerId, "visits"), {
    note: note || "",
    byUid,
    byName,
    visitedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, CUSTOMERS, customerId), {
    lastVisitedAt: serverTimestamp(),
    lastVisitNote: note || "",
  });
}

export function subscribeVisits(customerId, onChange, onError) {
  const col = collection(db, CUSTOMERS, customerId, "visits");
  const q = query(col, orderBy("visitedAt", "desc"));
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError
  );
}

// Einmaliger Import der urspruenglichen Excel-Liste (window.ADDRESS_DATA)
// in Firestore, unter der eigenen ownerUid. Nur sinnvoll, solange die
// eigene Kundenliste noch leer ist.
export async function importStaticAddresses(ownerUid, staticRecords, onProgress) {
  let imported = 0;
  for (const rec of staticRecords) {
    const meta = buildAddressMeta(rec);
    await addDoc(collection(db, CUSTOMERS), {
      unternehmen: rec.unternehmen || "",
      strasse: rec.strasse || "",
      plz: rec.plz || "",
      ort: rec.ort || "",
      inhaber: rec.inhaber || "",
      telefon: rec.telefon || "",
      email: rec.email || "",
      website: rec.website || "",
      hasAddress: meta.hasAddress,
      geocodeQuery: meta.geocodeQuery,
      lat: null,
      lon: null,
      lastVisitedAt: null,
      lastVisitNote: "",
      ownerUid,
      createdBy: ownerUid,
      createdAt: serverTimestamp(),
    });
    imported++;
    if (onProgress) onProgress(imported, staticRecords.length);
  }
  return imported;
}

export async function countOwnCustomers(ownerUid) {
  const q = query(collection(db, CUSTOMERS), where("ownerUid", "==", ownerUid));
  const snap = await getDocs(q);
  return snap.size;
}

export async function getVisits(customerId) {
  const col = collection(db, CUSTOMERS, customerId, "visits");
  const q = query(col, orderBy("visitedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
