"use strict";

const ha = require("./ha");

// Ausfuehrung von Schaltaktionen.
//
// Zwei Schutzschichten, die verschiedene Probleme loesen:
//
// 1. WHITELIST: Nur Entitaeten, die in der Konfiguration als Schaltbaustein
//    hinterlegt sind, koennen ueberhaupt ausgeloest werden. Die Entity-ID aus
//    dem Formular wird NIE direkt an Home Assistant durchgereicht - sie muss
//    in einem Baustein stehen. Sonst koennte jeder per Hand geformtem POST
//    beliebige der 130 schaltbaren Entitaeten treffen, auch die Sirenen.
//
// 2. ZEITSPERRE: Dieselbe Aktion wird innerhalb weniger Sekunden nur einmal
//    ausgefuehrt. Faengt versehentliches Doppeltippen ab - auf E-Ink sieht man
//    den ersten Tipp erst nach dem Seitenaufbau, also tippt man leicht zweimal.
//
// Gegen die Wiederholung durch den Meta-Refresh hilft KEINE von beiden - das
// loest ausschliesslich POST + Weiterleitung in server.js (siehe /action).

const DEFAULT_LOCK_SECONDS = 5;

const lastRun = Object.create(null);

// Welche Services ein Bausteintyp ausloesen darf. Bewusst eine feste Liste
// statt frei konfigurierbarer Services: so kann eine kaputte oder manipulierte
// dashboard.json nichts ausloesen, was hier nicht steht.
const TOGGLE_DOMAINS = ["switch", "light", "fan", "input_boolean"];
const TRIGGER_DOMAINS = ["button", "scene", "script", "input_button"];

function domainOf(entityId) {
  return String(entityId || "").split(".")[0];
}

// Sammelt alle Entitaeten, die laut Konfiguration schaltbar sind.
// Das ist die Whitelist - sie entsteht aus den Bausteinen selbst.
function allowedActions(config) {
  const allowed = Object.create(null);

  config.dashboards.forEach(function (dashboard) {
    dashboard.blocks.forEach(function (block) {
      if (block.type !== "action" || !block.entity) {
        return;
      }

      allowed[block.entity] = {
        entity: block.entity,
        mode: block.mode === "trigger" ? "trigger" : "toggle",
        lockSeconds: Math.max(0, Number(block.lockSeconds) || DEFAULT_LOCK_SECONDS)
      };
    });
  });

  return allowed;
}

function serviceFor(entry) {
  const domain = domainOf(entry.entity);

  if (entry.mode === "trigger") {
    if (TRIGGER_DOMAINS.indexOf(domain) === -1) {
      return null;
    }

    // button/input_button kennen "press", scene "turn_on", script "turn_on".
    if (domain === "button" || domain === "input_button") {
      return { domain: domain, service: "press" };
    }

    return { domain: domain, service: "turn_on" };
  }

  if (TOGGLE_DOMAINS.indexOf(domain) === -1) {
    return null;
  }

  return { domain: domain, service: "toggle" };
}

// callback(err, info). info.skipped === true, wenn die Zeitsperre griff.
function run(config, entityId, callback) {
  const allowed = allowedActions(config);
  const entry = allowed[entityId];

  if (!entry) {
    callback(new Error("Nicht freigegeben: " + entityId));
    return;
  }

  const service = serviceFor(entry);

  if (!service) {
    callback(new Error("Domain nicht schaltbar: " + domainOf(entityId)));
    return;
  }

  const now = Date.now();
  const previous = lastRun[entityId] || 0;

  if (entry.lockSeconds > 0 && (now - previous) < entry.lockSeconds * 1000) {
    callback(null, { skipped: true, entity: entityId });
    return;
  }

  lastRun[entityId] = now;

  ha.request("POST", "/api/services/" + service.domain + "/" + service.service,
    { entity_id: entityId }, function (err) {
      if (err) {
        // Fehlgeschlagene Aktion nicht sperren - sonst blockiert ein
        // Netzwerkaussetzer den naechsten echten Versuch.
        lastRun[entityId] = previous;
        callback(err);
        return;
      }

      callback(null, { skipped: false, entity: entityId, service: service });
    });
}

module.exports = {
  DEFAULT_LOCK_SECONDS,
  TOGGLE_DOMAINS,
  TRIGGER_DOMAINS,
  allowedActions,
  serviceFor,
  run
};
