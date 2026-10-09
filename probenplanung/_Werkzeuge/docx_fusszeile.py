#!/usr/bin/env python3
"""Fuegt einem fertigen .docx eine Fusszeile mit Seitenzahl hinzu.

    python3 docx_fusszeile.py datei.docx "Kurztitel links"

Links der Kurztitel, rechts "Seite n / N" als echte Word-Felder (PAGE/NUMPAGES),
die Word beim Oeffnen und Drucken selbst aktualisiert. Idempotent.
"""
import os, re, shutil, sys, zipfile
from xml.dom import minidom

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NAME = "footer90.xml"
RID = "rIdFusszeile90"
FONT, SIZE, COLOR = "Consolas", "14", "7A8090"

def rpr():
    return ('<w:rPr><w:rFonts w:ascii="%s" w:hAnsi="%s"/><w:sz w:val="%s"/>'
            '<w:color w:val="%s"/></w:rPr>' % (FONT, FONT, SIZE, COLOR))

def feld(name):
    return ('<w:r>%s<w:fldChar w:fldCharType="begin"/></w:r>'
            '<w:r>%s<w:instrText xml:space="preserve"> %s </w:instrText></w:r>'
            '<w:r>%s<w:fldChar w:fldCharType="separate"/></w:r>'
            '<w:r>%s<w:t>1</w:t></w:r>'
            '<w:r>%s<w:fldChar w:fldCharType="end"/></w:r>'
            % (rpr(), rpr(), name, rpr(), rpr(), rpr()))

def footer_xml(titel):
    titel = titel.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<w:ftr xmlns:w="%s" xmlns:r="%s"><w:p>'
        '<w:pPr><w:tabs><w:tab w:val="right" w:pos="9638"/></w:tabs>%s</w:pPr>'
        '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>'
        '<w:r>%s<w:tab/><w:t xml:space="preserve">Seite </w:t></w:r>'
        '%s'
        '<w:r>%s<w:t xml:space="preserve"> / </w:t></w:r>'
        '%s'
        '</w:p></w:ftr>' % (W, R, rpr(), rpr(), titel, rpr(),
                            feld("PAGE"), rpr(), feld("NUMPAGES")))

def fusszeile(path, titel):
    with zipfile.ZipFile(path) as z:
        teile = {n: z.read(n) for n in z.namelist()}
        order = list(z.namelist())

    doc = teile["word/document.xml"].decode("utf-8")
    if "footerReference" in doc or NAME in teile:
        print("hat schon eine Fusszeile, uebersprungen:", path)
        return

    # 1. Fusszeilen-Teil
    teile["word/" + NAME] = footer_xml(titel).encode("utf-8")

    # 2. Beziehung
    rels = teile["word/_rels/document.xml.rels"].decode("utf-8")
    rels = rels.replace("</Relationships>",
        '<Relationship Id="%s" Type="%s/footer" Target="%s"/></Relationships>'
        % (RID, R, NAME))
    teile["word/_rels/document.xml.rels"] = rels.encode("utf-8")

    # 3. Inhaltstyp
    ct = teile["[Content_Types].xml"].decode("utf-8")
    ct = ct.replace("</Types>",
        '<Override PartName="/word/%s" ContentType="application/vnd.openxml'
        'formats-officedocument.wordprocessingml.footer+xml"/></Types>' % NAME)
    teile["[Content_Types].xml"] = ct.encode("utf-8")

    # 4. Verweis als ERSTES Kind der letzten sectPr (Schema-Reihenfolge!)
    i = doc.rfind("<w:sectPr")
    if i < 0:
        sys.exit("kein <w:sectPr> gefunden: " + path)
    j = doc.index(">", i) + 1
    doc = doc[:j] + '<w:footerReference w:type="default" r:id="%s"/>' % RID + doc[j:]
    teile["word/document.xml"] = doc.encode("utf-8")

    # 5. pruefen, dass alles wohlgeformt bleibt
    for n in ("word/document.xml", "word/" + NAME,
              "word/_rels/document.xml.rels", "[Content_Types].xml"):
        minidom.parseString(teile[n])

    tmp = path + ".tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for n in order + ["word/" + NAME]:
            z.writestr(n, teile[n])
    os.replace(tmp, path)
    print("Fusszeile eingefuegt:", path)

if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    fusszeile(sys.argv[1], sys.argv[2])
