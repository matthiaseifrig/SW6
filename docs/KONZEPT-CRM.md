# Konzept: Umbau zum CRM mit Tourenplanung

Stand: 09.11.2026 – **freigegeben.** Erledigt: Abschnitt 1 (Rollen/Regeln),
Abschnitt 2 (Dublettenschutz inkl. Registernummer und Pensionsrückstellungen
aus North Data), Abschnitt 3 (Startseite, G.B.V.M.-Erscheinungsbild),
Abschnitt 4 (Anrufen), Abschnitt 5 (Meine Termine), Abschnitt 6 (Kette an der
Firma: wer hat terminiert / aufgenommen / Makler-Termin vereinbart).
Ergänzt: gemeinsame Adresspools (`poolUids`) – eine Firma kann bei mehreren
Personen liegen; alle, bei denen sie liegt, sehen alle Eintragungen dazu.
**Geändert (09.11.2026):** Kolleg:innen sehen nur ihre eigenen/zugeordneten
Firmen (nicht mehr alle); Drucken/Export nur Admin; Dublettenschutz über
Prüfschlüssel (`firmKeys`) auch für Firmen, die man nicht sieht.

Entscheidungen zu den offenen Fragen (09.11.2026): Pre-Sales = Thomas Kühne;
Vorschlag zu abgesagt/verschoben gilt; alle sehen alle Firmen (ohne
Finanzkennzahlen); Werber-Kennzahl wie im Cockpit (150 € Aufnahme, 200 €
Termin), für durchgeführte Makler-Termine nur Anzahl; Makler nur Anzahl und
Sparte; Sparten wie vorgeschlagen; Registernummer = HR Amtsgericht +
Register-ID; Zuständigkeit wie vorgeschlagen; Pre-Sales telefoniert am Handy;
„Nicht mehr anrufen“ wird eingebaut.

## 0. Leitlinien

- **Kein Abrechnungssystem.** Alle Euro-Werte heißen „Kennzahl“ und dienen nur
  der Übersicht, wie produktiv jemand ist. Es gibt keine Rechnungen, keine
  Auszahlungen und keine Gutschriften.
- **Eine Firma gibt es nur einmal.** Jede Firma ist ein Datensatz, an dem
  alle Stationen hängen (Anruf → Termin → Mitglied/Abschluss).
- **Einfach vor vollständig.** Große Schrift, große Knöpfe, höchstens 3–4
  Eingaben pro Bildschirm, klare deutsche Wörter ohne Fachbegriffe.
- **Was da ist, bleibt erhalten.** Bestehende Kunden, Besuche, ToDos,
  Finanzkennzahlen und die Tourenplanung werden weiterverwendet und nicht neu
  aufgesetzt. Die Firestore-Sammlung `customers` bleibt technisch bestehen und
  heißt in der Oberfläche „Firmen“.

## 1. Rollen

Im `users`-Dokument gibt es dann zwei Ebenen:

| Feld | Werte | Bedeutung |
|---|---|---|
| `role` | `owner` / `colleague` | Wie bisher: `owner` = Chef/Verwaltung (sieht alles, Import, Auswertung aller, Benutzer). |
| `functions` | Liste aus `presales`, `werber`, `makler` | Welche Arbeit die Person macht. Mehrfachnennung ist möglich (z. B. Makler und owner). |
| `financialsAccess` | `true` | Wie bisher: Finanzkennzahlen bei eigenen Firmen lesen. |

| Funktion | Macht | Trägt ein |
|---|---|---|
| **Pre-Sales** | Telefoniert kalt (North-Data-Adressen) und vereinbart Termine für Werber oder Makler. | Anruf (wann, mit wem, Ergebnis), Termin (für wen, wann). |
| **BdSt-Werber** | Besucht Firmen und wirbt Mitglieder für den BdSt Bayern; vereinbart zusätzlich Steuer-Termine für Makler. | Termin durchgeführt, Mitglied gewonnen ja/nein, ggf. Makler-Termin. |
| **Makler** | Steuergeschäft aus bAV, PKV, Immobilien oder anderen Anlagen. | Termin durchgeführt, Abschluss ja/nein, Sparte. |

Die Funktion `functions` setzt der owner in der App unter „Benutzer“. Das ist
neu, bisher ging so etwas nur über die Firebase-Konsole. `role` und
`financialsAccess` bleiben bewusst Konsolen-Sache.

### Wer darf was sehen?

Damit beim Anruf sofort erkennbar ist, ob eine Firma schon angerufen wurde
oder schon Mitglied/Kunde ist, müssen **alle Angemeldeten die Stammdaten
und den Stand aller Firmen lesen können**. Bisher sieht jede/r nur die
eigenen Kunden.

- Stammdaten, Stand, Verlauf, Termine: alle Angemeldeten lesen.
- Ändern: wer gerade zuständig ist, wer den Termin vereinbart hat oder
  wahrnimmt, sowie owner.
- „Durchgeführt“ setzen: nur wer den Termin wahrnimmt (oder owner).
- Finanzkennzahlen: unverändert, also owner plus `financialsAccess` bei eigenen Firmen.
- Löschen von Firmen: nur owner. Statt zu löschen werden Firmen zusammengeführt (siehe Dubletten).

## 2. Datenmodell (Firestore)

### `customers/{id}` – Firma (bestehend, erweitert)

Bestehende Felder bleiben. Neu dazu kommen:

| Feld | Zweck |
|---|---|
| `registerNr` | Registernummer (z. B. „HRB 12345, AG München“), aus North Data. |
| `dedupKeys` | Liste normalisierter Schlüssel für die Dublettenprüfung (siehe Abschnitt 6). |
| `stage` | Aktuelle Station: `neu` → `presales` → `werber` / `makler` → `mitglied` / `kunde` → `kein_interesse`. |
| `zustaendigUid` / `zustaendigName` | Wer die Firma gerade betreut (ersetzt fachlich `ownerUid`; `ownerUid` bleibt für Altdaten und Regeln). |
| `isBdStMember` | Ist BdSt-Mitglied (ja/nein, mit Datum und „gewonnen von“). |
| `isMaklerKunde` | Ist Kunde bei uns (ja/nein, Sparten). |
| `lastCall` | `{at, byUid, byName, result}` – letzter Anruf zur Anzeige ohne Extra-Abfrage. |
| `nextAppointment` | `{at, forUid, forName, type}` – nächster offener Termin. |
| `doNotCall` | „Nicht mehr anrufen“ (z. B. auf Wunsch der Firma). |
| `importedAt` | Wann die Adresse ins System kam (für „neu eingestellte Adressen“). |

### `calls/{id}` – Anruf (neu, eigene Sammlung)

| Feld | Inhalt |
|---|---|
| `customerId`, `firmName`, `plz` | Bezug auf die Firma. |
| `byUid`, `byName` | Wer angerufen hat. |
| `at` | Angerufen am (Datum + Uhrzeit, automatisch). |
| `spokeWith` | Gesprochen mit (Name, frei). |
| `result` | `nicht_erreicht` · `rueckruf` (mit Datum) · `kein_interesse` · `termin` · `falsche_nummer` · `nicht_mehr_anrufen`. |
| `appointmentId` | Wenn ein Termin vereinbart wurde. |
| `note` | Kurze Notiz (optional). |

### `appointments/{id}` – Termin (neu, eigene Sammlung)

| Feld | Inhalt |
|---|---|
| `customerId`, `firmName`, `plz`, `ort` | Bezug auf die Firma. |
| `type` | `bdst` (Mitgliederwerbung) oder `makler` (Steuerthema). |
| `setByUid`, `setByName`, `setByFunction` | Wer den Termin vereinbart hat (Pre-Sales oder Werber). |
| `forUid`, `forName` | Für wen, also die „Weiterleitung an Kollege xy“. |
| `at` | Datum und Uhrzeit. |
| `contactName` | Ansprechpartner vor Ort. |
| `status` | `geplant` · `durchgefuehrt` · `abgesagt` · `verschoben` · `nicht_angetroffen`. |
| `history` | Liste der Statuswechsel und Verschiebungen (wer, wann, alt → neu). |
| `doneAt`, `doneByUid` | Wann und von wem als durchgeführt markiert. |
| `outcome` | BdSt: `{memberWon: true/false}` – Makler: `{deal: true/false, sparte}`. |
| `followUpAppointmentId` | Folgetermin, z. B. Werber → Makler. Daraus entsteht die Kette. |

Termine und Anrufe liegen als **eigene Sammlungen** und nicht unter der Firma,
weil „Meine Termine“ und die Auswertung firmenübergreifend abfragen. So
braucht es keine Sammlungsgruppen-Indizes. Der aktuelle Stand wird zusätzlich
an der Firma gespiegelt (`lastCall`, `nextAppointment`, `stage`), damit
Listen schnell bleiben. Das ist dasselbe Prinzip wie heute bei `openTodo`.

### Bestehendes

- `customers/{id}/visits`: bleibt für Besuche der Tour (Notiz, ToDo).
- `customers/{id}/financials`: bleibt unverändert.
- Bisherige Provisionsfelder (`provisionAmount`, `totalProvision`): bleiben als
  Altdaten lesbar und werden in der Oberfläche „Kennzahl“ statt „Provision“
  genannt. Siehe offene Frage 4.

### Die Kette (Anforderung 2)

Die Kette wird nicht extra gespeichert, sondern aus Anrufen und Terminen
zusammengesetzt und auf der Firmen-Seite als senkrechte Zeitleiste
angezeigt:

```
① Pre-Sales   Anna M.     3 Anrufe, zuletzt 04.11. – Termin vereinbart
② BdSt-Werber Peter G.    Termin 12.11. 10:00 – durchgeführt – Mitglied: JA
③ Makler      Matthias E. Termin 20.11. 14:00 (vereinbart von Peter G.)
                          – durchgeführt – Abschluss: JA, bAV
```

## 3. Bildschirme

Der Startbildschirm zeigt große Kacheln, und zwar nur die, die zur eigenen
Funktion passen:

| Kachel | Wer | Inhalt |
|---|---|---|
| **Anrufen** | Pre-Sales (auch Werber/Makler, falls gewünscht) | Anrufliste abarbeiten |
| **Meine Termine** | alle | Heute/kommende Termine, Ergebnis eintragen |
| **Firma suchen** | alle | Suche nach Name, Ort, PLZ, Telefon |
| **Neue Firma** | alle | Anlegen mit Dublettenprüfung |
| **Tour planen** | Werber, Makler | Bisherige Tourenplanung |
| **Meine Zahlen** | alle | Eigene Auswertung |
| **Auswertung** | owner | Alle Personen/Rollen |
| **Import / Benutzer** | owner | North-Data-Import, Funktionen zuweisen |

### 3.1 Anrufen (Pre-Sales)

1. **Liste wählen:** PLZ-Bereich bzw. Ort sowie „nur noch nicht angerufen“ oder „Rückrufe fällig“.
2. **Eine Firma pro Bildschirm:** Name groß, Ort, Ansprechpartner (Inhaber/Geschäftsführer)
   und die **Telefonnummer als großer Knopf** (tippen = anrufen am Handy).
   Darüber steht ein **farbiger Hinweisbalken**, wenn zutreffend:
   - „Schon angerufen von Anna M. am 04.11. – nicht erreicht“
   - „Ist bereits BdSt-Mitglied (seit 03/2026)“ · „Ist bereits Kunde (bAV)“
   - „Termin offen am 12.11. bei Peter G.“ · „Nicht mehr anrufen“
3. **Ergebnis, nur große Knöpfe:** `Nicht erreicht` · `Später nochmal` (Datum) ·
   `Kein Interesse` · `Termin vereinbart`
4. Nach **Termin vereinbart**: Ein Bildschirm mit *Gesprochen mit* (Name),
   *Für wen?* (große Namensknöpfe der Werber und Makler), *Worum?* (BdSt-Mitgliedschaft /
   Steuerthema Makler), *Datum*, *Uhrzeit*. Dann **Speichern** und es geht weiter zur **nächsten Firma**.

### 3.2 Meine Termine (Werber, Makler)

- Karten nach Tag: Uhrzeit, Firma, Ort, „vereinbart von Anna M.“, Ansprechpartner,
  Knopf „Anrufen“ und Knopf „Route“.
- Pro Karte drei Knöpfe: **Durchgeführt** · **Verschoben** · **Abgesagt**.
- Nach **Durchgeführt** folgt genau eine Frage:
  - Werber: „Mitglied gewonnen?“ **Ja / Nein**, danach „Termin für einen Makler vereinbart?“
    **Ja** (→ Für wen, Datum, Uhrzeit) / **Nein**.
  - Makler: „Abschluss?“ **Ja / Nein**, bei Ja „Sparte?“ als große Knöpfe:
    bAV · PKV · Immobilie · Geldanlage · Sonstiges.
- „Meine Termine heute als Tour“ übergibt die Termine des Tages an die Tourenplanung.

### 3.3 Firmen-Seite

Oben stehen Name, Adresse, Telefon und Status-Plaketten (Mitglied / Kunde / Nicht anrufen).
Darunter folgen **die Kette** (siehe oben), dann Verlauf (Anrufe, Termine, Besuche,
ToDos), Ansprechpartner und Finanzkennzahlen (wenn berechtigt). Die bisherige
Kundenkarte geht darin auf.

### 3.4 Tour planen (Anforderung 3)

Die bisherige Tourenplanung bleibt. Neu dazu kommen:
- der Filter **„Neu eingestellt“** (Adressen, die seit Datum X importiert und noch nicht
  angerufen oder besucht wurden), auswählbar nach **PLZ-Bereich** (z. B. „80…“, „81…“
  oder Liste),
- **„Termine eines Tages“** als Tour-Quelle.

### 3.5 Neue Firma / Import

Siehe Abschnitt 6, Dublettenprüfung. Vor dem Speichern bzw. Import wird immer geprüft.

### Gestaltung für Ü70 (Anforderung 7)

- Grundschrift 20 px, Überschriften 28 px, Knöpfe mindestens 56 px hoch und über die volle Breite am Handy.
- Höchstens 3–4 Eingaben pro Bildschirm; lange Abläufe werden in Schritte geteilt („Schritt 2 von 3“).
- Wörter statt Symbole: „Anrufen“, „Termin“, „Erledigt“, „Zurück“, kein „Stage“, kein „Lead“.
- Hoher Kontrast, keine grauen Kleinschriften, jede Aktion mit klarer Bestätigung
  („Gespeichert: Termin am 12.11. um 10 Uhr für Peter G.“).
- „Zurück“-Knopf immer an derselben Stelle oben links.
- Die Experten-Ansicht (Filter, Mehrfachauswahl, Druck) bleibt für owner erreichbar, aber nicht auf dem Startbildschirm.

## 4. Auswertung (Anforderung 6)

Zeitraum wählbar (Woche, Monat, Quartal, Jahr). Jede/r sieht die eigenen Zahlen, owner sieht alle.

| Rolle | Kennzahlen |
|---|---|
| **Pre-Sales** | Anrufe · erreicht (gesprochen) · Termine vereinbart · davon durchgeführt · abgesagt/verschoben · Quote *Termin je Anruf* · Quote *durchgeführt je vereinbart* · **Kennzahl: durchgeführte Termine × 50 € netto** |
| **BdSt-Werber** | Termine wahrgenommen · Mitglieder gewonnen · Quote *Mitglied je Termin* · Makler-Termine vereinbart · davon durchgeführt · Kennzahl siehe offene Frage 4 |
| **Makler** | Termine wahrgenommen · Abschlüsse · Quote *Abschluss je Termin* · Abschlüsse je Sparte · Herkunft der Termine (Pre-Sales / Werber / eigene) |
| **Gesamt (owner)** | Trichter: Firmen angerufen → Termin → durchgeführt → Mitglied → Makler-Termin → Abschluss; Vergleich je Person innerhalb der Rolle |

Ein Termin zählt für Pre-Sales erst dann als Erfolg, wenn die Person, die ihn
wahrnimmt, „Durchgeführt“ gesetzt hat (Anforderung 5).

## 5. Abgesagte und verschobene Termine (Vorschlag, siehe offene Frage 2)

| Fall | Wer setzt es | Folge |
|---|---|---|
| **Verschoben** | Wahrnehmende/r oder Vereinbarende/r | Gleicher Termin, neues Datum; alter Termin steht im Verlauf. Zählt **einmal**, sobald durchgeführt. |
| **Abgesagt durch Firma** | beide | Zählt nicht. Die Firma geht mit Wiedervorlage („Später nochmal“, Datum) zurück in die Anrufliste von Pre-Sales. |
| **Nicht angetroffen** | Wahrnehmende/r | Wie abgesagt, aber eigene Zahl in der Auswertung. |
| **Abgesagt durch uns** | Wahrnehmende/r | Zählt nicht und wird *nicht* gegen die Pre-Sales-Quote gerechnet; die Firma kommt zurück zu Pre-Sales. |
| **Termin vergessen einzutragen** | – | Termine, die 3 Tage nach dem Datum noch „geplant“ sind, erscheinen bei der wahrnehmenden Person und beim owner als „Bitte Ergebnis eintragen“. |

## 6. Dublettenprüfung (Anforderung 8)

### Normalisierte Schlüssel (`dedupKeys`)

| Schlüssel | Bildung | Beispiel |
|---|---|---|
| `reg:` | Registerart, Nummer und Gericht vereinheitlicht | `reg:hrb-12345-muenchen` |
| `tel:` | nur Ziffern, +49/0049 → 0 | `tel:0892604685` |
| `name:` | Firmenname klein, Umlaute aufgelöst, Rechtsform (GmbH, UG, e.K., GmbH & Co. KG, AG, mbH …) und Satzzeichen entfernt, plus PLZ | `name:erwinpolz-80331` |
| `nameort:` | wie oben, aber mit Ort statt PLZ (falls PLZ fehlt oder abweicht) | `name:erwinpolz-muenchen` |

### Ablauf

- **Sicherer Treffer**, wenn die Registernummer gleich ist **oder** die Telefonnummer gleich ist
  **oder** Name und PLZ gleich sind. Dann wird nichts neu angelegt, sondern die vorhandene Firma
  **ergänzt**: Leere Felder werden gefüllt, vorhandene nie überschrieben,
  Finanzkennzahlen aktualisiert und Tags ergänzt.
- **Möglicher Treffer**, wenn nur der Name gleich ist, aber der Ort abweicht, oder der Name sehr ähnlich ist und der Ort gleich.
  Dann wird **nachgefragt**: „Ist das dieselbe Firma?“ **Ja, ergänzen** / **Nein, neu anlegen**.
- **Beim Anlegen von Hand:** Schon während der Eingabe von Name/PLZ/Telefon erscheint
  „Diese Firma gibt es schon: … – öffnen?“.
- **Beim Import:** Vorschau-Tabelle mit drei Spalten „Neu (x)“, „Wird ergänzt (y)“ und „Bitte prüfen (z)“.
  Erst danach wird importiert. Damit ist ein erneuter North-Data-Import gefahrlos, die
  bisherige Gefahr doppelter Anlage ist behoben.
- **Bestehende Dubletten** (z. B. aus dem früheren Doppelimport): Ein einmaliges Werkzeug für den owner,
  „Dubletten zusammenführen“, zeigt Paare an. Beim Zusammenführen wandern Besuche, Anrufe, Termine,
  ToDos und Kennzahlen auf die Haupt-Firma; die zweite wird gelöscht.
- **Beim Anruf** zeigt der Hinweisbalken (Abschnitt 3.1) sofort, ob die Firma schon angerufen wurde (von wem, wann)
  oder schon Mitglied bzw. Kunde ist.

## 7. Übernahme BdSt-Vertriebscockpit

Das bisherige Cockpit (Artifact) wird später **einmalig** übernommen: Einträge
einlesen, mit derselben Dublettenprüfung den CRM-Firmen zuordnen und Status und
Verlauf (Mitglied, Termine, Notizen) übernehmen. Unklare Fälle landen in der
„Bitte prüfen“-Liste. Danach wird das Cockpit nicht mehr gepflegt.
Nicht betroffen sind das Immobilien-Interessenten-CRM und der Provisionsrechner; sie bleiben getrennt.

## 8. Bauabschnitte (jeweils Commit + Push, danach kurze Rückmeldung)

1. **Rollen und Regeln:** `functions` im users-Dokument, Benutzer-Bildschirm für owner, neue
   Firestore-Regeln (alle lesen Firmen, Anrufe, Termine). Den neuen Regeltext musst du in der Konsole veröffentlichen.
2. **Dublettenschutz:** Normalisierung, Registernummer im North-Data-Import, Prüfung bei Anlegen und Import
   mit Vorschau, Werkzeug „Dubletten zusammenführen“, einmaliges Nachtragen der `dedupKeys` für vorhandene Firmen.
3. **Startbildschirm und große Bedienung:** Kacheln, Schriftgrößen, Knopfgrößen, Zurück-Logik.
4. **Anrufen:** Anrufliste nach PLZ/Ort, Ein-Firma-Bildschirm, Hinweisbalken, Ergebnisknöpfe, Termin vereinbaren.
5. **Meine Termine:** Durchgeführt / Verschoben / Abgesagt, Ergebnis (Mitglied, Abschluss + Sparte),
   Folgetermin Werber → Makler, Erinnerung „Bitte Ergebnis eintragen“.
6. **Firmen-Seite mit Kette.**
7. **Tour:** Filter „Neu eingestellt“ nach PLZ, „Termine des Tages als Tour“.
8. **Auswertung** je Person und Rolle, Trichter.
9. **Übernahme Cockpit.**

Danach bzw. unabhängig davon bleiben die Punkte aus der vorigen Sitzung offen: Pensionsrückstellungen und
die Erinnerungsmail für ToDos (Option A/B). Die Erinnerungsmail ließe sich später auf
„Bitte Ergebnis eintragen“ und fällige Rückrufe erweitern.

## 9. Offene Fragen

1. **Pre-Sales-Kollege:** Name und E-Mail-Adresse für den Zugang. Den Zugang legst du wie bisher
   in Firebase unter Authentication → Nutzer an; die Funktion „Pre-Sales“ setzt du danach in der App.
2. **Abgesagt/verschoben:** Passt der Vorschlag in Abschnitt 5? Insbesondere: Zählt
   „abgesagt durch uns“ nicht gegen Pre-Sales? Wie viele Tage bis „Bitte Ergebnis eintragen“?
3. **Sichtbarkeit:** Dürfen alle Angemeldeten alle Firmen (ohne Finanzkennzahlen) sehen? Das ist nötig für den
   Hinweis „schon angerufen von …“. Die Alternative wäre, nur den Hinweis anzuzeigen, aber die Firma nicht öffnen zu können.
4. **Bisherige Provisionswerte (150 € / 112,50 € / 200 €)** der Werber: als Kennzahl behalten oder
   entfernen? Bekommt der Werber für einen durchgeführten Makler-Termin eine Kennzahl (z. B. auch 50 €)?
   Gibt es für Makler eine Euro-Kennzahl oder nur Anzahl und Sparte?
5. **Sparten:** bAV · PKV · Immobilie · Geldanlage · Sonstiges – vollständig?
6. **Registernummer:** Bitte eine Kopfzeile (nur die erste Zeile) eines aktuellen North-Data-CSV-Exports,
   damit ich den Spaltennamen der Registernummer sicher zuordne.
7. **Cockpit:** Link zum BdSt-Vertriebscockpit-Artifact (für Abschnitt 9; wird erst ganz am Ende gebraucht).
8. **Zuständigkeit:** Wem „gehört“ eine neu importierte Firma? Vorschlag: zunächst niemandem bzw.
   dem Pre-Sales-Pool; nach dem Termin der Person, die ihn wahrnimmt.
9. **Gerät:** Telefoniert Pre-Sales am Handy (Nummer antippen) oder am Festnetz mit PC daneben?
   Das bestimmt, ob ich den Anruf-Bildschirm zuerst fürs Handy oder für den PC auslege.
10. **Status „Kunde“:** Woran erkennt man bei bestehenden Firmen, dass sie schon BdSt-Mitglied bzw.
    Makler-Kunde sind? Aus den bisherigen Besuchen (Mitgliedsaufnahme) setze ich „Mitglied“ automatisch.
    Gibt es weitere Quellen (z. B. Mitgliederliste des BdSt)?
11. **Nicht mehr anrufen:** Soll es dieses Kennzeichen geben (empfohlen, z. B. bei ausdrücklichem
    Widerspruch der Firma gegen Werbeanrufe)?
