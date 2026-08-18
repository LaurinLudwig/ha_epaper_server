"use strict";

const crypto = require("crypto");

// Zugriffskontrolle in zwei getrennten Schichten:
//
//   DASHBOARD (/, /d/<id>, /action, tablet.css) -> IP-Whitelist
//     Der Tolino kann kein Passwort eingeben. Er wird ueber seine feste
//     Adresse erkannt.
//
//   BAUKASTEN (/admin, /api/*) -> Anmeldung mit Passwort
//     Hier sitzt ein normaler Browser davor, der eine Maske anzeigen kann.
//
// Die IP-Whitelist ist bewusst KEIN Ersatz fuer echte Authentifizierung:
// im selben LAN laesst sich eine IP faelschen oder uebernehmen. Sie hebt die
// Huerde deutlich und schuetzt vor allem gegen Gaeste und Zufallszugriffe -
// mehr soll sie nicht leisten.

// --- IP-Normalisierung -----------------------------------------------------

// Node liefert IPv4 oft als "::ffff:192.168.178.62" (IPv4-mapped IPv6).
// Ohne dieses Abschneiden schlaegt jeder Stringvergleich fehl.
function normalizeIp(address) {
  if (!address) {
    return "";
  }

  let ip = String(address);

  if (ip.indexOf("::ffff:") === 0) {
    ip = ip.slice(7);
  }

  // IPv6-Loopback und IPv4-Loopback gleich behandeln.
  if (ip === "::1") {
    ip = "127.0.0.1";
  }

  return ip;
}

function ipToLong(ip) {
  const parts = ip.split(".");

  if (parts.length !== 4) {
    return null;
  }

  let value = 0;

  for (let i = 0; i < 4; i++) {
    const octet = Number(parts[i]);

    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      return null;
    }

    value = (value * 256) + octet;
  }

  return value;
}

// Unterstuetzt einzelne Adressen ("192.168.178.62") und CIDR-Bereiche
// ("192.168.178.0/24").
function matchesRule(ip, rule) {
  const clean = String(rule || "").trim();

  if (!clean) {
    return false;
  }

  const slash = clean.indexOf("/");

  if (slash === -1) {
    return ip === clean;
  }

  const network = ipToLong(clean.slice(0, slash));
  const bits = Number(clean.slice(slash + 1));
  const address = ipToLong(ip);

  if (network === null || address === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }

  if (bits === 0) {
    return true;
  }

  // >>> 0 haelt das Ergebnis vorzeichenlos - sonst kippt das oberste Bit.
  const mask = (0xffffffff << (32 - bits)) >>> 0;

  return ((network & mask) >>> 0) === ((address & mask) >>> 0);
}

function isAllowedIp(address, rules) {
  const ip = normalizeIp(address);

  // Leere Liste = Filter aus. Sonst wuerde eine unvollstaendige Konfiguration
  // den Nutzer aus seinem eigenen Panel aussperren.
  if (!Array.isArray(rules) || rules.length === 0) {
    return true;
  }

  for (let i = 0; i < rules.length; i++) {
    if (matchesRule(ip, rules[i])) {
      return true;
    }
  }

  return false;
}

// --- Anmeldung fuer den Baukasten ------------------------------------------

// Sitzungen nur im Speicher: nach einem Neustart muss man sich neu anmelden.
// Fuer ein Heimnetz-Panel voellig ausreichend und spart eine Datei, in der
// sonst Sitzungsschluessel liegen wuerden.
const sessions = Object.create(null);

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_NAME = "epaper_admin";

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString("hex");
}

// Zeitkonstanter Vergleich: ein einfaches === wuerde ueber die Laufzeit
// verraten, wie viele Zeichen des Passworts stimmen.
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));

  if (bufA.length !== bufB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

function checkPassword(password, stored) {
  if (!stored || !stored.hash || !stored.salt) {
    return false;
  }

  return safeEqual(hashPassword(password, stored.salt), stored.hash);
}

function makePasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");

  return { salt: salt, hash: hashPassword(password, salt) };
}

function createSession() {
  const token = crypto.randomBytes(32).toString("hex");

  sessions[token] = Date.now() + SESSION_TTL_MS;

  return token;
}

function parseCookies(header) {
  const out = Object.create(null);

  String(header || "").split(";").forEach(function (part) {
    const eq = part.indexOf("=");

    if (eq > 0) {
      out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    }
  });

  return out;
}

function hasValidSession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];

  if (!token || !sessions[token]) {
    return false;
  }

  if (sessions[token] < Date.now()) {
    delete sessions[token];
    return false;
  }

  return true;
}

function destroySession(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];

  if (token) {
    delete sessions[token];
  }
}

function sessionCookie(token) {
  // HttpOnly: kein Zugriff aus JavaScript. Kein "Secure", weil das Panel
  // ueber http im LAN laeuft - mit Secure wuerde der Cookie nie gesetzt.
  return COOKIE_NAME + "=" + token +
    "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + Math.floor(SESSION_TTL_MS / 1000);
}

function clearCookie() {
  return COOKIE_NAME + "=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

module.exports = {
  COOKIE_NAME,
  normalizeIp,
  matchesRule,
  isAllowedIp,
  makePasswordRecord,
  checkPassword,
  createSession,
  hasValidSession,
  destroySession,
  sessionCookie,
  clearCookie
};
