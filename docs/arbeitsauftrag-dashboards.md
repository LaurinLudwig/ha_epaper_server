# Arbeitsauftrag: Mehrere Dashboards mit Rotation und Umschalt-Bausteinen

Stand: 2026-08-18 · Ausgangsbasis: Commit `9c245ae`

**Status: umgesetzt.** Alle sieben Abnahmekriterien geprüft.

## Ziel

Statt einem Dashboard mehrere, zwischen denen das Tablet automatisch
weiterschaltet und die sich per Button auf dem Gerät ansteuern lassen.

## Entschiedene Punkte

| Frage | Entscheidung |
|---|---|
| Verhalten der Buttons | Rotation läuft weiter, der Tipp zeigt das Ziel bis zum nächsten Wechsel |
| Platzierung | Als Baustein „Navigation", frei im Raster platzierbar |
| Anzahl Dashboards | Offen — Leiste bricht ab einer Schwelle automatisch um |

### Notwendige Ergänzung: Karenzzeit

`<meta http-equiv="refresh">` lädt stur nach *n* Sekunden eine feste URL nach.
Läuft die Rotation unbeirrt weiter, landet ein Tipp irgendwo im laufenden
Intervall — im schlechtesten Fall ist das gewählte Dashboard nach einer
Sekunde wieder weg. Die Buttons wären damit praktisch unbenutzbar.

Deshalb: Ein Tipp setzt den Timer des Zieldashboards **neu auf dessen volle
Anzeigedauer**. Die Rotation wird nicht angehalten und nicht verlängert — sie
läuft ab dem angetippten Dashboard normal weiter. Das ist derselbe
Implementierungsaufwand (die Refresh-URL wird ohnehin pro Seite erzeugt) und
kostet keine zusätzliche Zustandshaltung.

Eine echte Pause („5 Minuten stehen bleiben") ist bewusst **nicht** Teil
dieses Auftrags.

## Datenmodell

`dashboard.json` bekommt eine Ebene. Migration passiert beim Laden, ohne
Zutun des Nutzers.

```jsonc
{
  "version": 2,
  "settings": { /* global: timezone, baseFontSize, deviceDpi, contentWidth */ },
  "dashboards": [
    {
      "id": "d1",
      "name": "Übersicht",        // Button-Beschriftung
      "shortName": "Übers.",      // optional, für schmale Leisten
      "seconds": 30,              // Anzeigedauer in der Rotation
      "inRotation": true,         // false = nur per Button erreichbar
      "blocks": [ /* wie bisher */ ]
    }
  ]
}
```

- `refreshSeconds` wandert von `settings` nach `dashboards[].seconds`
- `title` bleibt global in `settings`
- Ein Dashboard mit `inRotation: false` wird übersprungen, bleibt aber
  über Buttons und direkte URL erreichbar

### Migration v1 → v2

`lib/config.js` erkennt `version < 2` bzw. ein vorhandenes `blocks` auf
oberster Ebene und verpackt es in ein einzelnes Dashboard `"Dashboard 1"`
mit `seconds` aus dem alten `settings.refreshSeconds`. Verlustfrei, damit
die bestehende Konfiguration weiterläuft.

## Routen

| Route | Zweck |
|---|---|
| `/` | Rotation: zeigt das nächste fällige Dashboard |
| `/d/<id>` | Ein bestimmtes Dashboard, Rotation läuft ab hier weiter |
| `/preview?d=<id>` | Vorschau im Baukasten (POST mit Entwurf wie bisher) |

Die Rotation ist **zustandslos**: welches Dashboard dran ist, ergibt sich
aus der Serverzeit modulo der Summe aller Anzeigedauern. Das ist wichtig,
weil sonst mehrere Clients (Tablet + offene Vorschau) sich gegenseitig
weiterschalten würden.

Die Refresh-URL zeigt jeweils auf `/d/<nächste-id>?t=<zähler>` — der
Cache-Buster bleibt zwingend erhalten.

## Neuer Bausteintyp `nav`

In `lib/blocks.js` als regulärer Eintrag, damit Formular und Ausgabe wie
gehabt aus demselben Schema entstehen.

- Felder: `showAll` (alle Dashboards) oder Auswahl bestimmter IDs,
  `showLabels` (Klartext vs. Nummern), `highlightActive`
- Rendert eine Tabelle mit einem `<a>` je Ziel, als Buttons gestylt
- Aktives Dashboard optisch hervorgehoben (invertiert)
- Ab einer Schwelle (Vorschlag: > 4 Ziele) Umbruch auf mehrere Zeilen

### Touch-Anforderungen (E-Ink, kein präziser Touch)

- Trefffläche mindestens ~64 px hoch; das ganze `<td>` klickbar, nicht nur
  der Text — auf WebKit 533 heißt das: `<a>` als `display: block` mit
  Innenabstand, nicht ein Link mitten im Fließtext
- Keine `:hover`-Effekte (auf E-Ink wirkungslos)
- Keine `position: fixed`, kein Flexbox, keine Prozenthöhen — die
  bekannten Grenzen aus `tools/legacy-check.js` gelten unverändert

## Baukasten (`/admin`)

- Dashboard-Umschalter oben: anlegen, umbenennen, sortieren, löschen,
  duplizieren
- Bausteinliste und Editor arbeiten auf dem gewählten Dashboard
- Pro Dashboard: Anzeigedauer und „an Rotation teilnehmen"
- Vorschau zeigt das gewählte Dashboard (bestehender POST-Entwurfsweg)
- Bausteine zwischen Dashboards verschieben (Auswahlfeld im Editor)

## Abnahmekriterien

1. Bestehende `dashboard.json` (v1) läuft nach dem Update unverändert weiter
2. Rotation schaltet nach den konfigurierten Zeiten weiter
3. Tipp auf einen Nav-Button zeigt das Ziel für dessen volle Anzeigedauer
4. Dashboards mit `inRotation: false` erscheinen nie automatisch
5. `node tools/legacy-check.js` bleibt bei Exit-Code 0
6. Kein Prozenthöhen-Konstrukt im erzeugten HTML
7. Bei HA-Ausfall gilt „letzter bekannter Wert" weiterhin je Dashboard

## Offen aus früheren Runden

- `/diag` wurde nie auf dem Tolino ausgeführt: Rasterbreite und
  Schriftgrößen sind weiterhin geschätzt, nicht gemessen. Vor dem
  Feinschliff der Button-Größen sollte das nachgeholt werden.
- `/admin` hat keinen Passwortschutz.
- systemd-Unit liegt nicht im Repo.
