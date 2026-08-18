# HA E-Paper Server

Home-Assistant-Dashboard für ein **Tolino Shine 1** — einen E-Book-Reader
von 2013 mit Android 2.3.4, Android Browser (WebKit 533.1) und einem 6"
E-Ink-Display mit 1024×758 im Hochformat.

Server-seitig gerendert, ohne npm-Abhängigkeiten — nur Node-Core-Module.

**Inhalt:** [Einrichtung](#einrichtung) · [Seiten](#seiten) ·
[Mehrere Dashboards](#mehrere-dashboards) · [Bausteine](#bausteine) ·
[Schalten](#schalten-in-home-assistant) · [Zugriffsschutz](#zugriffsschutz) ·
[Warum das HTML so aussieht](#warum-das-tablet-html-so-aussieht-wie-es-aussieht)

---

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

```bash
HA_URL=http://192.168.1.50:8123 node server.js   # nur für diesen Start
```

…oder die Zeile in `server.js` dauerhaft anpassen.

**Achtung beim systemd-Dienst:** Die Umgebungsvariable wirkt dort nur, wenn sie
in der Unit steht. Sonst gilt immer der fest verdrahtete Wert aus `server.js`:

```ini
[Service]
Environment=HA_URL=http://192.168.178.5:8123
```

Danach `sudo systemctl daemon-reload && sudo systemctl restart ha-epaper-server`.

### 3. Dashboard-Konfiguration

```bash
cp dashboard.example.json dashboard.json
```

Ohne diese Datei startet der Server mit einer Minimalkonfiguration aus Uhr
und einem Hinweis auf `/admin`. Alles Weitere baust du dort zusammen.

### 4. Zugriffsschutz (empfohlen)

```bash
cp security.example.json security.json     # IPs eintragen
node tools/set-admin-password.js "meinPasswort"
```

Details unter [Zugriffsschutz](#zugriffsschutz). Ohne diesen Schritt sind
Dashboard und Baukasten für jeden im LAN offen.

### 5. Starten

```bash
node server.js              # Port 8080
PORT=8099 node server.js    # anderer Port, z. B. zum Testen parallel zum Dienst
```

Die Startausgabe zeigt HA-Adresse, Zugriffsstatus und alle Dashboards mit
Bausteinzahl und Anzeigedauer:

```
Home Assistant : http://192.168.178.5:8123
Dashboard-Zugriff: 192.168.178.88, 192.168.178.102
Baukasten        : Passwort gesetzt
Dashboards     : 2
  - Home (7 Bausteine, 20s)
  - Akku anzeige (5 Bausteine, 20s)
```

Ist der Token falsch, melden die Kacheln „nicht verfügbar" — der Server
selbst startet trotzdem.

---

## Seiten

| Pfad | Für wen | Zugriff | Zweck |
|---|---|---|---|
| `/` | Tolino | IP | Rotation — zeigt das gerade fällige Dashboard |
| `/d/<id>` | Tolino | IP | Ein bestimmtes Dashboard (Ziel der Navigations-Buttons) |
| `/action` | Tolino | IP | Schaltaktion. **Nur POST**, danach 303-Weiterleitung |
| `/diag` | Tolino | IP | Misst das Gerät aus und meldet die Werte zurück |
| `/diag/result` | PC | IP | Empfangene Messwerte als JSON |
| `/tablet.css` | beide | **frei** | Stylesheet — siehe [Zugriffsschutz](#zugriffsschutz) |
| `/admin` | PC/Handy | Login | Baukasten |
| `/admin/login`, `/admin/logout` | PC/Handy | — | Anmeldung und Abmeldung |
| `/preview?d=<id>` | intern | Login | Vorschau ohne Selbst-Reload (fürs iframe) |
| `/api/schema`, `/api/config`, `/api/entities` | intern | Login | Daten für den Baukasten |

---

## Mehrere Dashboards

`dashboard.json` enthält eine Liste von Dashboards. Jedes hat einen Namen,
eine Anzeigedauer und einen Schalter für die Rotationsteilnahme.

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

Eine `dashboard.json` aus Version 1 (flaches `blocks[]`) wird beim Laden
automatisch und verlustfrei in ein einzelnes Dashboard migriert.

---

## Bausteine

Konfiguriert wird in `dashboard.json` — schreibt der Baukasten; Handeditieren
geht auch, die Datei wird bei jedem Request neu gelesen.

Die Datei ist **nicht** im Repository: Entitätsnamen verraten, welche Geräte
im Haushalt stehen. Vorlage ist `dashboard.example.json`.

| Typ | Zweck |
|---|---|
| `weather` | Aktuelles Wetter mit Vorhersage-Tagen |
| `sensors` | Mehrere Werte untereinander, mit eigenen Bezeichnungen |
| `bigvalue` | Ein Wert, so groß wie möglich, vertikal zentriert |
| `clock` | Uhrzeit und Datum (Serverzeit) |
| `text` | Fester Text |
| `action` | [Schalter oder Auslöser](#schalten-in-home-assistant) |
| `nav` | Buttons zum Umschalten zwischen Dashboards |
| `spacer` | Leerfläche zum Auffüllen des Rasters |

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

Feldtypen: `text`, `textarea`, `number`, `entity`, `select`, `checkbox`,
`rows`, `dashboards`. Ein `entity`-Feld kann per `domains: [...]` auf
bestimmte Domains eingeschränkt werden — der Picker zeigt dann nur diese.

---

## Schalten in Home Assistant

Der Baustein **Schalter / Auslöser** kann umschalten (`switch`, `light`,
`fan`, `input_boolean`) oder einmalig auslösen (`button`, `scene`, `script`,
`input_button`). Umschalter zeigen den aktuellen Zustand und sind bei „an"
invertiert dargestellt.

Drei Schutzschichten, die **verschiedene** Probleme lösen:

### POST statt Link

Der Button ist ein Formular; nach der Aktion leitet der Server per 303 auf
die normale Seite um.

Das ist der wichtigste Teil. Das Panel lädt sich alle 20 Sekunden per
Meta-Refresh neu — stünde die Aktion in der URL, würde sie dadurch endlos
wiederholt. Ein einmal getippter „Jetzt füttern"-Button liefe dann dauerhaft
weiter, gemessen 7 Auslösungen in 2 Minuten. Nach der Weiterleitung steht in
der Adresszeile die harmlose Seite, der Reload wiederholt also nichts.

`tools/legacy-check.js` prüft deshalb mit, dass keine Schaltaktion je als
GET-Link oder als Formular ohne `method="post"` ausgeliefert wird.

### Whitelist

Nur Entitäten, die in einem Schaltbaustein stehen, sind auslösbar. Die
Entity-ID aus dem Formular wird nie direkt an Home Assistant durchgereicht.
Ohne Schaltbaustein ist gar nichts schaltbar.

### Zeitsperre

Dieselbe Aktion wird innerhalb weniger Sekunden nur einmal ausgeführt (pro
Baustein einstellbar, Standard 5 s). Fängt versehentliches Doppeltippen ab —
auf E-Ink sieht man den ersten Tipp erst nach dem Seitenaufbau.

Gegen die Meta-Refresh-Wiederholung hilft sie **nicht**: bei 20 s Reload ist
eine 5-s-Sperre längst abgelaufen. Das kann nur POST + Weiterleitung.

> Wer über eine freigegebene IP zugreift, kann die freigegebenen Aktionen
> auslösen. Gib deshalb nur frei, was unkritisch ist — Licht und Futterautomat
> ja, Sirenen und Türschlösser besser nicht.

---

## Zugriffsschutz

Zwei getrennte Schichten, weil die Clients unterschiedlich sind: der Tolino
kann kein Passwort eingeben, der Browser vor dem Baukasten schon.

Konfiguriert wird in `security.json` (Vorlage: `security.example.json`) —
**nicht** in `dashboard.json`, damit der Baukasten die Rechte nie
überschreiben kann. Die Datei ist per `.gitignore` ausgeschlossen.

### Dashboard: IP-Whitelist

Betrifft `/`, `/d/<id>`, `/action`, `/diag` und `/diag/result`.

```json
{ "dashboardAllow": ["192.168.178.88", "192.168.178.0/24"] }
```

Einzeladressen und CIDR-Bereiche. **Leere Liste = Filter aus** — eine
unvollständige oder beschädigte Konfiguration sperrt niemanden aus.
Änderungen wirken **sofort, ohne Neustart**; ein Tippfehler lässt sich also
einfach korrigieren.

Einzutragen ist die Adresse, von der ein Gerät **sendet** — nicht die, die
man in der Adresszeile aufruft, denn das ist die des Servers. Bei einer
Ablehnung nennt die Fehlermeldung genau die gesehene IP, und im Log steht
`Dashboard-Zugriff abgelehnt von <ip> auf <route>`. Die gehört in die Liste.

Nur die Tablet-IP einzutragen ist am dichtesten, dann kommst du aber selbst
nicht mehr per Browser ans Dashboard. Ergänze deinen Rechner oder gleich das
ganze Subnetz.

### Baukasten: Anmeldung

Betrifft `/admin`, `/preview` und alle `/api/*`.

```bash
node tools/set-admin-password.js "meinPasswort"
node tools/set-admin-password.js --entfernen
```

Gespeichert wird nur ein scrypt-Hash mit zufälligem Salt, nie das Passwort
selbst. Die Sitzung liegt im Speicher des Servers — nach einem Neustart ist
eine neue Anmeldung nötig. Die API antwortet mit `401` statt einer
HTML-Seite, sonst würde der Baukasten die Login-Maske als JSON zu parsen
versuchen.

### Zwei Ausnahmen, die aus der Praxis kommen

**`/tablet.css` liegt nicht unter dem IP-Filter.** Die Datei wird auch von
der Vorschau im Baukasten geladen — also von der IP des Admin-Rechners, nicht
der des Tablets. Stünde sie unter dem Filter, käme die Vorschau ohne jede
Formatierung an. Sie enthält nur Gestaltungsregeln, keine Daten.

**In der Vorschau sind Navigations- und Schaltbuttons inaktiv.** Sie werden
als `<span>` statt `<a>`/`<form>` gerendert: optisch identisch, ohne Ziel.
Sonst würde ein Klick das iframe auf eine Dashboard-Route führen (die unter
dem IP-Filter liegt) oder beim Zusammenbauen versehentlich in Home Assistant
schalten.

### Grenzen

Die IP-Whitelist ist **kein** Ersatz für Authentifizierung: im selben LAN
lässt sich eine IP fälschen oder nach dem Abschalten des Tablets übernehmen.
Sie hebt die Hürde und schützt gegen Gäste und Zufallszugriffe — mehr nicht.

Weitergeleitete Header (`X-Forwarded-For`) werden bewusst ignoriert, weil
kein Proxy davorsteht und sie sonst frei fälschbar wären.

---

## Warum das Tablet-HTML so aussieht, wie es aussieht

Der Browser des Geräts kann **kein** SVG, **kein** `position: fixed`,
**kein** `box-sizing` ohne `-webkit-`-Präfix, **kein** Flexbox/Grid/`calc()`,
keine `rem`/`vh`-Einheiten, und XHR nur in Version 1 (kein `onerror`).

Daraus folgt:

- **Server-seitiges Rendering.** Die Seite kommt fertig an; das Gerät baut
  kein DOM zusammen. Spart Speicher und umgeht die XHR-Eigenheiten.
- **Aktualisierung per `<meta http-equiv="refresh">`** auf eine jedes Mal
  andere URL — sonst liefert der Browser-Cache dieselbe Seite und das Panel
  friert ein. Der volle Reload löscht nebenbei das E-Ink-Ghosting.
- **Layout mit `<table>`** statt `inline-block`: pixelgenau ohne `box-sizing`.
- **Keine Prozenthöhen.** Sie lösen sich in Tabellenzellen nicht auf, deren
  Höhe erst aus dem Inhalt entsteht. Gleiche Kachelhöhen und vertikal
  zentrierte Werte entstehen stattdessen aus nativer Tabellenmechanik:
  Titel und Inhalt liegen in getrennten Tabellenzeilen, `valign` erledigt
  den Rest.
- **Hell statt dunkel**, harte Ränder statt Schatten, genau zwei Textfarben
  (`#000` für Werte, `#444` für Beschriftungen) — auf reflektivem E-Ink
  besser lesbar und ghosting-ärmer.

```bash
node tools/legacy-check.js                        # prüft http://localhost:8080/
node tools/legacy-check.js http://localhost:8099/ # andere Adresse
```

Geprüft werden das erzeugte HTML und `public/tablet.css`. Läuft kein Server,
wird nur das Stylesheet geprüft. Exit-Code 0 = sauber.

---

## Zeitzone

Alle Zeiten werden serverseitig gerendert. Der Host läuft meist auf
`Etc/UTC`, deshalb kommt die Zeitzone **nicht** vom Betriebssystem, sondern
aus `settings.timezone` (Standard `Europe/Berlin`, im Baukasten änderbar).

Betroffen sind Uhr-Baustein, Fußzeile und die Wochentage der Vorhersage —
letztere sind sonst still falsch, wenn ein Vorhersagetag um 23:00 UTC
beginnt. Sommer- und Winterzeit erledigt `Intl` automatisch.

Alternativ ginge `Environment=TZ=Europe/Berlin` in der systemd-Unit; als
Einstellung bleibt es aber unabhängig davon, wie der Host konfiguriert ist.

---

## Verhalten bei HA-Ausfall

`lib/ha.js` cacht jede Entität und behält den letzten erfolgreichen Wert.
Fällt Home Assistant aus, zeigt das Panel weiter die alten Werte und
vermerkt in der Fußzeile „N veraltet" bzw. „N Entitäten nicht erreichbar",
statt eine Fehlerseite anzuzeigen. Für ein Wandgerät ist ein alter Wert
brauchbarer als gar keiner.

Alle HA-Anfragen haben 8 s Timeout und laufen parallel.

---

## Dateien

```
server.js                    HTTP-Routing und Zugriffskontrolle
lib/ha.js                    HA-Client: Timeout, Cache, last known good
lib/config.js                dashboard.json laden/atomar speichern, Rotation
lib/blocks.js                Baustein-Register (Schema + Renderer)
lib/render.js                Seitengerüst, Tabellen-Raster
lib/format.js                Zahlen-, Zeit- und Wetterformatierung
lib/html.js                  HTML-Escaping
lib/actions.js               Schaltaktionen: Whitelist und Zeitsperre
lib/access.js                IP-Prüfung, Passwort-Hashing, Sitzungen
lib/security-config.js       security.json laden/speichern
lib/login.js                 Anmeldemaske
lib/diag.js                  Geräte-Diagnoseseite
public/tablet.css            Stylesheet fürs Tolino
public/admin.*               Baukasten-Oberfläche (moderner Browser)
tools/legacy-check.js        Kompatibilitätsprüfung
tools/set-admin-password.js  Passwort für /admin setzen
dashboard.example.json       Vorlage für die eigene dashboard.json
security.example.json        Vorlage für die eigene security.json
```

Nicht im Repository (per `.gitignore`): `ha-token.txt`, `security.json`,
`dashboard.json`, `diag-report.json`.

---

## Offen

- Rasterbreite und Schriftgrößen sind geschätzt, nicht gemessen: `/diag` ist
  auf dem Gerät noch nicht gelaufen. Das betrifft auch die Trefffläche der
  Buttons — derzeit auf ~64 px ausgelegt.
- Die systemd-Unit liegt nur unter `/etc/systemd/system/`, nicht im Repo.
