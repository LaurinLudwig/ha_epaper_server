"use strict";

// Setzt das Passwort fuer /admin.
//
//   node tools/set-admin-password.js "meinPasswort"
//   node tools/set-admin-password.js --entfernen
//
// Gespeichert wird nur ein scrypt-Hash mit zufaelligem Salt, nie das
// Passwort im Klartext.

const access = require("../lib/access");
const store = require("../lib/security-config");

const arg = process.argv[2];

if (!arg) {
  console.log('Aufruf: node tools/set-admin-password.js "passwort"');
  console.log("        node tools/set-admin-password.js --entfernen");
  process.exit(1);
}

const config = store.load();

if (arg === "--entfernen") {
  config.adminPassword = null;
  store.save(config);
  console.log("Passwort entfernt - /admin ist wieder ohne Anmeldung erreichbar.");
  process.exit(0);
}

if (arg.length < 6) {
  console.error("Passwort ist zu kurz (mindestens 6 Zeichen).");
  process.exit(1);
}

config.adminPassword = access.makePasswordRecord(arg);
store.save(config);

console.log("Passwort gesetzt. Beim nächsten Aufruf von /admin erscheint die Anmeldemaske.");
console.log("Gespeichert in " + store.FILE + " (nur Hash und Salt).");
