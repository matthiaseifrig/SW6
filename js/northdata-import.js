import { formatRegister } from "./dedup.js?v=20261109f";

// Parst CSV-Exporte von North Data (semikolon-getrennt, Windows-1252 oder
// UTF-8 kodiert, deutsches Zahlenformat) in die Kundenstruktur der App.

// Minimaler CSV-Parser mit Unterstuetzung fuer per Anfuehrungszeichen
// geschuetzte Felder (falls ein Feld selbst das Trennzeichen enthaelt).
export function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      pushField();
    } else if (c === "\r") {
      // ignorieren, \n beendet die Zeile
    } else if (c === "\n") {
      pushRow();
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

export function parseGermanNumber(s) {
  if (s === null || s === undefined) return null;
  const trimmed = String(s).trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(normalized);
  return Number.isNaN(n) ? null : n;
}

const COLUMN_MAP = {
  unternehmen: "Name",
  rechtsform: "Rechtsform",
  strasse: "Straße",
  plz: "PLZ",
  ort: "Ort",
  registerGericht: "HR Amtsgericht",
  registerId: "Register-ID",
  northDataUrl: "North Data URL",
  telefon: "Tel.",
  email: "E-Mail",
  website: "Website",
  branche: "Branche (WZ)",
  vertreter1: "Ges. Vertreter 1",
  vertreter2: "Ges. Vertreter 2",
  vertreter3: "Ges. Vertreter 3",
};

// Zahlen-Kennzahlen (deutsches Zahlenformat). Pensionsrückstellungen kommen
// seit dem erweiterten Export als Betrag in EUR mit.
const FINANCIAL_COLUMN_MAP = {
  umsatz: "Umsatz EUR",
  umsatzCagr: "Umsatz CAGR %",
  gewinn: "Gewinn EUR",
  gewinnCagr: "Gewinn CAGR %",
  mitarbeiterzahl: "Mitarbeiterzahl",
  bilanzsumme: "Bilanzsumme EUR",
  eigenkapital: "Eigenkapital EUR",
  personalaufwand: "Personalaufwand EUR",
  pensionsrueckstellungenEur: "Pensionsrückstellungen EUR",
};

// Text-Kennzahlen (z. B. Stichtag der Finanzkennzahlen)
const FINANCIAL_TEXT_COLUMN_MAP = {
  finanzkennzahlenDatum: "Finanzkennzahlen Datum",
};

// North-Data-Exporte kommen je nach Einstellung als Windows-1252 (ANSI)
// oder als UTF-8 (ggf. mit BOM). Erst streng als UTF-8 versuchen - wenn
// das scheitert (ungueltige Bytefolgen, typisch fuer ANSI-Umlaute), als
// Windows-1252 lesen.
export function decodeCsvBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.replace(/^\uFEFF/, "");
  } catch (e) {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function buildHeaderIndex(headerRow) {
  const index = {};
  headerRow.forEach((name, i) => {
    index[name.replace(/^\uFEFF/, "").trim()] = i;
  });
  return index;
}

// text: bereits als String dekodierter Dateiinhalt (siehe readFileAsText
// in app.js, wichtig wegen ISO-8859-1-Kodierung der North-Data-Exporte).
export function parseNorthDataCsv(text) {
  const rows = parseDelimited(text, ";");
  if (rows.length < 2) return [];
  const headerIndex = buildHeaderIndex(rows[0]);

  const get = (row, label) => {
    const idx = headerIndex[label];
    return idx === undefined ? "" : (row[idx] || "").trim();
  };

  const records = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row.length || row.every((c) => !c.trim())) continue;

    const rec = { source: "northdata", tags: ["North Data"] };
    Object.entries(COLUMN_MAP).forEach(([field, label]) => {
      rec[field] = get(row, label);
    });
    if (!rec.unternehmen) continue;

    const financials = {};
    let hasFinancials = false;
    Object.entries(FINANCIAL_COLUMN_MAP).forEach(([field, label]) => {
      const raw = get(row, label);
      const num = parseGermanNumber(raw);
      financials[field] = num;
      if (num !== null) hasFinancials = true;
    });
    Object.entries(FINANCIAL_TEXT_COLUMN_MAP).forEach(([field, label]) => {
      const raw = get(row, label);
      financials[field] = raw || null;
    });
    // Bei bekanntem Betrag auch das bisherige Ja/Nein-Feld mitfuehren
    // (wird an mehreren Stellen in der App angezeigt).
    if (financials.pensionsrueckstellungenEur !== null) {
      financials.pensionsrueckstellungen = financials.pensionsrueckstellungenEur > 0;
    }
    rec.financials = hasFinancials ? financials : null;
    rec.registerNr = formatRegister(rec.registerGericht, rec.registerId);

    records.push(rec);
  }
  return records;
}
