// Dublettenpruefung: jede Firma nur einmal.
//
// Aus Firmenname, PLZ/Ort, Telefon und Registernummer (HR Amtsgericht +
// Register-ID aus North Data) werden normalisierte Schluessel gebildet.
// Reine Funktionen ohne Firestore - so laesst sich die Logik auch ohne
// Browser testen.
//
// Treffer-Stufen:
// - "sure"   (sicher):  gleiche Registernummer, ODER gleiche Telefonnummer,
//                       ODER gleicher Name + gleiche PLZ, ODER gleicher
//                       Name + gleicher Ort.
// - "maybe"  (bitte pruefen): gleicher Name, aber anderer Ort/PLZ; oder
//                       ein Name steckt im anderen (z. B. "Mueller Bau" /
//                       "Mueller Bau Verwaltung") bei gleicher PLZ bzw.
//                       gleichem Ort.
// Ausnahme: Haben BEIDE eine Registernummer und die ist verschieden, sind
// es sicher zwei Firmen (z. B. "X GmbH & Co. KG" und "X Verwaltungs-GmbH"
// mit gleicher Telefonnummer) - dann hoechstens "maybe".

// Rechtsformen, die beim Namensvergleich wegfallen (laengere zuerst).
const LEGAL_FORMS = [
  "gmbh & co. kgaa",
  "gmbh & co. kg",
  "gmbh & co kg",
  "gmbh u. co. kg",
  "gmbh und co. kg",
  "gmbh und co kg",
  "ug & co. kg",
  "ug (haftungsbeschraenkt) & co. kg",
  "ug (haftungsbeschraenkt)",
  "ug haftungsbeschraenkt",
  "ag & co. kg",
  "se & co. kg",
  "mbh & co. kg",
  "e. k.",
  "e.k.",
  "e.kfm.",
  "e. kfm.",
  "e.kfr.",
  "e. kfr.",
  "e.v.",
  "e. v.",
  "e.g.",
  "eg",
  "gmbh",
  "ggmbh",
  "mbh",
  "kgaa",
  "kg",
  "ohg",
  "gbr",
  "partg mbb",
  "partgmbb",
  "partg",
  "ag",
  "se",
  "ug",
  "ltd.",
  "ltd",
  "inh.",
];

export function foldUmlauts(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LEGAL_FORM_RES = LEGAL_FORMS.map(
  (f) => new RegExp("(^|[\\s,.&+-])" + escapeRegExp(f) + "(?=$|[\\s,.&+-])", "g")
);

// "Erwin Polz GmbH & Co. KG" -> "erwinpolz"
export function normalizeName(name) {
  let s = " " + foldUmlauts(name) + " ";
  s = s.replace(/\s+/g, " ");
  for (const re of LEGAL_FORM_RES) s = s.replace(re, " ");
  return s.replace(/[^a-z0-9]/g, "");
}

export function normalizePlz(plz) {
  const digits = String(plz || "").replace(/\D/g, "");
  return digits.length === 5 ? digits : "";
}

export function normalizeOrt(ort) {
  // "München-Pasing" / "München (Bayern)" -> "muenchen"
  const base = foldUmlauts(ort).split(/[(\-/,]/)[0];
  return base.replace(/[^a-z0-9]/g, "");
}

// "+49 (89) 260 46-85" / "0049 89 2604685" / "089/2604685" -> "0892604685"
export function normalizePhone(tel) {
  let d = String(tel || "").replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = "00" + d.slice(1);
  if (d.startsWith("0049")) d = "0" + d.slice(4);
  else if (d.startsWith("49") && d.length >= 11) d = "0" + d.slice(2);
  d = d.replace(/\D/g, "");
  return d.length >= 6 ? d : "";
}

// Registernummer aus HR Amtsgericht ("München", "Amtsgericht München",
// "AG Charlottenburg (Berlin)") + Register-ID ("HRB 123456", "HRA 9876 B")
// -> "muenchen|hrb123456"
export function normalizeRegister(court, registerId) {
  const id = foldUmlauts(registerId).replace(/[^a-z0-9]/g, "");
  if (!id || !/\d/.test(id)) return "";
  const c = foldUmlauts(court)
    .replace(/amtsgericht|registergericht/g, "")
    .replace(/^\s*ag\s+/, "")
    .split("(")[0]
    .replace(/[^a-z0-9]/g, "");
  return (c ? c + "|" : "") + id;
}

// Anzeigeform, z. B. "HRB 123456, AG München"
export function formatRegister(court, registerId) {
  const id = String(registerId || "").trim();
  if (!id) return "";
  const c = String(court || "").trim();
  return c ? id + ", AG " + c.replace(/^(Amtsgericht|AG)\s+/i, "") : id;
}

// Alle Merkmale einer Firma (bzw. eines Import-Datensatzes) auf einmal.
export function firmSignature(f) {
  return {
    name: normalizeName(f.unternehmen),
    plz: normalizePlz(f.plz),
    ort: normalizeOrt(f.ort),
    tel: normalizePhone(f.telefon),
    reg: f.registerKey || normalizeRegister(f.registerGericht, f.registerId),
  };
}

// Schluessel fuer die sicheren Treffer (werden auch am Firmendokument als
// "dedupKeys" gespeichert).
export function buildDedupKeys(f) {
  const s = firmSignature(f);
  const keys = [];
  if (s.reg) keys.push("reg:" + s.reg);
  if (s.tel) keys.push("tel:" + s.tel);
  if (s.name && s.plz) keys.push("name:" + s.name + "|" + s.plz);
  if (s.name && s.ort) keys.push("nameort:" + s.name + "|" + s.ort);
  return keys;
}

// Index ueber eine Liste vorhandener Firmen: Schluessel -> [Firma, ...]
export function buildIndex(firms) {
  const byKey = new Map();
  const byName = new Map();
  const sigById = new Map();
  for (const f of firms) {
    const sig = firmSignature(f);
    sigById.set(f.id, sig);
    for (const k of buildDedupKeys(f)) {
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(f);
    }
    if (sig.name) {
      if (!byName.has(sig.name)) byName.set(sig.name, []);
      byName.get(sig.name).push(f);
    }
  }
  return { firms, byKey, byName, sigById };
}

// Index um eine (neu angelegte) Firma ergaenzen, z. B. waehrend eines
// Imports, damit doppelte Zeilen in derselben Datei erkannt werden.
export function addToIndex(index, firm) {
  index.firms.push(firm);
  const sig = firmSignature(firm);
  index.sigById.set(firm.id, sig);
  for (const k of buildDedupKeys(firm)) {
    if (!index.byKey.has(k)) index.byKey.set(k, []);
    index.byKey.get(k).push(firm);
  }
  if (sig.name) {
    if (!index.byName.has(sig.name)) index.byName.set(sig.name, []);
    index.byName.get(sig.name).push(firm);
  }
}

function registersConflict(a, b) {
  return Boolean(a.reg && b.reg && a.reg !== b.reg);
}

const REASON_LABELS = {
  reg: "gleiche Registernummer",
  tel: "gleiche Telefonnummer",
  name: "gleicher Name und gleiche PLZ",
  nameort: "gleicher Name und gleicher Ort",
};

// Sucht zu einem Datensatz passende vorhandene Firmen.
// Ergebnis: { level: "none" | "sure" | "maybe", sure: [{firm, reasons}], maybe: [{firm, reasons}] }
export function findMatches(record, index, { excludeIds = [] } = {}) {
  const sig = firmSignature(record);
  const sure = new Map();
  const maybe = new Map();
  const exclude = new Set(excludeIds);
  if (record.id) exclude.add(record.id);

  const add = (map, firm, reason) => {
    if (exclude.has(firm.id)) return;
    if (!map.has(firm.id)) map.set(firm.id, { firm, reasons: [] });
    const entry = map.get(firm.id);
    if (!entry.reasons.includes(reason)) entry.reasons.push(reason);
  };

  for (const k of buildDedupKeys(record)) {
    const type = k.slice(0, k.indexOf(":"));
    for (const firm of index.byKey.get(k) || []) {
      const other = index.sigById.get(firm.id) || firmSignature(firm);
      if (type !== "reg" && registersConflict(sig, other)) {
        add(maybe, firm, REASON_LABELS[type] + ", aber andere Registernummer");
      } else {
        add(sure, firm, REASON_LABELS[type]);
      }
    }
  }

  if (sig.name) {
    // Gleicher Name, anderer Ort
    for (const firm of index.byName.get(sig.name) || []) {
      if (!sure.has(firm.id)) add(maybe, firm, "gleicher Name, anderer Ort");
    }
    // Ein Name steckt im anderen, gleiche PLZ bzw. gleicher Ort
    if (sig.name.length >= 5) {
      for (const firm of index.firms) {
        if (sure.has(firm.id) || exclude.has(firm.id)) continue;
        const other = index.sigById.get(firm.id) || firmSignature(firm);
        if (!other.name || other.name === sig.name || other.name.length < 5) continue;
        const samePlace = (sig.plz && sig.plz === other.plz) || (sig.ort && sig.ort === other.ort);
        if (!samePlace) continue;
        if (other.name.includes(sig.name) || sig.name.includes(other.name)) {
          add(maybe, firm, "ähnlicher Name am selben Ort");
        }
      }
    }
  }

  for (const id of sure.keys()) maybe.delete(id);
  const sureList = Array.from(sure.values());
  const maybeList = Array.from(maybe.values());
  return {
    level: sureList.length ? "sure" : maybeList.length ? "maybe" : "none",
    sure: sureList,
    maybe: maybeList,
  };
}

// Felder, die beim "Ergaenzen" einer vorhandenen Firma aus einem neuen
// Datensatz uebernommen werden - aber nur, wenn sie dort noch leer sind.
export const FILLABLE_FIELDS = [
  "strasse",
  "plz",
  "ort",
  "inhaber",
  "vertreter1",
  "vertreter2",
  "vertreter3",
  "telefon",
  "email",
  "website",
  "rechtsform",
  "registerGericht",
  "registerId",
  "registerNr",
  "branche",
  "northDataUrl",
  "gegenstand",
  "northDataStatus",
  "ustId",
  "fax",
];

// Liefert nur die Felder, die an der vorhandenen Firma leer sind und im
// neuen Datensatz einen Wert haben. Vorhandenes wird nie ueberschrieben.
export function fillEmptyFields(existing, incoming) {
  const update = {};
  for (const f of FILLABLE_FIELDS) {
    const have = existing[f];
    const val = incoming[f];
    if ((have === undefined || have === null || String(have).trim() === "") && val !== undefined && val !== null && String(val).trim() !== "") {
      update[f] = val;
    }
  }
  return update;
}

// Gruppen sicherer Dubletten innerhalb einer Firmenliste (fuer das
// Werkzeug "Dubletten zusammenfuehren"). Firmen mit gesetztem
// notDuplicateWith werden fuer das jeweilige Paar nicht zusammengefasst.
export function findDuplicateGroups(firms) {
  const index = buildIndex(firms);
  const parent = new Map(firms.map((f) => [f.id, f.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const reasonsByPair = new Map();
  for (const f of firms) {
    const m = findMatches(f, index);
    for (const { firm, reasons } of m.sure) {
      const ignored =
        (f.notDuplicateWith || []).includes(firm.id) || (firm.notDuplicateWith || []).includes(f.id);
      if (ignored) continue;
      parent.set(find(f.id), find(firm.id));
      const key = [f.id, firm.id].sort().join("|");
      reasonsByPair.set(key, reasons);
    }
  }
  const groups = new Map();
  for (const f of firms) {
    const root = find(f.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(f);
  }
  return Array.from(groups.values())
    .filter((g) => g.length > 1)
    .map((g) => {
      const reasons = new Set();
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) {
          (reasonsByPair.get([g[i].id, g[j].id].sort().join("|")) || []).forEach((r) => reasons.add(r));
        }
      }
      return { firms: g, reasons: Array.from(reasons) };
    });
}
