// Initialisiert Firebase (Auth + Firestore) und stellt kleine Hilfsfunktionen
// fuer Login/Logout und das Nutzerprofil-Dokument bereit.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

export function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

// Legt beim ersten Login ein users/{uid}-Dokument an (Rolle "colleague" als
// sicherer Standard). Die Rolle "owner" muss einmalig manuell in der
// Firebase-Konsole gesetzt werden (siehe README) - so kann sich niemand
// selbst zum Chef befoerdern.
export async function ensureUserDoc(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: user.email,
      email: user.email,
      role: "colleague",
      createdAt: serverTimestamp(),
    });
    return { name: user.email, email: user.email, role: "colleague" };
  }
  return snap.data();
}

export async function getUserDoc(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}
