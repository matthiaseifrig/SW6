# Landing-Page-Website

Statische Website mit einer eigenen Landing Page pro Thema. Kein Build-Schritt,
keine externen Bibliotheken, kein CDN – nur HTML, CSS und ein paar Zeilen
JavaScript. Damit läuft sie unverändert über GitHub Pages (der Workflow
`.github/workflows/deploy-pages.yml` veröffentlicht das gesamte Repo), über
Netlify oder über jeden beliebigen Webspace.

## Aufbau

```
website/
├── index.html                        Übersicht aller Landing Pages
├── mensch-hund-rundum-gesund/
│   └── index.html                    Landing Page „Mensch & Hund – rundum gesund“
├── _vorlage-landingpage.html         Kopiervorlage für weitere Seiten
├── assets/
│   ├── css/site.css                  gemeinsames Stylesheet (Design-Tokens, Komponenten)
│   └── js/site.js                    mobiles Menü, Sticky-Header, Einblenden beim Scrollen
└── README.md
```

Aufgerufen wird die Website unter `…/website/` (Übersicht) bzw.
`…/website/mensch-hund-rundum-gesund/` (erste Landing Page).

Lokal ansehen:

```bash
python3 -m http.server 8080
# dann http://localhost:8080/website/ öffnen
```

## Landing Page „Mensch & Hund – rundum gesund“

Aufbau der Seite von oben nach unten:

1. **Hero** – Headline, Subline, zwei Handlungsaufforderungen, drei Vertrauenspunkte
2. **Kennst du das?** – die Ausgangssituation in drei Karten
3. **Der Ansatz** – worum es inhaltlich geht
4. **Die Themen** – sechs Inhaltsblöcke
5. **Für wen** – passt / passt eher nicht
6. **Ablauf** – vier Schritte bis zur Teilnahme
7. **Über mich**
8. **FAQ** – aufklappbare Fragen
9. **Abschluss-CTA** – letzter Weg zur Buchung
10. **Fußzeile**

**Alle Buttons und CTAs verlinken auf die Buchungsseite:**
<https://alfima.com/manuelag16/mensch-hund-rundum-gesund>

Zusätzlich verlinkt die Seite an zwei Stellen (Über mich, Abschluss-CTA und
Fußzeile) auf die Original-Angebotsseite:
<https://alfima.com/manuelag16/p/mensch-hund-rundum-gesund>

### Noch einzusetzen: die Originaltexte

Der Inhalt der alfima-Angebotsseite konnte aus dieser Arbeitsumgebung nicht
abgerufen werden (`alfima.com` ist durch die Netzwerk-Richtlinie der Session
gesperrt). Die Seite ist deshalb inhaltlich mit sinngemäßen Texten zum Thema
aufgebaut – **bewusst ohne erfundene Preise, Termine, Dauer, Orte, Qualifikationen
oder Teilnehmerstimmen**. Solche Angaben verweisen stattdessen auf die
Buchungsseite.

Die Stellen, an denen der Originaltext eingesetzt gehört, sind im HTML mit
Kommentaren markiert:

```bash
grep -n "INHALT:" website/mensch-hund-rundum-gesund/index.html
```

Konkret:

| Stelle | Was ersetzt werden sollte |
| --- | --- |
| Hero (`<h1>` + `.hero__lead`) | Original-Headline und -Subline |
| Abschnitt „Der Ansatz“ | Beschreibungstext des Angebots |
| Abschnitt „Die Themen“ | die tatsächlichen Programmpunkte/Module |
| Abschnitt „Über mich“ | Vorstellungstext und Qualifikationen |
| FAQ | echte Angaben zu Preis, Dauer, Ort, Terminen |
| Fußzeile | Links zu Impressum und Datenschutz |

Ebenfalls Platzhalter: die Grafiken. Der Hero und der „Über mich“-Block nutzen
eigene SVG-Illustrationen, damit kein fremdes Bildmaterial nötig ist. Sobald
eigene Fotos vorliegen, kann `.hero__art` bzw. `.about__portrait` durch ein
`<img>` ersetzt werden.

## Weitere Landing Page anlegen

1. Ordner anlegen, z. B. `website/mein-thema/`
2. `_vorlage-landingpage.html` dorthin als `index.html` kopieren
3. Alle mit `TODO` markierten Stellen ersetzen
4. Die neue Seite in `website/index.html` verlinken – dort stehen bereits zwei
   Platzhalterkarten („In Vorbereitung“) bereit

Das Stylesheet muss dafür nicht angefasst werden: Farben, Abstände, Buttons,
Karten, Schritte, FAQ und Fußzeile sind als wiederverwendbare Komponenten
angelegt. Die Farbpalette steht als CSS-Variablen ganz oben in
`assets/css/site.css`.

## Technische Eckpunkte

- Responsiv ab ca. 320 px Breite; Navigation klappt unter 880 px zum Burger-Menü
- Tastaturbedienbar inkl. „Zum Inhalt springen“-Link und sichtbarem Fokus
- `prefers-reduced-motion` wird respektiert (keine Einblend-Animationen)
- Druck-Stylesheet blendet Navigation und Fußzeile aus
- Keine Tracker, keine Cookies, keine externen Requests – die einzigen
  ausgehenden Links zeigen auf alfima.com
