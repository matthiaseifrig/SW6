#!/usr/bin/env python3
"""Stempelt eine Fusszeile mit Seitenzahl in ein fertiges PDF.

    python3 paginate.py datei.pdf "Kurztitel links"

Links der Kurztitel, rechts "Seite n / N". Schreibt die Datei an Ort und Stelle.
Idempotent: ein bereits gestempeltes PDF wird erkannt und nicht doppelt bestempelt.
"""
import os, sys, pymupdf

MARK = "/claude-paginated"          # Merker im PDF-Metadatenfeld "keywords"
SIZE = 7.5
GREY = (0.42, 0.42, 0.45)
EDGE = 36.0                        # Abstand vom Rand in Punkt (= 12,7 mm)
BASE = 22.0                        # Abstand der Grundlinie vom unteren Rand

def paginate(path, titel):
    doc = pymupdf.open(path)
    kw = (doc.metadata or {}).get("keywords") or ""
    if MARK in kw:
        print("schon nummeriert, übersprungen:", path)
        doc.close()
        return 0
    n = doc.page_count
    for i, page in enumerate(doc, start=1):
        r = page.rect
        y = r.height - BASE
        page.insert_text((EDGE, y), titel, fontname="helv", fontsize=SIZE, color=GREY)
        rechts = "Seite %d / %d" % (i, n)
        w = pymupdf.get_text_length(rechts, fontname="helv", fontsize=SIZE)
        page.insert_text((r.width - EDGE - w, y), rechts,
                         fontname="helv", fontsize=SIZE, color=GREY)
    doc.set_metadata({**(doc.metadata or {}), "keywords": (kw + " " + MARK).strip()})
    tmp = path + ".tmp"
    doc.save(tmp, deflate=True, garbage=3)
    doc.close()
    os.replace(tmp, path)
    print("nummeriert: %s (%d Seiten)" % (path, n))
    return n

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    paginate(sys.argv[1], sys.argv[2])
