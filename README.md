# Tourenplaner – Jubilare BdSt

Web-App zur Tourenplanung mit eigenem Kundenstamm pro Nutzer/in: Login,
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

- Jede Person (Chef/in wie Kolleg/innen) hat einen eigenen Zugang
  (E-Mail/Passwort), angelegt in der Firebase-Konsole unter
  **Authentication → Nutzer → Nutzer hinzufügen**. Es gibt keine
  Selbstregistrierung in der App.
- Standardmäßig bekommt jede/r neue Nutzer/in die Rolle **„colleague“** und
  sieht/bearbeitet nur die eigenen angelegten Kunden.
- Eine Person mit der Rolle **„owner“** sieht zusätzlich einen Schalter „Alle
  Kollegen anzeigen“ und kann so auf die Gesamtdaten aller zugreifen.
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
  Regeln** eingefügt und veröffentlicht werden muss, damit jede/r nur die
  eigenen Daten sieht (bzw. „owner“ alle).

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

- **Kunde hinzufügen**: Formular oben in der App, landet sofort in der
  eigenen Kundenliste.
- **Besuch vom Kunden bestätigen lassen**: Bei jedem Stopp in der berechneten
  Route lässt sich „Besuch eintragen“ öffnen, optional mit einer privaten
  Notiz. Der eigentliche Besuch wird aber erst über „Vom Kunden bestätigen
  lassen“ eingetragen: Es öffnet sich eine große Bestätigungsseite, die dem
  Kunden auf dem Handy übergeben wird, der/die dann selbst mit einem Tap
  bestätigt. Damit ist sichergestellt, dass wirklich vor Ort bestätigt wurde
  – reine Selbstauskunft der/des Kolleg:in reicht nicht. Bereits besuchte
  Adressen werden in Liste und Karte farblich hervorgehoben (orange statt
  blau), „Verlauf anzeigen“ zeigt alle bisherigen Besuche mit Datum, Notiz
  und Person.
- **Finanzkennzahlen (nur für „owner“)**: Wenn Kundendaten Finanzkennzahlen
  enthalten (aus dem North-Data-Import, siehe unten), zeigt die Route für die
  Rolle „owner“ zusätzlich Umsatz, Gewinn (jeweils mit CAGR) und
  Mitarbeiterzahl an. Kolleg:innen sehen diese Zahlen nie – weder in der App
  noch über die Datenbank (eigene, nur für „owner“ lesbare Firestore-
  Unter-Sammlung `financials`).

## Kunden für Kolleg:innen importieren (nur „owner“)

Unter „Kunden für Kolleg:in importieren“ kann die Rolle „owner“ eine
North-Data-CSV-Exportdatei hochladen und im Namen einer bestimmten Person
importieren:

1. Die Person muss sich vorher **einmal** selbst in der App angemeldet haben
   (Zugang wie gewohnt vorher in der Firebase-Konsole anlegen) – erst dann
   taucht sie in der Auswahlliste auf.
2. North-Data-CSV-Datei auswählen und „Importieren“ klicken.
3. Übernommen werden: Firmenname, Adresse, bis zu drei gesetzliche
   Vertreter:innen (Handelsregister), Telefon/E-Mail/Website – sichtbar für
   „owner“ und die zugeordnete Person. Umsatz, Gewinn, CAGR% und
   Mitarbeiterzahl landen in der separaten `financials`-Unter-Sammlung und
   sind ausschließlich für „owner“ sichtbar.

Die alte „Excel-Liste importieren“-Funktion (ursprüngliche 215er-Liste,
`data/adressen.js`) bleibt unabhängig davon bestehen und importiert weiterhin
in den eigenen Account der gerade angemeldeten Person.

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
- Leaflet (Kartenbibliothek) ist lokal unter `vendor/leaflet/` eingebunden,
  es wird also kein externes CDN für die Kartendarstellung selbst benötigt.
