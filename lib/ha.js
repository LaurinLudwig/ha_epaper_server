"use strict";

const http = require("http");
const https = require("https");

// Home-Assistant-Client mit drei Eigenschaften, die ein Wandpanel braucht:
//  1. harte Timeouts (haengt HA, haengt sonst der Request ewig)
//  2. Cache, damit Tablet + Admin-Vorschau HA nicht doppelt belasten
//  3. "last known good": faellt HA aus, zeigen wir alte Werte mit Zeitstempel
//     statt einer Fehlerseite. Fuer ein Display ist ein alter Wert brauchbarer
//     als gar keiner.

const REQUEST_TIMEOUT_MS = 8000;
const STATE_TTL_MS = 15000;
const FORECAST_TTL_MS = 300000;
const ALL_STATES_TTL_MS = 60000;

let baseUrl = "";
let token = "";

const cache = Object.create(null);

function configure(options) {
  baseUrl = options.url;
  token = options.token;
}

function request(method, pathAndQuery, bodyObject, callback) {
  let url;

  try {
    url = new URL(baseUrl + pathAndQuery);
  } catch (err) {
    callback(new Error("Ungültige HA-URL: " + err.message));
    return;
  }

  const client = url.protocol === "https:" ? https : http;
  const body = bodyObject ? JSON.stringify(bodyObject) : "";

  const headers = {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json"
  };

  if (body) {
    headers["Content-Length"] = Buffer.byteLength(body);
  }

  let settled = false;

  function done(err, data) {
    if (settled) {
      return;
    }
    settled = true;
    callback(err, data);
  }

  const req = client.request({
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method: method,
    headers: headers
  }, function (res) {
    let responseBody = "";

    res.setEncoding("utf8");
    res.on("data", function (chunk) { responseBody += chunk; });

    res.on("end", function () {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        done(new Error("HTTP " + res.statusCode));
        return;
      }

      try {
        done(null, JSON.parse(responseBody));
      } catch (err) {
        done(new Error("Antwort ist kein JSON"));
      }
    });
  });

  req.on("error", function (err) {
    done(new Error(err.message));
  });

  // setTimeout allein bricht den Request nicht ab - destroy() ist noetig.
  req.setTimeout(REQUEST_TIMEOUT_MS, function () {
    req.destroy();
    done(new Error("Zeitüberschreitung nach " + (REQUEST_TIMEOUT_MS / 1000) + "s"));
  });

  if (body) {
    req.write(body);
  }

  req.end();
}

// Holt einen Wert durch den Cache. Bei Fehler wird der letzte gute Wert
// zurueckgegeben und als "stale" markiert.
function cached(key, ttlMs, loader, callback) {
  const now = Date.now();
  const entry = cache[key];

  if (entry && entry.value !== undefined && (now - entry.fetchedAt) < ttlMs) {
    callback(null, entry.value, { stale: false, fetchedAt: entry.fetchedAt });
    return;
  }

  if (entry && entry.pending) {
    entry.waiting.push(callback);
    return;
  }

  const pendingEntry = entry || (cache[key] = { value: undefined, fetchedAt: 0 });
  pendingEntry.pending = true;
  pendingEntry.waiting = pendingEntry.waiting || [];

  loader(function (err, value) {
    pendingEntry.pending = false;

    const waiting = pendingEntry.waiting;
    pendingEntry.waiting = [];

    let result, meta;

    if (err) {
      pendingEntry.lastError = err.message;

      if (pendingEntry.value !== undefined) {
        result = [null, pendingEntry.value, { stale: true, fetchedAt: pendingEntry.fetchedAt, error: err.message }];
      } else {
        result = [err, undefined, { stale: true, error: err.message }];
      }
    } else {
      pendingEntry.value = value;
      pendingEntry.fetchedAt = Date.now();
      pendingEntry.lastError = null;
      result = [null, value, { stale: false, fetchedAt: pendingEntry.fetchedAt }];
    }

    callback(result[0], result[1], result[2]);

    for (let i = 0; i < waiting.length; i++) {
      waiting[i](result[0], result[1], result[2]);
    }
  });
}

function getState(entityId, callback) {
  cached("state:" + entityId, STATE_TTL_MS, function (done) {
    request("GET", "/api/states/" + encodeURIComponent(entityId), null, done);
  }, callback);
}

function getForecast(entityId, type, callback) {
  cached("forecast:" + entityId + ":" + type, FORECAST_TTL_MS, function (done) {
    request("POST", "/api/services/weather/get_forecasts?return_response", {
      entity_id: entityId,
      type: type
    }, done);
  }, callback);
}

// Vollabzug aller Entitaeten - nur fuer den Entitaets-Picker im Admin.
// Fuer das Rendering waere das Verschwendung (~220 KB), dort holen wir gezielt.
function getAllStates(callback) {
  cached("allStates", ALL_STATES_TTL_MS, function (done) {
    request("GET", "/api/states", null, done);
  }, callback);
}

// Mehrere Entitaeten parallel. Liefert immer eine Map, nie einen Fehler -
// fehlende Entitaeten stehen als { ok: false } drin.
function getStates(entityIds, callback) {
  const unique = [];

  for (let i = 0; i < entityIds.length; i++) {
    if (entityIds[i] && unique.indexOf(entityIds[i]) === -1) {
      unique.push(entityIds[i]);
    }
  }

  const result = Object.create(null);

  if (unique.length === 0) {
    callback(result);
    return;
  }

  let remaining = unique.length;

  unique.forEach(function (entityId) {
    getState(entityId, function (err, data, meta) {
      if (err || !data) {
        result[entityId] = { ok: false, error: err ? err.message : "Keine Daten" };
      } else {
        result[entityId] = {
          ok: true,
          state: data.state,
          attributes: data.attributes || {},
          stale: meta.stale,
          fetchedAt: meta.fetchedAt
        };
      }

      remaining--;

      if (remaining === 0) {
        callback(result);
      }
    });
  });
}

function getForecastList(entityId, type, days, callback) {
  getForecast(entityId, type, function (err, data, meta) {
    if (err || !data) {
      callback([], meta || {});
      return;
    }

    const source = data.service_response || data;
    const entry = source && source[entityId];
    const list = (entry && entry.forecast) || [];

    callback(list.slice(0, days), meta);
  });
}

module.exports = {
  configure,
  request,
  getState,
  getStates,
  getAllStates,
  getForecastList
};
