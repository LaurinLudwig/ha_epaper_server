"use strict";

const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", "dashboard.json");
const BACKUP_FILE = path.join(__dirname, "..", "dashboard.json.bak");

const DEFAULT_SETTINGS = {
  title: "Home Dashboard",
  // Der Server laeuft meist auf UTC - ohne das zeigt die Uhr die falsche Zeit.
  timezone: "Europe/Berlin",
  refreshSeconds: 60,
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

const VALID_WIDTHS = ["full", "half"];

let idCounter = 0;

function makeId() {
  idCounter++;
  return "b" + Date.now().toString(36) + idCounter.toString(36);
}

// Startkonfiguration, wenn noch keine dashboard.json existiert. Bewusst ohne
// konkrete Entitaeten: die gibt es in einer fremden Installation nicht, das
// Panel wuerde nur Fehler anzeigen. Stattdessen ein Hinweis auf den Baukasten.
function defaultConfig() {
  return {
    version: 1,
    settings: Object.assign({}, DEFAULT_SETTINGS),
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
  };
}

// Sorgt dafuer, dass der Renderer nie auf kaputte Daten trifft - egal ob die
// Datei von Hand editiert oder von einer aelteren Version geschrieben wurde.
function normalize(raw, blockTypes) {
  const config = (raw && typeof raw === "object") ? raw : {};
  const settings = Object.assign({}, DEFAULT_SETTINGS, config.settings || {});

  settings.refreshSeconds = Math.max(5, Number(settings.refreshSeconds) || DEFAULT_SETTINGS.refreshSeconds);
  settings.baseFontSize = Math.max(10, Math.min(80, Number(settings.baseFontSize) || DEFAULT_SETTINGS.baseFontSize));
  settings.contentWidth = Math.max(0, Number(settings.contentWidth) || 0);
  settings.deviceDpi = settings.deviceDpi !== false;
  settings.showFooter = settings.showFooter !== false;
  settings.title = String(settings.title || DEFAULT_SETTINGS.title);
  settings.timezone = String(settings.timezone || DEFAULT_SETTINGS.timezone);

  const blocks = [];
  const rawBlocks = Array.isArray(config.blocks) ? config.blocks : [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const rawBlock = rawBlocks[i];

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

  return { version: 1, settings: settings, blocks: blocks };
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

module.exports = {
  CONFIG_FILE,
  DEFAULT_SETTINGS,
  defaultConfig,
  normalize,
  load,
  save,
  exists,
  makeId
};
