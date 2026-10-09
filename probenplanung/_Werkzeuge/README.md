# Werkzeuge

Kleine Skripte, die bei jedem Dokument laufen, bevor es herausgeht.

| Skript | Zweck |
|---|---|
| `paginate.py` | stempelt die Fußzeile mit Seitenzahl in ein fertiges **PDF** |
| `docx_fusszeile.py` | hängt einem fertigen **.docx** eine Fußzeile mit `PAGE`/`NUMPAGES` an |

```bash
python3 _Werkzeuge/paginate.py       02_Probentage/Probe_2027-01-16.pdf  "Probentag 16.01.2027 · Pfingstkonzert 2027"
python3 _Werkzeuge/docx_fusszeile.py 02_Probentage/Probe_2027-01-16.docx "Probentag 16.01.2027 · Pfingstkonzert 2027"
```

Beide Skripte sind **idempotent** — ein zweiter Aufruf auf dieselbe Datei tut nichts.
Links steht der Kurztitel, rechts „Seite n / N". Im Word-Dokument sind es echte
Felder, die Word beim Öffnen und Drucken selbst aktualisiert; im PDF ist die Zahl
fest eingestempelt.

## Warum

Aus der Probe heraus: *„Es kostet Zeit, wenn man mal nur eine Seite in der Hand hat
und dann neu sortieren muss."* Ein Dirigentenpult ist kein Schreibtisch — Blätter
rutschen, fallen, werden weitergereicht. Ohne Seitenzahl ist eine einzelne Seite
wertlos.
