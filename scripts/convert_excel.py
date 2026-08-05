#!/usr/bin/env python3
"""Wandelt die Adressliste aus "Jubilare_BdSt.xlsx" (Tabelle "Tabelle1") in die
JSON/JS-Datendateien um, die die Tourenplaner-App verwendet.

Verwendung:
    python3 scripts/convert_excel.py /pfad/zu/Jubilare_BdSt.xlsx

Erzeugt data/adressen.json und data/adressen.js im Projektverzeichnis. Bei einer
aktualisierten Excel-Datei dieses Skript erneut ausfuehren und die neuen Dateien
committen.
"""
import json
import re
import sys
from pathlib import Path

import openpyxl

SHEET_NAME = "Tabelle1"
REPO_ROOT = Path(__file__).resolve().parent.parent


def clean(value):
    if value is None:
        return ""
    s = str(value).strip()
    if s in ("–", "-", "—"):  # –, -, —
        return ""
    return s.replace("\xa0", " ").replace("\n", " ").strip()


def convert(xlsx_path: Path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb[SHEET_NAME]
    rows = list(ws.iter_rows(values_only=True))
    data = rows[1:]  # erste Zeile = Kopfzeile

    out = []
    idx = 0
    for r in data:
        r = list(r) + [None] * (9 - len(r))
        unternehmen, plz, ort, strasse, inhaber, telefon, email, website = (
            clean(r[0]), clean(r[1]), clean(r[2]), clean(r[3]),
            clean(r[4]), clean(r[5]), clean(r[6]), clean(r[7]),
        )

        if not unternehmen and not ort:
            continue

        if plz:
            plz = re.sub(r"\D", "", plz)

        has_address = bool(ort) and (bool(strasse) or bool(plz))
        query_parts = []
        if strasse:
            query_parts.append(strasse)
        if plz or ort:
            query_parts.append((plz + " " + ort).strip())
        query_parts.append("Deutschland")
        query = ", ".join(p for p in query_parts if p)

        idx += 1
        out.append({
            "id": idx,
            "unternehmen": unternehmen,
            "plz": plz,
            "ort": ort,
            "strasse": strasse,
            "inhaber": inhaber,
            "telefon": telefon,
            "email": email,
            "website": website,
            "geocodeQuery": query if has_address else "",
            "hasAddress": has_address,
        })
    return out


def main():
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(1)
    xlsx_path = Path(sys.argv[1])
    records = convert(xlsx_path)

    data_dir = REPO_ROOT / "data"
    data_dir.mkdir(exist_ok=True)

    json_path = data_dir / "adressen.json"
    with json_path.open("w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    js_path = data_dir / "adressen.js"
    with js_path.open("w", encoding="utf-8") as f:
        f.write("// Generiert aus " + xlsx_path.name + " (" + SHEET_NAME + ") mit\n")
        f.write("// scripts/convert_excel.py. Nicht manuell bearbeiten.\n")
        f.write("window.ADDRESS_DATA = ")
        json.dump(records, f, ensure_ascii=False)
        f.write(";\n")

    cities = sorted(set(r["ort"] for r in records if r["ort"]))
    without_address = sum(1 for r in records if not r["hasAddress"])
    print(f"{len(records)} Adressen aus {xlsx_path.name} verarbeitet.")
    print(f"{len(cities)} Orte erkannt, {without_address} Adressen ohne Strasse/PLZ.")
    print(f"Geschrieben: {json_path}")
    print(f"Geschrieben: {js_path}")


if __name__ == "__main__":
    main()
