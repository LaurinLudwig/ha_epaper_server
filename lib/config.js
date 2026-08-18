"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", "dashboard.json");
const BACKUP_FILE = path.join(__dirname, "..", "dashboard.json.bak");

const CONFIG_VERSION = 2;

// Global, gilt fuer alle Dashboards. Die Anzeigedauer sitzt bewusst NICHT
// hier, sondern pro Dashboard - sonst liessen sich keine unterschiedlich
// langen Standzeiten einstellen.
const DEFAULT_SETTINGS = {
  title: "Home Dashboard",
  // Der Server laeuft meist auf UTC - ohne das zeigt die Uhr die falsche Zeit.
  timezone: "Europe/Berlin",
  // Breite des Rasters in CSS-Pixeln. 0 = volle Fensterbreite.
  // Der echte Wert fuer den Tolino kommt aus /diag.
  contentWidth: 0,
  // Basis-Schriftgroesse. Bei 212 ppi ist mehr noetig als am Monitor.
  baseFontSize: 26,
  // 1:1-Abbildung von CSS-Pixeln auf Geraetepixel (Android 2.x/3.x/4.x).
  // Ergibt die schaerfste Schrift auf E-Ink, macht die Seite aber "kleiner".
  deviceDpi: true,
  showFooter: true
};

const DEFAULT_DASHBOARD_SECONDS = 60;
const MIN_SECONDS = 5;
const MAX_SECONDS = 3600;

const VALID_WIDTHS = ["full", "half"];

let idCounter = 0;

function makeId(prefix) {
  idCounter++;
  return (prefix || "b") + Date.now().toString(36) + idCounter.toString(36);
}

// Startkonfiguration, wenn noch keine dashboard.json existiert. Bewusst ohne
// konkrete Entitaeten: die gibt es in einer fremden Installation nicht, das
// Panel wuerde nur Fehler anzeigen. Stattdessen ein Hinweis auf den Baukasten.
function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    dashboards: [
      {
        id: makeId("d"),
        name: "Dashboard 1",
        shortName: "",
        seconds: DEFAULT_DASHBOARD_SECONDS,
        inRotation: true,
        blocks: [
          {
            id: makeId(),
            type: "clock",
            width: "full",
            title: "",
            showTime: true,
            showDate: true
          },
          {
            id: makeId(),
            type: "text",
            width: "full",
            title: "Einrichtung",
            text: "Noch keine Bausteine konfiguriert.\n" +
              "Im Browser /admin öffnen und das Dashboard zusammenstellen.",
            size: "normal"
          }
        ]
      }
    ]
  };
}

function normalizeBlocks(rawBlocks, blockTypes) {
  const blocks = [];
  const list = Array.isArray(rawBlocks) ? rawBlocks : [];

  for (let i = 0; i < list.length; i++) {
    const rawBlock = list[i];

    if (!rawBlock || typeof rawBlock !== "object") {
      continue;
    }

    const definition = blockTypes[rawBlock.type];

    // Unbekannte Typen fliegen raus, statt den Renderer spaeter zu ueberraschen.
    if (!definition) {
      continue;
    }

    const block = Object.assign({}, definition.defaults, rawBlock);

    block.id = String(block.id || makeId());
    block.type = rawBlock.type;
    block.width = VALID_WIDTHS.indexOf(block.width) === -1 ? "full" : block.width;

    if (typeof definition.normalize === "function") {
      definition.normalize(block);
    }

    blocks.push(block);
  }

  return blocks;
}

// v1 kannte nur ein Dashboard: { settings: {...}, blocks: [...] }.
// Das wird verlustfrei in ein einzelnes Dashboard verpackt, damit eine
// bestehende Installation nach dem Update unveraendert weiterlaeuft.
function migrate(config) {
  if (Array.isArray(config.dashboards)) {
    return config;
  }

  if (!Array.isArray(config.blocks)) {
    return config;
  }

  const settings = config.settings || {};
  const seconds = Number(settings.refreshSeconds) || DEFAULT_DASHBOARD_SECONDS;

  const migrated = {
    version: CONFIG_VERSION,
    settings: Object.assign({}, settings),
    dashboards: [
      {
        id: "d1",
        name: "Dashboard 1",
        shortName: "",
        seconds: seconds,
        inRotation: true,
        blocks: config.blocks
      }
    ]
  };

  // refreshSeconds ist in v2 keine globale Einstellung mehr.
  delete migrated.settings.refreshSeconds;

  console.log("dashboard.json von v1 auf v2 migriert (" +
    config.blocks.length + " Bausteine, " + seconds + "s Anzeigedauer)");

  return migrated;
}

// Sorgt dafuer, dass der Renderer nie auf kaputte Daten trifft - egal ob die
// Datei von Hand editiert oder von einer aelteren Version geschrieben wurde.
function normalize(raw, blockTypes) {
  const config = migrate((raw && typeof raw === "object") ? raw : {});
  const settings = Object.assign({}, DEFAULT_SETTINGS, config.settings || {});

  settings.baseFontSize = Math.max(10, Math.min(80, Number(settings.baseFontSize) || DEFAULT_SETTINGS.baseFontSize));
  settings.contentWidth = Math.max(0, Number(settings.contentWidth) || 0);
  settings.deviceDpi = settings.deviceDpi !== false;
  settings.showFooter = settings.showFooter !== false;
  settings.title = String(settings.title || DEFAULT_SETTINGS.title);
  settings.timezone = String(settings.timezone || DEFAULT_SETTINGS.timezone);

  // Aus v1 uebriggebliebene Einstellung entfernen, damit sie nicht als
  // wirkungslose Karteileiche in der Datei stehen bleibt.
  delete settings.refreshSeconds;

  const dashboards = [];
  const rawDashboards = Array.isArray(config.dashboards) ? config.dashboards : [];

  for (let i = 0; i < rawDashboards.length; i++) {
    const rawDashboard = rawDashboards[i];

    if (!rawDashboard || typeof rawDashboard !== "object") {
      continue;
    }

    dashboards.push({
      id: String(rawDashboard.id || makeId("d")),
      name: String(rawDashboard.name || "Dashboard " + (i + 1)),
      shortName: String(rawDashboard.shortName || ""),
      seconds: Math.max(MIN_SECONDS, Math.min(MAX_SECONDS,
        Number(rawDashboard.seconds) || DEFAULT_DASHBOARD_SECONDS)),
      inRotation: rawDashboard.inRotation !== false,
      blocks: normalizeBlocks(rawDashboard.blocks, blockTypes)
    });
  }

  // Ohne mindestens ein Dashboard haette der Renderer nichts zu zeigen.
  if (dashboards.length === 0) {
    dashboards.push({
      id: makeId("d"),
      name: "Dashboard 1",
      shortName: "",
      seconds: DEFAULT_DASHBOARD_SECONDS,
      inRotation: true,
      blocks: []
    });
  }

  // Doppelte IDs wuerden die Umschalt-Links mehrdeutig machen.
  const seen = Object.create(null);

  dashboards.forEach(function (dashboard) {
    while (seen[dashboard.id]) {
      dashboard.id = makeId("d");
    }
    seen[dashboard.id] = true;
  });

  return { version: CONFIG_VERSION, settings: settings, dashboards: dashboards };
}

function load(blockTypes) {
  let raw = null;

  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("dashboard.json ist beschädigt, nutze Standard:", err.message);
    }
    return normalize(defaultConfig(), blockTypes);
  }

  return normalize(raw, blockTypes);
}

// Atomar schreiben: erst temporaer, dann umbenennen. Ein Stromausfall
// mitten im Speichern hinterlaesst so keine halbe Datei.
function save(config, blockTypes) {
  const normalized = normalize(config, blockTypes);
  const text = JSON.stringify(normalized, null, 2);
  const tempFile = CONFIG_FILE + ".tmp";

  try {
    fs.copyFileSync(CONFIG_FILE, BACKUP_FILE);
  } catch (err) {
    // Beim allerersten Speichern gibt es noch nichts zu sichern.
  }

  fs.writeFileSync(tempFile, text, "utf8");
  fs.renameSync(tempFile, CONFIG_FILE);

  return normalized;
}

function exists() {
  return fs.existsSync(CONFIG_FILE);
}

// --- Rotation --------------------------------------------------------------

function rotationList(config) {
  return config.dashboards.filter(function (dashboard) {
    return dashboard.inRotation;
  });
}

function findDashboard(config, id) {
  for (let i = 0; i < config.dashboards.length; i++) {
    if (config.dashboards[i].id === id) {
      return config.dashboards[i];
    }
  }
  return null;
}

// Welches Dashboard gerade dran ist, ergibt sich aus der Uhrzeit - NICHT aus
// serverseitigem Zustand. Sonst wuerden mehrere Clients (Tablet + offene
// Vorschau) sich gegenseitig weiterschalten.
function currentRotationDashboard(config, nowMs) {
  const list = rotationList(config);

  if (list.length === 0) {
    return config.dashboards[0];
  }

  let total = 0;
  list.forEach(function (dashboard) { total += dashboard.seconds; });

  let offset = Math.floor((nowMs || Date.now()) / 1000) % total;

  for (let i = 0; i < list.length; i++) {
    if (offset < list[i].seconds) {
      return list[i];
    }
    offset -= list[i].seconds;
  }

  return list[0];
}

// Das Dashboard, das nach dem uebergebenen an der Reihe ist. Wird fuer die
// Ziel-URL des Meta-Refresh gebraucht.
function nextInRotation(config, dashboard) {
  const list = rotationList(config);

  if (list.length === 0) {
    return config.dashboards[0];
  }

  if (list.length === 1) {
    return list[0];
  }

  const index = list.findIndex(function (item) {
    return item.id === (dashboard && dashboard.id);
  });

  // Ein Dashboard ausserhalb der Rotation (per Button aufgerufen) hat keinen
  // Nachfolger in der Liste - dann geht es beim aktuell faelligen weiter.
  if (index === -1) {
    return currentRotationDashboard(config, Date.now());
  }

  return list[(index + 1) % list.length];
}

module.exports = {
  CONFIG_FILE,
  CONFIG_VERSION,
  DEFAULT_SETTINGS,
  DEFAULT_DASHBOARD_SECONDS,
  defaultConfig,
  normalize,
  load,
  save,
  exists,
  makeId,
  rotationList,
  findDashboard,
  currentRotationDashboard,
  nextInRotation
};
