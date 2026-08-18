"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ha = require("./lib/ha");
const configStore = require("./lib/config");
const render = require("./lib/render");
const diag = require("./lib/diag");
const { BLOCK_TYPES, schema } = require("./lib/blocks");

const PORT = Number(process.env.PORT) || 8080;
const HA_URL = process.env.HA_URL || "http://192.168.178.5:8123";

const TOKEN_FILE = path.join(__dirname, "ha-token.txt");
const PUBLIC_DIR = path.join(__dirname, "public");

let HA_TOKEN = "";

try {
  HA_TOKEN = fs.readFileSync(TOKEN_FILE, "utf8").trim();

  if (!HA_TOKEN) {
    throw new Error("Token-Datei ist leer");
  }
} catch (err) {
  console.error("Fehler beim Lesen von ha-token.txt:");
  console.error(err.message);
  process.exit(1);
}

ha.configure({ url: HA_URL, token: HA_TOKEN });

// dashboard.json wird bei jedem Request frisch gelesen. Die Datei ist winzig,
// dafuer wirken Aenderungen sofort - auch wenn sie von Hand editiert wurde.
function currentConfig() {
  return configStore.load(BLOCK_TYPES);
}

const STATIC_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".html": "text/html; charset=utf-8"
};

// Der Android-Browser cacht sehr aggressiv. Ohne diese Header zeigt das
// Panel irgendwann dauerhaft dieselbe Seite.
function noCacheHeaders(contentType) {
  return {
    "Content-Type": contentType,
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0"
  };
}

function sendText(res, status, contentType, body) {
  res.writeHead(status, noCacheHeaders(contentType));
  res.end(body);
}

function sendJson(res, status, payload) {
  sendText(res, status, "application/json; charset=utf-8", JSON.stringify(payload));
}

function serveStatic(res, urlPath) {
  const name = path.basename(urlPath);
  const file = path.join(PUBLIC_DIR, name);

  // basename() allein verhindert schon ".." - der Vergleich ist die zweite Sperre.
  if (path.dirname(file) !== PUBLIC_DIR) {
    sendText(res, 403, "text/plain; charset=utf-8", "Verboten");
    return;
  }

  fs.readFile(file, function (err, content) {
    if (err) {
      sendText(res, 404, "text/plain; charset=utf-8", "Nicht gefunden: " + name);
      return;
    }

    const type = STATIC_TYPES[path.extname(name)] || "application/octet-stream";
    res.writeHead(200, noCacheHeaders(type));
    res.end(content);
  });
}

function readBody(req, limitBytes, callback) {
  let body = "";
  let aborted = false;

  req.on("data", function (chunk) {
    if (aborted) {
      return;
    }

    body += chunk;

    if (body.length > limitBytes) {
      aborted = true;
      callback(new Error("Anfrage zu groß"));
      req.destroy();
    }
  });

  req.on("end", function () {
    if (!aborted) {
      callback(null, body);
    }
  });
}

const server = http.createServer(function (req, res) {
  let url;

  try {
    url = new URL(req.url, "http://localhost");
  } catch (err) {
    sendText(res, 400, "text/plain; charset=utf-8", "Ungültige Anfrage");
    return;
  }

  const route = url.pathname;

  // --- Tablet-Seite -------------------------------------------------------

  // Rotation: welches Dashboard faellig ist, entscheidet die Uhrzeit.
  if (route === "/" || route === "/tablet") {
    render.render(currentConfig(), {}, function (html) {
      sendText(res, 200, "text/html; charset=utf-8", html);
    });
    return;
  }

  // Ein bestimmtes Dashboard, per Nav-Button aufgerufen. Die Rotation laeuft
  // ab hier weiter - der Meta-Refresh zeigt auf den Nachfolger.
  if (route.indexOf("/d/") === 0) {
    const wanted = decodeURIComponent(route.slice(3));
    const config = currentConfig();

    if (!configStore.findDashboard(config, wanted)) {
      sendText(res, 404, "text/plain; charset=utf-8", "Unbekanntes Dashboard");
      return;
    }

    render.render(config, { dashboardId: wanted }, function (html) {
      sendText(res, 200, "text/html; charset=utf-8", html);
    });
    return;
  }

  // Vorschau fuer den Baukasten: gleiches HTML, aber ohne Selbst-Reload,
  // damit das iframe im Admin nicht dauernd neu laedt.
  //
  // GET  = gespeicherter Stand
  // POST = ungespeicherter Entwurf aus dem Baukasten. So laesst sich jede
  //        Aenderung ansehen, ohne sie vorher festzuschreiben.
  if (route === "/preview") {
    if (req.method === "POST") {
      readBody(req, 512 * 1024, function (err, body) {
        if (err) {
          sendText(res, 413, "text/plain; charset=utf-8", err.message);
          return;
        }

        let draft;

        try {
          draft = configStore.normalize(JSON.parse(body), BLOCK_TYPES);
        } catch (parseErr) {
          sendText(res, 400, "text/html; charset=utf-8",
            "<p>Entwurf nicht lesbar: " + parseErr.message + "</p>");
          return;
        }

        render.render(draft, {
          noRefresh: true,
          dashboardId: url.searchParams.get("d")
        }, function (html) {
          sendText(res, 200, "text/html; charset=utf-8", html);
        });
      });
      return;
    }

    render.render(currentConfig(), {
      noRefresh: true,
      dashboardId: url.searchParams.get("d")
    }, function (html) {
      sendText(res, 200, "text/html; charset=utf-8", html);
    });
    return;
  }

  // --- Diagnose -----------------------------------------------------------

  if (route === "/diag") {
    sendText(res, 200, "text/html; charset=utf-8",
      diag.renderPage({ deviceDpi: url.searchParams.get("dpi") !== "off" }));
    return;
  }

  if (route === "/diag/report") {
    diag.handleReport(req, res, url.searchParams);
    return;
  }

  if (route === "/diag/result") {
    fs.readFile(diag.REPORT_FILE, "utf8", function (err, text) {
      sendJson(res, 200, err ? { reports: [] } : { reports: JSON.parse(text) });
    });
    return;
  }

  // --- Baukasten ----------------------------------------------------------

  if (route === "/admin") {
    serveStatic(res, "admin.html");
    return;
  }

  if (route === "/api/schema") {
    sendJson(res, 200, {
      blockTypes: schema(),
      defaultSettings: configStore.DEFAULT_SETTINGS
    });
    return;
  }

  if (route === "/api/config") {
    if (req.method === "GET") {
      sendJson(res, 200, currentConfig());
      return;
    }

    if (req.method === "POST") {
      readBody(req, 512 * 1024, function (err, body) {
        if (err) {
          sendJson(res, 413, { error: err.message });
          return;
        }

        let incoming;

        try {
          incoming = JSON.parse(body);
        } catch (parseErr) {
          sendJson(res, 400, { error: "Ungültiges JSON: " + parseErr.message });
          return;
        }

        try {
          const saved = configStore.save(incoming, BLOCK_TYPES);
          const blockCount = saved.dashboards.reduce(function (sum, d) {
            return sum + d.blocks.length;
          }, 0);
          console.log("Konfiguration gespeichert (" + saved.dashboards.length +
            " Dashboards, " + blockCount + " Bausteine)");
          sendJson(res, 200, saved);
        } catch (saveErr) {
          console.error("Speichern fehlgeschlagen:", saveErr.message);
          sendJson(res, 500, { error: saveErr.message });
        }
      });
      return;
    }

    sendJson(res, 405, { error: "Methode nicht erlaubt" });
    return;
  }

  // Entitaetsliste fuer den Picker - auf das Noetige eingedampft,
  // damit statt ~220 KB nur wenige KB zum Browser gehen.
  if (route === "/api/entities") {
    ha.getAllStates(function (err, states, meta) {
      if (err || !states) {
        sendJson(res, 502, { error: err ? err.message : "Keine Daten von Home Assistant" });
        return;
      }

      const list = states.map(function (entry) {
        return {
          entity_id: entry.entity_id,
          domain: entry.entity_id.split(".")[0],
          name: (entry.attributes && entry.attributes.friendly_name) || entry.entity_id,
          unit: (entry.attributes && entry.attributes.unit_of_measurement) || "",
          state: String(entry.state).slice(0, 40)
        };
      });

      list.sort(function (a, b) {
        return a.entity_id < b.entity_id ? -1 : 1;
      });

      sendJson(res, 200, { entities: list, stale: meta.stale === true });
    });
    return;
  }

  // --- Statisches ---------------------------------------------------------

  if (route === "/tablet.css" || route === "/admin.css" || route === "/admin.js") {
    serveStatic(res, route);
    return;
  }

  sendText(res, 404, "text/plain; charset=utf-8", "Nicht gefunden");
});

server.listen(PORT, "0.0.0.0", function () {
  const config = currentConfig();

  console.log("Server läuft auf http://localhost:" + PORT);
  console.log("  Tablet-Seite : /");
  console.log("  Baukasten    : /admin");
  console.log("  Diagnose     : /diag   (auf dem Tolino öffnen)");
  console.log("Home Assistant : " + HA_URL);
  console.log("Dashboards     : " + config.dashboards.length);

  config.dashboards.forEach(function (dashboard) {
    console.log("  - " + dashboard.name + " (" + dashboard.blocks.length +
      " Bausteine, " + dashboard.seconds + "s" +
      (dashboard.inRotation ? "" : ", nicht in Rotation") + ")");
  });

  if (!configStore.exists()) {
    console.log("Hinweis: dashboard.json existiert noch nicht - es gilt die " +
      "Standardkonfiguration, bis im Baukasten gespeichert wird.");
  }
});
