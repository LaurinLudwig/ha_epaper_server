# HA E-Paper Server

Rendert ein Home-Assistant-Dashboard für ein **Tolino Shine 1**
(Android 2.3.4, Android Browser mit WebKit 533.1, 6" E-Ink, 1024×758 hochkant).

Ohne npm-Abhängigkeiten — nur Node-Core-Module.

## Einrichtung

### 1. Token für Home Assistant

In Home Assistant unten links auf den eigenen Namen → Reiter **Sicherheit** →
ganz unten **Langlebige Zugangstoken** → *Token erstellen*. Der Token wird nur
ein einziges Mal angezeigt.

```bash
cp ha-token.txt.example ha-token.txt
# Token hineinkopieren, Beispieltext entfernen
```

Die Datei ist per `.gitignore` ausgeschlossen und darf nie eingecheckt werden.
Fehlt sie oder ist sie leer, bricht der Server beim Start mit einer Meldung ab.

### 2. Adresse von Home Assistant

Der Standardwert steht in [`server.js`](server.js):

```js
const HA_URL = process.env.HA_URL || "http://192.168.178.5:8123";
```

Zum Ändern gibt es zwei Wege:

```bash
# nur für diesen Start
HA_URL=http://192.168.1.50:8123 node server.js
```

…oder die Zeile in `server.js` dauerhaft anpassen.

**Achtung beim systemd-Dienst:** Die Umgebungsvariable wirkt dort nur, wenn sie
in der Unit steht. Sonst gilt immer der fest verdrahtete Wert aus `server.js`:

```ini
[Service]
Environment=HA_URL=http://192.168.178.5:8123
```

Nach dem Ändern der Unit: `sudo systemctl daemon-reload && sudo systemctl restart ha-epaper-server`

### 3. Starten

```bash
node server.js              # Port 8080
PORT=8099 node server.js    # anderer Port, z. B. zum Testen parallel zum Dienst
```

Ob es läuft, zeigt die Startausgabe: HA-Adresse, Anzahl Bausteine, Reload-Intervall.
Ist der Token falsch, melden die Kacheln „nicht verfügbar" — der Server selbst
startet trotzdem.

## Seiten

| Pfad | Für wen | Zweck |
|---|---|---|
| `/` | Tolino | Rotation — zeigt das gerade fällige Dashboard. Reines HTML 4.01, kein JavaScript. |
| `/d/<id>` | Tolino | Ein bestimmtes Dashboard (Ziel der Navigations-Buttons). |
| `/admin` | PC/Handy | Baukasten: Bausteine anlegen, sortieren, konfigurieren. |
| `/preview?d=<id>` | intern | Gleiches HTML wie `/`, ohne Selbst-Reload (fürs Vorschau-iframe). |
| `/action` | Tolino | Schaltaktion. **Nur POST**, danach 303-Weiterleitung. |
| `/diag` | Tolino | Misst das Gerät aus und meldet die Werte an den Server. |
| `/diag/result` | PC | Zeigt die empfangenen Messwerte als JSON. |

## Warum das Tablet-HTML so aussieht, wie es aussieht

Der Browser des Geräts kann **kein** SVG, **kein** `position: fixed`,
**kein** `box-sizing` ohne `-webkit-`-Präfix, **kein** Flexbox/Grid/`calc()`,
und XHR nur in Version 1 (kein `onerror`, kein `onload`).

Daraus folgt:

- **Server-seitiges Rendering.** Die Seite kommt fertig an; das Gerät baut
  kein DOM zusammen. Spart Speicher und umgeht die XHR-Eigenheiten.
- **Aktualisierung per `<meta http-equiv="refresh">`** auf eine jedes Mal
  andere URL (`/?t=N`) — sonst liefert der Browser-Cache dieselbe Seite und
  das Panel friert ein. Der volle Reload löscht nebenbei das E-Ink-Ghosting.
- **Layout mit `<table>`** statt `inline-block`: pixelgenau ohne `box-sizing`.
- **Hell statt dunkel**, harte Ränder statt Schatten, wenige Graustufen —
  auf reflektivem E-Ink besser lesbar und ghosting-ärmer.

`node tools/legacy-check.js` prüft das erzeugte HTML und `tablet.css` gegen
diese Regeln. Exit-Code 0 = sauber.

## Mehrere Dashboards

`dashboard.json` enthält eine Liste von Dashboards. Jedes hat einen Namen,
eine Anzeigedauer und einen Schalter, ob es an der Rotation teilnimmt.

Welches Dashboard gerade dran ist, ergibt sich **zustandslos** aus der
Serverzeit modulo der Summe aller Anzeigedauern. Das ist Absicht: sonst
würden mehrere Clients (Tablet plus offene Vorschau im Baukasten) sich
gegenseitig weiterschalten.

Der Baustein **Navigation** rendert einen Button je Dashboard. Ein Tipp
springt zum Ziel und gibt ihm seine **volle** Anzeigedauer, bevor die
Rotation weiterläuft — sonst landete man mitten im laufenden Intervall und
die Seite wäre unter Umständen nach einer Sekunde wieder weg. Die Rotation
wird dabei weder angehalten noch verlängert.

Ein Dashboard mit `inRotation: false` erscheint nie automatisch, ist aber
über Buttons und `/d/<id>` erreichbar.

## Bausteine

Konfiguriert wird in `dashboard.json` (schreibt der Baukasten; Handeditieren
geht auch, die Datei wird bei jedem Request neu gelesen).

Die Datei ist **nicht** im Repository — Entitätsnamen verraten, welche Geräte
im Haushalt stehen. Als Ausgangspunkt dient `dashboard.example.json`:

```bash
cp dashboard.example.json dashboard.json
```

Ohne diese Datei startet der Server mit einer Minimalkonfiguration
(Uhr + Hinweis auf `/admin`).

Vorhandene Typen: `weather`, `sensors`, `bigvalue`, `clock`, `text`, `action`,
`nav`, `spacer`.

**Einen neuen Typ hinzufügen** = ein Eintrag in `lib/blocks.js`:

```js
meinTyp: {
  label: "Anzeigename",
  defaults: { title: "", entity: "" },
  fields:   [ { key: "entity", label: "Entität", type: "entity" } ],
  entities: (block) => [block.entity],     // was von HA geladen wird
  render:   (block, ctx) => "<div>…</div>" // HTML fürs Tablet
}
```

Daraus entstehen automatisch das Formular im Baukasten *und* die Ausgabe auf
dem Tablet. Server und Admin-UI müssen dafür nicht angefasst werden.

Feldtypen für `fields`: `text`, `textarea`, `number`, `entity`, `select`,
`checkbox`, `rows`, `dashboards`.

## Schalten in Home Assistant

Der Baustein **Schalter / Auslöser** kann umschalten (`switch`, `light`,
`fan`, `input_boolean`) oder einmalig auslösen (`button`, `scene`, `script`,
`input_button`). Umschalter zeigen den aktuellen Zustand und sind bei „an"
invertiert dargestellt.

Drei Schutzschichten, die verschiedene Probleme lösen:

**POST statt Link.** Der Button ist ein Formular; nach der Aktion leitet der
Server per 303 auf die normale Seite um. Das ist der wichtigste Teil: Das
Panel lädt sich alle 20 Sekunden per Meta-Refresh neu. Stünde die Aktion in
der URL, würde sie dadurch endlos wiederholt — ein einmal getippter
„Jetzt füttern"-Button liefe dauerhaft weiter. `tools/legacy-check.js` prüft
deshalb, dass keine Schaltaktion als GET-Link ausgeliefert wird.

**Whitelist.** Nur Entitäten, die in einem Schaltbaustein stehen, sind
auslösbar. Die Entity-ID aus dem Formular wird nie direkt an Home Assistant
durchgereicht. Ohne Schaltbaustein ist nichts schaltbar.

**Zeitsperre.** Dieselbe Aktion wird innerhalb weniger Sekunden nur einmal
ausgeführt (pro Baustein einstellbar, Standard 5 s). Fängt versehentliches
Doppeltippen ab — auf E-Ink sieht man den ersten Tipp erst nach dem
Seitenaufbau. Gegen die Meta-Refresh-Wiederholung hilft sie **nicht**, das
kann nur POST + Weiterleitung.

> Wer über eine freigegebene IP zugreift, kann die freigegebenen Aktionen
> auslösen — siehe „Zugriffsschutz". Gib deshalb nur frei, was unkritisch ist.

## Zugriffsschutz

Zwei getrennte Schichten, weil die Clients unterschiedlich sind. Konfiguriert
wird in `security.json` (Vorlage: `security.example.json`) — **nicht** in
`dashboard.json`, damit der Baukasten die Rechte nie überschreiben kann.

### Dashboard: IP-Whitelist

Der Tolino kann kein Passwort eingeben, also wird er über seine Adresse
erkannt. Betrifft `/`, `/d/<id>`, `/action` und `/diag`.

```json
{ "dashboardAllow": ["192.168.178.62", "192.168.178.0/24"] }
```

Einzeladressen und CIDR-Bereiche. **Leere Liste = Filter aus** — eine
unvollständige Konfiguration sperrt niemanden aus. Änderungen wirken
sofort, ohne Neustart.

Nur die Tablet-IP einzutragen ist am dichtesten, dann kommst du aber selbst
nicht mehr per Browser ans Dashboard. Ergänze dafür deinen Rechner oder
gleich das ganze Subnetz.

### Baukasten: Anmeldung

```bash
node tools/set-admin-password.js "meinPasswort"
node tools/set-admin-password.js --entfernen
```

Gespeichert wird nur ein scrypt-Hash mit zufälligem Salt. Die Sitzung liegt
im Speicher des Servers — nach einem Neustart ist eine neue Anmeldung nötig.
Betrifft `/admin`, `/preview` und alle `/api/*`; die API antwortet mit
`401` statt einer HTML-Seite.

### Grenzen

Die IP-Whitelist ist **kein** Ersatz für Authentifizierung: im selben LAN
lässt sich eine IP fälschen oder nach dem Abschalten des Tablets übernehmen.
Sie hebt die Hürde und schützt gegen Gäste und Zufallszugriffe — mehr nicht.
Für die Schaltaktionen ist das der Grund, weiterhin nur Unkritisches
freizugeben.

Weitergeleitete Header (`X-Forwarded-For`) werden bewusst ignoriert, weil
kein Proxy davorsteht und sie sonst frei fälschbar wären.

## Zeitzone

Alle Zeiten werden serverseitig gerendert. Der Host läuft auf `Etc/UTC`,
deshalb kommt die Zeitzone **nicht** vom Betriebssystem, sondern aus
`settings.timezone` (Standard `Europe/Berlin`, im Baukasten änderbar).

Betroffen sind Uhr-Baustein, Fußzeile und die Wochentage der Vorhersage —
letztere sind sonst still falsch, wenn ein Vorhersagetag um 23:00 UTC
beginnt. Sommer-/Winterzeit erledigt `Intl` automatisch.

Alternativ ginge auch `Environment=TZ=Europe/Berlin` in der systemd-Unit;
als Einstellung bleibt es aber unabhängig davon, wie der Host konfiguriert ist.

## Verhalten bei HA-Ausfall

`lib/ha.js` cacht jede Entität und behält den letzten erfolgreichen Wert.
Fällt Home Assistant aus, zeigt das Panel weiter die alten Werte und
vermerkt in der Fußzeile „N veraltet" bzw. „N Entitäten nicht erreichbar",
statt eine Fehlerseite anzuzeigen. Für ein Wandgerät ist ein alter Wert
brauchbarer als gar keiner.

Alle HA-Anfragen haben 8 s Timeout und laufen parallel.

## Dateien

```
server.js              HTTP-Routing
lib/ha.js              HA-Client: Timeout, Cache, last known good
lib/config.js          dashboard.json laden/atomar speichern (+ .bak)
lib/blocks.js          Baustein-Register (Schema + Renderer)
lib/render.js          Seitengerüst, Tabellen-Raster
lib/format.js          Zahlen-, Zeit- und Wetterformatierung
lib/html.js            HTML-Escaping
lib/diag.js            Geräte-Diagnoseseite
lib/actions.js         Schaltaktionen: Whitelist und Zeitsperre
lib/access.js          IP-Pruefung, Passwort-Hashing, Sitzungen
lib/security-config.js security.json laden/speichern
lib/login.js           Anmeldemaske
public/tablet.css      Stylesheet fürs Tolino
public/admin.*         Baukasten-Oberfläche (moderner Browser)
tools/legacy-check.js  Kompatibilitätsprüfung
tools/set-admin-password.js  Passwort für /admin setzen
dashboard.example.json Vorlage für die eigene dashboard.json
```

## Offen

- Rasterbreite und Schriftgrößen sind vorläufig, bis `/diag` auf dem Gerät
  gelaufen ist.
