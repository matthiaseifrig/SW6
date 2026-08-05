// Kleine, von mehreren Stellen genutzte Hilfsfunktion: baut aus
// Strasse/PLZ/Ort die Sucheanfrage fuer die Geokodierung und legt fest, ob
// eine Adresse ueberhaupt auf der Karte einplanbar ist.
export function buildAddressMeta({ strasse, plz, ort }) {
  const s = (strasse || "").trim();
  const p = (plz || "").trim();
  const o = (ort || "").trim();
  const hasAddress = Boolean(o) && (Boolean(s) || Boolean(p));

  if (!hasAddress) {
    return { hasAddress: false, geocodeQuery: "" };
  }
  const parts = [];
  if (s) parts.push(s);
  const plzOrt = [p, o].filter(Boolean).join(" ").trim();
  if (plzOrt) parts.push(plzOrt);
  parts.push("Deutschland");
  return { hasAddress: true, geocodeQuery: parts.join(", ") };
}
