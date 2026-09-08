# Pfingstkonzert 2027 — Probenplanung

Arbeitsablage für die Vorbereitung des Pfingstkonzerts der Neuapostolischen Kirche München
am **Sa, 15. Mai 2027**. Großer Chor (~220) + Orchester, Gesamtensemble ~250–260.

## Wie diese Ablage funktioniert

Drei Ebenen, die sich gegenseitig füttern:

| Ebene | Ordner | Ändert sich |
|---|---|---|
| **Rahmen** — Konzertdaten, Kalender, Ensemble, Räume | `00_Rahmen/` | selten |
| **Stück** — je Werk eine Datei: Analyse, Knackpunkte, Lernpfad, Stand | `01_Stuecke/` | nach jeder Probe (Stand) |
| **Probentag** — je Termin ein Ablaufskript, davor Plan / danach Protokoll | `02_Probentage/` | pro Termin neu |
| **Fortschritt** — Matrix über alle 12 Stücke × Register | `03_Fortschritt/` | nach jeder Probe |

Der Kreislauf:

```
Stück-Dateien (Was ist zu tun?)
        +
Fortschrittsmatrix (Wo stehen wir?)
        ↓
Probentag-Plan (Was machen wir am 12.09.?)
        ↓
        Probe
        ↓
Probenprotokoll (5 Min. ausfüllen)
        ↓
Matrix + Stück-Dateien aktualisiert  →  nächster Probentag-Plan
```

Entscheidend ist nur **ein** Schritt Disziplin: nach jeder Probe das Kurzprotokoll
(`02_Probentage/_Vorlage_Probenprotokoll.md`). Daraus wird der nächste Plan
gerechnet — welches Stück wie viel Zeit bekommt, ergibt sich dann aus Rückstand,
Restterminen und Schwierigkeit statt aus Bauchgefühl.

## Reifegrade (die gemeinsame Sprache)

Jedes Stück bekommt je Register (S / A / T / B / Orchester) einen Stand von 0–5:

| Grad | Bedeutung | Woran erkennbar |
|---|---|---|
| **0** | noch nicht angefasst | — |
| **1** | gelesen | einmal durchgesungen, Ablauf grob bekannt |
| **2** | notensicher | Töne + Rhythmus sitzen, Tempo noch langsam möglich |
| **3** | zusammen | im Tutti stabil, Einsätze sitzen, Text sicher |
| **4** | musikalisch | Dynamik, Phrasierung, Artikulation, Klangbalance |
| **5** | konzertreif | trägt auch unter Stress, Blickkontakt statt Notenlesen |

Ziel-Korridor: **alle Stücke ≥ 3 bis Ende Februar 2027**, ≥ 4 bis Ostern,
5 in den letzten drei Terminen. Wer bei einem Stück Anfang März noch auf 2 steht,
hat ein Problem, das man nur mit Streichung oder Sonderprobe löst — nicht mit Hoffnung.

## Zeitrechnung

- 12.09.2026 → 15.05.2027 = **ca. 35 Wochen**
- Bei 12 Stücken und begrenzten Terminen ist die knappste Ressource nicht die
  Gesamtzeit, sondern die **Anzahl der Kontakte pro Stück**. Ein Stück, das
  zwischen zwei Begegnungen 10 Wochen Pause hat, fällt um mindestens einen
  Reifegrad zurück. Deshalb plant die Matrix „Wochen seit letztem Kontakt" mit.

## Status

Gerüst steht. Es fehlen noch die Inhalte — siehe `00_Rahmen/Offene_Fragen.md`.
