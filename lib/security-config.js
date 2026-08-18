"use strict";

const fs = require("fs");
const path = require("path");

// Zugriffsrechte liegen BEWUSST nicht in dashboard.json:
//
//   - dashboard.json wird vom Baukasten geschrieben. Stuenden die Rechte
//     dort, koennte ein Fehler in der Oberflaeche sie ueberschreiben.
//   - dashboard.json liegt im Repository-Beispiel offen; Passwort-Hashes
//     haben dort nichts zu suchen.
//
// Diese Datei wird nur von Hand bzw. ueber tools/set-admin-password.js
// veraendert und ist per .gitignore ausgeschlossen.

const FILE = path.join(__dirname, "..", "security.json");

const DEFAULTS = {
  // Leere Liste = Filter aus (sonst wuerde eine unfertige Konfiguration
  // aussperren). Beispiel: ["192.168.178.62", "192.168.178.0/24"]
  dashboardAllow: [],
  // null = kein Passwort gesetzt, /admin bleibt offen.
  adminPassword: null
};

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));

    return {
      dashboardAllow: Array.isArray(raw.dashboardAllow)
        ? raw.dashboardAllow.map(String).filter(Boolean)
        : [],
      adminPassword: (raw.adminPassword && raw.adminPassword.hash && raw.adminPassword.salt)
        ? raw.adminPassword
        : null
    };
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error("security.json ist beschädigt, nutze offene Voreinstellung:", err.message);
    }

    return Object.assign({}, DEFAULTS);
  }
}

function save(config) {
  const temp = FILE + ".tmp";

  fs.writeFileSync(temp, JSON.stringify(config, null, 2), "utf8");
  fs.renameSync(temp, FILE);
}

function exists() {
  return fs.existsSync(FILE);
}

module.exports = { FILE, DEFAULTS, load, save, exists };
