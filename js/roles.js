// Funktionen (Arbeitsbereiche) im Team - unabhaengig von der Rolle
// "owner"/"colleague". Eine Person kann mehrere Funktionen haben.
// Gesetzt vom Chef (owner) in der App unter "Benutzer".
export const FUNCTIONS = [
  { key: "presales", label: "Pre-Sales (Telefon)" },
  { key: "werber", label: "BdSt-Werber" },
  { key: "makler", label: "Makler" },
];

export function functionLabel(key) {
  const f = FUNCTIONS.find((x) => x.key === key);
  return f ? f.label : key;
}

export function normalizeFunctions(list) {
  const valid = FUNCTIONS.map((f) => f.key);
  return Array.from(new Set((Array.isArray(list) ? list : []).filter((k) => valid.includes(k))));
}
