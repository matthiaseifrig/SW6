// Parst CSV-Exporte von North Data (semikolon-getrennt, ISO-8859-1/CP1252
// kodiert, deutsches Zahlenformat) in die Kundenstruktur der App.

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
  strasse: "Straße",
  plz: "PLZ",
  ort: "Ort",
  telefon: "Tel.",
  email: "E-Mail",
  website: "Website",
  vertreter1: "Ges. Vertreter 1",
  vertreter2: "Ges. Vertreter 2",
  vertreter3: "Ges. Vertreter 3",
};

const FINANCIAL_COLUMN_MAP = {
  umsatz: "Umsatz EUR",
  umsatzCagr: "Umsatz CAGR %",
  gewinn: "Gewinn EUR",
  gewinnCagr: "Gewinn CAGR %",
  mitarbeiterzahl: "Mitarbeiterzahl",
};

function buildHeaderIndex(headerRow) {
  const index = {};
  headerRow.forEach((name, i) => {
    index[name.trim()] = i;
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

    const rec = { source: "northdata" };
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
    rec.financials = hasFinancials ? financials : null;

    records.push(rec);
  }
  return records;
}
