# G.B.V.M. GmbH – Kunden & Termine (CRM mit Tourenplanung)

Nach dem Anmelden erscheint eine **Startseite mit Kacheln** (Firma suchen,
Neue Firma, Tour planen, Zahlen, Kundenliste drucken; für Admins zusätzlich
Import & Dubletten und Benutzer; „Anrufen“ und „Meine Termine“ folgen). Jede
Kachel öffnet einen eigenen Bildschirm mit „← Startseite“ oben links; die
Browser-Zurück-Taste funktioniert ebenfalls. Gestaltung nach dem G.B.V.M.
Markenkit (Nachtblau, Gold als Akzent, Montserrat – lokal eingebunden unter
`vendor/fonts/`, keine Verbindung zu Google Fonts).

**Kacheln je Funktion** (Bereich „Benutzer“): Pre-Sales sieht Anrufen,
Firma suchen, Neue Firma und Meine Zahlen; Werber/Makler zusätzlich Tour und
Kundenliste drucken; der Admin alles.

**Anrufen (Pre-Sales, fürs Handy):** Reiter „Wiedervorlagen“ (Rückrufe nach
Datum, Überfälliges rot, mit Sprung in die Firma) und „Neue Firmen“ (eigener
Adresspool nach PLZ/Ort, nur noch nicht angerufene). Eine Firma pro
Bildschirm mit Hinweisen (schon angerufen von wem/wann, Mitglied, offener
Termin, nicht mehr anrufen), großem Wählknopf und den Ergebnissen Nicht
erreicht / Später nochmal / Kein Interesse / Termin vereinbart (Worum, für
wen, wann). Gespeichert wird in den Sammlungen `calls` und `appointments`.
Der **Adresspool** einer Person sind die Firmen, die ihr gehören
(`ownerUid`) **oder** in deren Pool sie aufgenommen ist (`poolUids`). Eine
Firma gibt es nur einmal, sie kann aber in mehreren Pools liegen (z. B. bei
Pre-Sales und beim Werber); alle Eintragungen (Anrufe, Termine, Besuche)
hängen an der einen Firma und sind für alle sichtbar. Beim CSV-Import für eine
Person werden schon vorhandene Firmen ergänzt und zusätzlich in deren Pool
aufgenommen; unter „Import & Dubletten → Adresspool zuweisen“ lassen sich
vorhandene Firmen nach PLZ/Ort in einen Pool aufnehmen. **Meine Zahlen** zeigt Anrufe, erreicht, Termine,
durchgeführt, Quoten und die Kennzahl (50 € je durchgeführtem Termin).

**Meine Termine (Werber/Makler):** „Bitte Ergebnis eintragen“ (vergangene,
noch offene Termine), Heute, Demnächst, Erledigt. Pro Termin: Anrufen, Route,
Firma öffnen und **Durchgeführt / Verschoben / Abgesagt**. Werber: Mitglied
gewonnen? und ggf. direkt einen Makler-Termin vereinbaren (Kennzahl 150 €
Mitglied, 200 € Mitglied + Makler-Termin, 112,50 € nur Makler-Termin). Makler:
Abschluss? und Sparte (bAV, PKV, Immobilie, Geldanlage, Sonstiges). Abgesagt
oder nicht angetroffen → Wiedervorlage in einer Woche bei der Person, die den
Termin vereinbart hat; „von uns abgesagt“ zählt nicht gegen Pre-Sales.

**Kette an der Firma – wer hat was gemacht:** Auf der Firmen-Seite zeigt
„Verlauf“ die Stationen ① Pre-Sales (Anrufe, terminiert von …, für …),
② BdSt-Werber (Termin und Aufnahme durch …), ③ Makler (Termin nach Aufnahme
vereinbart von … für …, Abschluss/Sparte), darunter alle Einträge. In Suche und
Listen stehen dieselben Angaben als Plaketten („Terminiert: …“, „Aufnahme: …“,
„Makler-Termin: … → …“, „Kunde · Sparte“).

# Tourenplaner – Jubilare BdSt

Web-App zur Tourenplanung mit eigenem Kundenstamm pro Nutzer: Login,
Kunden anlegen, Besuche mit Notiz eintragen, und pro Ort eine nach
tatsächlicher Fahrzeit optimierte Route mit Karte und Google-Maps-Link.

Ursprünglich aus `Jubilare_BdSt.xlsx` (Tabelle „Tabelle1“, 215 Adressen)
befüllt, seitdem als kleines Mini-CRM ausgebaut.

Du wählst einen Ort aus (z. B. „Landshut“ oder „München“) und bekommst eine
optimierte Reihenfolge, in der du alle *eigenen* Adressen in diesem Ort
abfahren kannst. Der Startpunkt ist frei wählbar: eine beliebige Adresse aus
der Liste, dein aktueller GPS-Standort, oder du überlässt die Wahl der App.

## Zugänge, Rollen & Daten (Firebase)

Login und alle Kunden-/Besuchsdaten laufen über ein Firebase-Projekt
(Authentication + Firestore, kostenloser Spark-Tarif):

- Jede Person (Chef wie Kollegen) hat einen eigenen Zugang
  (E-Mail/Passwort), angelegt in der Firebase-Konsole unter
  **Authentication → Nutzer → Nutzer hinzufügen**. Es gibt keine
  Selbstregistrierung in der App.
- Standardmäßig bekommt jeder neue Nutzer die Rolle **„colleague“** und sieht
  **nur die eigenen bzw. ihm zugeordneten Firmen** (Besitzer `ownerUid` oder
  Adresspool `poolUids`) samt deren Anrufen, Terminen und Besuchen – von den
  Firestore-Regeln erzwungen. Nur der Admin („owner“) sieht alle Firmen
  (Schalter „Alle Firmen anzeigen“).
- **Drucken und Export nur für den Admin:** Kundenliste drucken und
  „Drucken / PDF“ gibt es nur für „owner“; druckt ein Kollege über den
  Browser, erscheint nur ein Hinweis statt der Daten. (Abschreiben oder
  Bildschirmfotos lassen sich technisch nicht verhindern.)
- **Dublettenschutz über alle Firmen:** Damit niemand eine Firma doppelt
  anlegt, die er selbst nicht sieht, gibt es je Firma Prüfschlüssel
  (`firmKeys`: Registernummer, Telefon, Name + PLZ, Name + Ort). Kolleg:innen
  können nur gezielt prüfen, nicht auflisten. Gleicher Name + PLZ/Ort oder
  gleiche Registernummer → nicht anlegen; nur gleiche Telefonnummer → Hinweis.
  Nach dem Update einmal unter „Import & Dubletten → Dublettenschutz und
  Zuordnungen aktualisieren“ ausführen.
- Wer einen Termin vereinbart bekommt, wird automatisch in den Pool der Firma
  aufgenommen (sonst könnte er sie nicht sehen).
- **Funktionen** (Pre-Sales, BdSt-Werber, Makler – auch mehrere) und den
  Anzeigenamen setzt „owner“ direkt in der App im Bereich **„Benutzer“**. Eine
  Person erscheint dort, sobald sie sich einmal angemeldet hat.
- Eine Person mit der Rolle **„owner“** sieht im Dashboard bei „Alle Firmen
  anzeigen“ die Gesamtzahlen aller, darf Firmen löschen, importieren und
  Benutzer verwalten.
  Die Rolle wird **einmalig manuell** gesetzt: Firebase-Konsole →
  **Firestore Database → Daten** → Sammlung `users` → das Dokument mit der
  eigenen User-ID öffnen → Feld `role` von `colleague` auf `owner` ändern.
  (Das Dokument entsteht automatisch beim ersten Login; vorher ist es noch
  nicht da.)
- Beim ersten Login einer neuen Person ist die eigene Kundenliste leer – über
  den Button „Excel-Liste importieren“ lässt sich einmalig die ursprüngliche
  215-Adressen-Liste übernehmen (sinnvoll für die erste/Haupt-Person; jede
  weitere Person legt neue Kunden i. d. R. selbst über „Kunde hinzufügen“ an).
- **Sicherheitsregeln**: Die Datei `firestore.rules` in diesem Repo enthält
  den Regeltext, der in der Firebase-Konsole unter **Firestore Database →
  Regeln** eingefügt und veröffentlicht werden muss, damit jeder Nutzer nur
  die eigenen Daten sieht (bzw. „owner“ alle).
- **Finanzkennzahlen für einzelne Kolleg:innen freigeben**: Umsatz, Gewinn,
  Mitarbeiterzahl und Pensionsrückstellungen sind standardmäßig nur für
  „owner“ sichtbar. Um sie zusätzlich für eine bestimmte Person freizugeben
  (z. B. Peter Günther), genauso wie die Rolle **einmalig manuell**: Firebase-
  Konsole → **Firestore Database → Daten** → Sammlung `users` → deren
  Dokument öffnen → Feld `financialsAccess` (Typ boolean) hinzufügen und auf
  `true` setzen. Die Person sieht damit die Kennzahlen nur für ihre eigenen
  Kunden, nie für die anderer Kolleg:innen. Bearbeiten (z. B.
  Pensionsrückstellungen setzen) bleibt weiterhin „owner“ vorbehalten.

## Nutzung

1. Repo lokal öffnen und einen einfachen Webserver im Projektordner starten
   (nötig, da manche Browser `fetch`/ES-Module bei `file://` einschränken):
   ```bash
   npx http-server -p 8080 .
   # oder: python3 -m http.server 8080
   ```
2. Im Browser `http://localhost:8080` öffnen und mit E-Mail/Passwort anmelden.
3. Ort auswählen, Startpunkt festlegen, „Route berechnen“ klicken.

Alternativ lässt sich der Ordner unverändert z. B. über **GitHub Pages**
veröffentlichen (Settings → Pages → Branch auswählen) – die App ist rein
statisch (HTML/CSS/JS), es gibt keinen eigenen Server-Anteil (nur Firebase
als Backend-Dienst).

## Wie die Route berechnet wird

1. **Geokodierung**: Straße/PLZ/Ort jeder Adresse im gewählten Ort werden über
   [OpenStreetMap Nominatim](https://nominatim.org/) in Koordinaten
   umgewandelt. Ergebnisse werden im `localStorage` des Browsers
   gecacht – jede Adresse muss also nur einmal geokodiert werden, danach ist
   es sofort verfügbar (auch offline aus dem Cache).
   Nominatim erlaubt maximal 1 Anfrage/Sekunde, die App hält dieses Limit ein
   und zeigt dabei einen Fortschrittsbalken (bei größeren Orten wie München
   mit ~60 Adressen dauert der *erste* Durchlauf entsprechend gut eine
   Minute).
2. **Fahrzeit-Matrix**: Die Fahrzeiten/-strecken zwischen allen Adressen des
   gewählten Orts werden über die öffentliche
   [OSRM-Demo-Instanz](http://project-osrm.org/) (`router.project-osrm.org`)
   abgefragt.
3. **Routenoptimierung**: Eine Nearest-Neighbour-Heuristik mit anschließender
   2-opt-Verbesserung berechnet die kürzeste Reihenfolge (klassisches
   Traveling-Salesman-Problem, hier mit frei wählbarem oder festem
   Startpunkt und optionaler Rückkehr zum Start).
4. Die berechnete Route wird auf einer Karte (Leaflet + OpenStreetMap-Kacheln)
   angezeigt, als Liste mit Distanz/Zeit pro Etappe, und als Link(s) zum
   direkten Öffnen in Google Maps (Google begrenzt einen Routenlink auf 10
   Orte, längere Touren werden daher automatisch in mehrere aufeinander
   aufbauende Linkabschnitte aufgeteilt).

Adressen ohne hinterlegte Straße/PLZ (in der Quelldatei mit „–“ markiert)
oder die sich nicht geokodieren lassen, werden unterhalb der Route separat
aufgelistet statt in die Karte/Route einbezogen.

Einmal gefundene Koordinaten werden direkt am Kunden in Firestore gespeichert
(nicht nur lokal im Browser) – die Geokodierung passiert also für jede
Adresse nur einmal, egal wer sie zuerst berechnet.

## Kunden, Besuche & Notizen

- **Kunde suchen**: Suchfeld oben in der App, durchsucht Firmenname, Ort,
  Straße, PLZ sowie Ansprechpartner/gesetzliche Vertreter der eigenen (bzw.
  bei „owner“ + „Alle Firmen anzeigen“ aller) Kunden – unabhängig von der
  Ortsauswahl weiter unten. Ein Treffer lässt sich aufklappen und zeigt
  dieselben Details/Aktionen wie ein Stopp in der Route (Kontakt, Besuch
  bestätigen, Verlauf).
- **Kunde hinzufügen**: Formular oben in der App, landet sofort in der
  eigenen Kundenliste.
- **Besuch vom Kunden bestätigen lassen**: Bei jedem Stopp in der berechneten
  Route lässt sich „Besuch eintragen“ öffnen, optional mit einer privaten
  Notiz. Der eigentliche Besuch wird aber erst über „Vom Kunden bestätigen
  lassen“ eingetragen: Es öffnet sich eine große Bestätigungsseite, die dem
  Kunden auf dem Handy übergeben wird, der/die dann selbst mit einem Tap
  bestätigt. Damit ist sichergestellt, dass wirklich vor Ort bestätigt wurde
  – reine Selbstauskunft des Kollegen reicht nicht. Bereits besuchte
  Adressen werden in Liste und Karte farblich hervorgehoben (orange statt
  blau), „Verlauf anzeigen“ zeigt alle bisherigen Besuche mit Datum, Notiz
  und Person.
- **Tags**: feste Liste (`js/tags.js`): „Akquise“ (automatisch bei jedem
  neuen/importierten Kunden), „North Data“ (automatisch beim Kunden Import),
  „LinkedIn“, „Persönlicher Kontakt“. Bewusst keine Freitext-Tags, damit
  keine wild wachsende Sammlung entsteht. Weitere Tags aus der Liste lassen
  sich beim Anlegen direkt ankreuzen oder später jederzeit über „+ Tag“ an
  jedem Kunden hinzufügen/entfernen (mehrere Tags pro Kunde möglich).
- **Mitgliedschaft & Beratungstermin**: Direkt im Anschluss an eine vom
  Kunden bestätigte Besuchsbestätigung fragt die App (nur für den
  Mitarbeiter, nicht für den Kunden sichtbar) „BdSt-Mitgliedschaft
  abgeschlossen?“ und „Beratungstermin gewünscht?“ ab; bei „Ja“ zum
  Beratungstermin lassen sich Datum und Uhrzeit eintragen. Diese Angaben
  fließen direkt ins Dashboard ein.
- **Finanzkennzahlen (nur für „owner“)**: Wenn Kundendaten Finanzkennzahlen
  enthalten (aus dem Kunden Import, siehe unten), zeigt die Route für die
  Rolle „owner“ zusätzlich Umsatz, Gewinn (jeweils mit CAGR) und
  Mitarbeiterzahl an. Kollegen sehen diese Zahlen nie – weder in der App
  noch über die Datenbank (eigene, nur für „owner“ lesbare Firestore-
  Unter-Sammlung `financials`).

## Kunden Import (nur „owner“)

Unter „Kunden Import“ kann die Rolle „owner“ eine North-Data-CSV-Exportdatei
hochladen und im Namen einer bestimmten Person importieren:

1. Die Person muss sich vorher **einmal** selbst in der App angemeldet haben
   (Zugang wie gewohnt vorher in der Firebase-Konsole anlegen) – erst dann
   taucht sie in der Auswahlliste auf.
2. North-Data-CSV-Datei auswählen und **„Datei prüfen“** klicken. Die Datei
   darf als ANSI/Windows-1252 oder UTF-8 gespeichert sein – das wird
   automatisch erkannt.
3. Jede Zeile wird mit **allen** vorhandenen Firmen abgeglichen
   (Dublettenschutz, siehe unten). Die Vorschau zeigt „neu“, „schon
   vorhanden – werden ergänzt“ und „bitte prüfen“; unklare Fälle lassen sich
   einzeln entscheiden. Erst **„Import starten“** schreibt die Daten.
4. Übernommen werden: Firmenname, Rechtsform, Adresse, Registernummer
   (HR Amtsgericht + Register-ID), Branche, North-Data-Link, bis zu drei
   gesetzliche Vertreter, Telefon/E-Mail/Website. Umsatz, Gewinn, CAGR %,
   Mitarbeiterzahl, Bilanzsumme, Eigenkapital, Personalaufwand,
   **Pensionsrückstellungen (Betrag in EUR)** und der Stichtag landen in der
   gesperrten `financials`-Unter-Sammlung (owner + `financialsAccess` bei
   eigenen Firmen).

Ein **erneuter Import** derselben oder einer erweiterten Datei ist gefahrlos:
vorhandene Firmen werden nur ergänzt (leere Felder gefüllt, nie
überschrieben) und ihre Finanzkennzahlen aktualisiert – so kommen z. B. die
Pensionsrückstellungen auch bei schon importierten Firmen nachträglich dazu.

### Dublettenschutz

Eine Firma gilt als **sicher vorhanden** bei gleicher Registernummer, gleicher
Telefonnummer (nur Ziffern verglichen, +49 = 0) oder gleichem Firmennamen
(ohne Rechtsform, Umlaute vereinheitlicht) mit gleicher PLZ bzw. gleichem Ort.
Haben beide Firmen eine Registernummer und die ist verschieden, sind es
verschiedene Firmen (z. B. GmbH & Co. KG und Verwaltungs-GmbH) – dann wird nur
nachgefragt. **Bitte prüfen** heißt: gleicher Name an anderem Ort oder sehr
ähnlicher Name am selben Ort.

- **Kunde hinzufügen:** Schon beim Tippen erscheint ein Hinweis, wenn es die
  Firma gibt. Beim Speichern wird ein sicherer Treffer nicht neu angelegt,
  sondern kann ergänzt werden.
- **Dubletten zusammenführen** (im Bereich „Kunden Import“): findet bereits
  doppelt angelegte Firmen; Besuche, ToDos, Ansprechpartner, Tags,
  Finanzkennzahlen, Anrufe und Termine wandern auf die gewählte Haupt-Firma.
  „Sind verschiedene Firmen“ merkt sich das Paar dauerhaft.

Die alte „Excel-Liste importieren“-Funktion (ursprüngliche 215er-Liste,
`data/adressen.js`) bleibt unabhängig davon bestehen und importiert weiterhin
in den eigenen Account der gerade angemeldeten Person.

Kunden, die schon **vor** Einführung des „North Data“-Tags importiert wurden,
lassen sich über den Button „Tag „North Data“ nachtragen“ (im selben Bereich)
einmalig nachträglich taggen.

## Ort + Straße bei der Routenplanung

Nach der Ortsauswahl lässt sich zusätzlich eine oder mehrere Straßen
auswählen (Mehrfachauswahl, PLZ in Klammern). Ohne Auswahl wird wie bisher
der komplette Ort geplant – bei großen Orten mit vielen hundert Adressen
(z. B. München) empfiehlt sich aber eine Eingrenzung auf einzelne Straßen
oder Straßenzüge, sonst dauert die Berechnung entsprechend lange.

## Dashboard

Direkt nach dem Login zeigt die App oben eine Kennzahlen-Übersicht: Anzahl
angelegter Kunden, bestätigte Besuche, abgeschlossene BdSt-Mitgliedschaften
und gewünschte Beratungstermine – standardmäßig für die eigenen Daten. Für
die Rolle „owner“ mit aktiviertem „Alle Firmen anzeigen“ werden zusätzlich
die Gesamtzahlen sowie eine Tabelle mit den Werten pro Person angezeigt.

## Route drucken / als PDF, QR-Codes

„Drucken / PDF“ nutzt den normalen Druckdialog des Browsers (dort „Als PDF
speichern“ wählbar). Der Ausdruck enthält einen Hinweis, Besuche nach dem
Termin unbedingt im System nachzutragen, sowie pro Kunde einen QR-Code. Der
QR-Code verlinkt zurück in die App zu genau diesem Kunden (`?customer=…`) –
kurz scannen öffnet direkt dessen Kontaktdaten samt „Besuch eintragen“, ohne
erst suchen zu müssen.

## Daten aktualisieren

Die Adressdaten liegen sowohl als `data/adressen.json` (lesbar) als auch als
`data/adressen.js` (von der App eingebunden, damit kein Server für einen
`fetch()`-Aufruf nötig ist) vor. Bei einer aktualisierten Excel-Datei:

```bash
pip install openpyxl   # falls noch nicht installiert
python3 scripts/convert_excel.py /pfad/zur/neuen/Jubilare_BdSt.xlsx
```

Das Skript überschreibt beide Dateien im `data/`-Ordner.

## Hinweise & Grenzen

- Die App braucht eine Internetverbindung (Geokodierung, Routing,
  Kartenkacheln laufen über öffentliche OpenStreetMap-Dienste).
- `router.project-osrm.org` und `nominatim.openstreetmap.org` sind
  öffentliche Demo-/Community-Server ohne Nutzungsgarantie. Für sehr
  regelmäßigen oder mehrbenutzerfähigen Einsatz empfiehlt sich eine eigene
  OSRM/Nominatim-Instanz oder ein kommerzieller Anbieter.
- Die Kontaktfelder (Inhaber/Telefon/E-Mail/Website) stammen unverändert aus
  der Quelltabelle; bei einzelnen Zeilen sind dort in der Originaldatei nicht
  alle Spalten konsistent befüllt.
- Leaflet (Kartenbibliothek) und die QR-Code-Bibliothek (`qrcode-generator`)
  sind lokal unter `vendor/` eingebunden, es wird also kein externes CDN für
  Karten- oder QR-Code-Darstellung benötigt.
