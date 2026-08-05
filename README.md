# Tourenplaner – Jubilare BdSt

Kleine Web-App zur Tourenplanung für die Adressliste aus `Jubilare_BdSt.xlsx`
(Tabelle „Tabelle1“, 215 Adressen in ca. 100 Orten).

Du wählst einen Ort aus (z. B. „Landshut“ oder „München“) und bekommst eine nach
tatsächlicher Fahrzeit optimierte Reihenfolge, in der du alle Adressen in
diesem Ort abfahren kannst – inklusive Karte und Link zur Navigation in Google
Maps. Der Startpunkt ist frei wählbar: eine beliebige Adresse aus der Liste,
dein aktueller GPS-Standort, oder du überlässt die Wahl der App.

## Nutzung

1. Repo lokal öffnen und einen einfachen Webserver im Projektordner starten
   (nötig, da manche Browser `fetch`/lokale Skripte bei `file://` einschränken):
   ```bash
   npx http-server -p 8080 .
   # oder: python3 -m http.server 8080
   ```
2. Im Browser `http://localhost:8080` öffnen.
3. Ort auswählen, Startpunkt festlegen, „Route berechnen“ klicken.

Alternativ lässt sich der Ordner unverändert z. B. über **GitHub Pages**
veröffentlichen (Settings → Pages → Branch auswählen) – die App ist rein
statisch (HTML/CSS/JS), es gibt keinen Server-Anteil.

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
