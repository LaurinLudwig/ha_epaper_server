"use strict";

const ha = require("./ha");
const configStore = require("./config");
const fmt = require("./format");
const { BLOCK_TYPES } = require("./blocks");
const { escapeHtml } = require("./html");

// Zaehler fuer den Cache-Buster der Refresh-URL. Der Android-Browser cacht
// aggressiv; ohne wechselnde URL kann er dieselbe Seite ewig wiederverwenden.
let refreshCounter = 0;

// Verteilt Bausteine auf Tabellenzeilen. Raster = 2 Einheiten breit,
// "half" = 1 Einheit, "full" = 2 Einheiten.
function packRows(blocks) {
  const rows = [];
  let current = [];
  let used = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const size = block.width === "half" ? 1 : 2;

    if (used + size > 2) {
      rows.push(current);
      current = [];
      used = 0;
    }

    current.push(block);
    used += size;

    if (used === 2) {
      rows.push(current);
      current = [];
      used = 0;
    }
  }

  if (current.length > 0) {
    rows.push(current);
  }

  return rows;
}

// Sammelt alle Daten, die die konfigurierten Bausteine brauchen, und ruft
// dann den Callback. Ein Baustein ohne Datenbedarf kostet keinen Request.
function collectData(dashboard, callback) {
  const entityIds = [];
  const forecastRequests = [];

  dashboard.blocks.forEach(function (block) {
    const definition = BLOCK_TYPES[block.type];

    if (!definition) {
      return;
    }

    if (typeof definition.entities === "function") {
      definition.entities(block).forEach(function (id) {
        if (id) {
          entityIds.push(id);
        }
      });
    }

    if (typeof definition.forecast === "function") {
      const request = definition.forecast(block);

      if (request) {
        forecastRequests.push(request);
      }
    }
  });

  ha.getStates(entityIds, function (states) {
    const forecasts = Object.create(null);

    if (forecastRequests.length === 0) {
      callback({ states: states, forecasts: forecasts });
      return;
    }

    let remaining = forecastRequests.length;

    forecastRequests.forEach(function (request) {
      ha.getForecastList(request.entity, request.type, request.days, function (list) {
        forecasts[request.entity] = list;
        remaining--;

        if (remaining === 0) {
          callback({ states: states, forecasts: forecasts });
        }
      });
    });
  });
}

function renderBlockTitle(block) {
  return block.title
    ? '<div class="block-title">' + escapeHtml(block.title) + "</div>"
    : "";
}

function renderBlockBody(block, context) {
  const definition = BLOCK_TYPES[block.type];

  if (!definition) {
    return '<div class="error">Unbekannter Bausteintyp: ' + escapeHtml(block.type) + "</div>";
  }

  try {
    return definition.render(block, context);
  } catch (err) {
    // Ein kaputter Baustein darf nie die ganze Seite mitnehmen.
    return '<div class="error">Fehler: ' + escapeHtml(err.message) + "</div>";
  }
}

function renderGrid(dashboard, context) {
  const rows = packRows(dashboard.blocks);

  if (rows.length === 0) {
    return '<table class="grid" width="100%" cellspacing="0" cellpadding="0"><tr>' +
      '<td class="tile-body" colspan="3"><div class="muted">Noch keine Bausteine. ' +
      'Im Baukasten unter /admin anlegen.</div></td></tr></table>';
  }

  // Jede Baustein-Zeile wird als ZWEI Tabellenzeilen ausgegeben: eine fuer die
  // Titel, eine fuer die Inhalte. Das loest drei Dinge auf einmal, allein mit
  // nativer Tabellenmechanik und ohne eine einzige Prozenthoehe:
  //
  //   - Titel benachbarter Kacheln stehen automatisch auf gleicher Hoehe
  //   - Inhaltszellen einer Zeile sind automatisch gleich hoch
  //   - valign an der Inhaltszelle zentriert den Wert im verbleibenden Platz,
  //     ohne den Titel mitzuziehen - der sitzt ja in der Zeile darueber
  //
  // Die Kachel sieht trotzdem wie ein Kasten aus: die Titelzelle traegt den
  // Rahmen ohne Unterkante, die Inhaltszelle ohne Oberkante. Bei cellspacing=0
  // stossen beide nahtlos aneinander.
  //
  // Spaltenraster: 49% | 2% Luecke | 49%. Volle Bausteine nehmen colspan=3.
  let html = '<table class="grid" width="100%" cellspacing="0" cellpadding="0">';

  function cells(row, renderCell) {
    let out = "";

    row.forEach(function (block, index) {
      if (index > 0) {
        out += '<td class="colgap"></td>';
      }

      const isHalf = block.width === "half";
      const attributes = isHalf ? ' width="49%"' : ' width="100%" colspan="3"';

      out += renderCell(block, attributes);
    });

    // Zeile mit nur einem halben Baustein braucht eine leere zweite Spalte,
    // sonst zieht der Browser die Kachel auf volle Breite. Ohne Klasse,
    // damit sie keinen Rahmen bekommt.
    if (row.length === 1 && row[0].width === "half") {
      out += '<td class="colgap"></td><td width="49%"></td>';
    }

    return out;
  }

  rows.forEach(function (row, rowIndex) {
    if (rowIndex > 0) {
      // Abstand zwischen zwei Kachelzeilen. Das &nbsp; ist noetig, weil alte
      // Browser voellig leere Zellen zusammenfallen lassen.
      html += '<tr><td class="rowgap" colspan="3">&nbsp;</td></tr>';
    }

    html += "<tr>" + cells(row, function (block, attributes) {
      return '<td class="tile-title"' + attributes + ' valign="bottom">' +
        renderBlockTitle(block) + "</td>";
    }) + "</tr>";

    html += "<tr>" + cells(row, function (block, attributes) {
      const definition = BLOCK_TYPES[block.type];
      const valign = definition && definition.fill ? "middle" : "top";

      return '<td class="tile-body"' + attributes + ' valign="' + valign + '">' +
        renderBlockBody(block, context) + "</td>";
    }) + "</tr>";
  });

  return html + "</table>";
}

function renderFooter(config, context) {
  if (!config.settings.showFooter) {
    return "";
  }

  let stale = 0;
  let failed = 0;

  for (const id in context.states) {
    const entry = context.states[id];

    if (!entry.ok) {
      failed++;
    } else if (entry.stale) {
      stale++;
    }
  }

  let text = "Stand " + fmt.formatTimeWithSeconds(context.now);

  if (failed > 0) {
    text += " · " + failed + " Entität" + (failed === 1 ? "" : "en") + " nicht erreichbar";
  }

  if (stale > 0) {
    text += " · " + stale + " veraltet";
  }

  return '<div class="foot">' + escapeHtml(text) + "</div>";
}

function renderPage(config, context, options) {
  const settings = config.settings;
  const opts = options || {};

  refreshCounter++;

  const viewport = settings.deviceDpi
    ? "width=device-width, target-densitydpi=device-dpi"
    : "width=device-width";

  let head = "";

  // HTML 4.01 Transitional: das versteht WebKit 533.1 vollstaendig.
  head += '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" ' +
    '"http://www.w3.org/TR/html4/loose.dtd">\n';
  head += "<html>\n<head>\n";
  head += '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n';
  head += '<meta http-equiv="Pragma" content="no-cache">\n';
  head += '<meta http-equiv="Cache-Control" content="no-cache">\n';
  head += '<meta name="viewport" content="' + viewport + '">\n';

  // Reload auf eine jedes Mal andere URL - sonst liefert der Browser-Cache
  // dieselbe Seite zurueck und das Panel friert ein.
  //
  // Die Wartezeit ist die Anzeigedauer des GERADE gezeigten Dashboards, das
  // Ziel das naechste in der Rotation. Dadurch steht ein per Button
  // aufgerufenes Dashboard seine volle Dauer, bevor es weitergeht - sonst
  // waere es je nach Zeitpunkt sofort wieder weg.
  if (!opts.noRefresh) {
    const next = context.nextDashboard || context.dashboard;

    head += '<meta http-equiv="refresh" content="' + context.dashboard.seconds +
      "; url=/d/" + encodeURIComponent(next.id) + "?t=" + refreshCounter + '">\n';
  }

  head += "<title>" + escapeHtml(settings.title) + "</title>\n";
  head += '<link rel="stylesheet" href="/tablet.css?v=10">\n';

  // Nur die aus den Einstellungen berechneten Werte inline - der Rest
  // bleibt in der statischen CSS-Datei.
  head += "<style type=\"text/css\">\n";
  head += "body { font-size: " + settings.baseFontSize + "px; }\n";

  if (settings.contentWidth > 0) {
    head += ".grid { width: " + settings.contentWidth + "px; }\n";
  }

  head += "</style>\n</head>\n";

  let body = "<body>\n";
  body += renderGrid(context.dashboard, context);
  body += renderFooter(config, context);
  body += "\n</body>\n</html>";

  return head + body;
}

// options.dashboardId waehlt ein bestimmtes Dashboard; ohne Angabe
// entscheidet die zustandslose Rotation anhand der Uhrzeit.
function render(config, options, callback) {
  const opts = options || {};

  // Vor jedem Rendern setzen: die Konfiguration wird pro Request neu gelesen,
  // eine Aenderung im Baukasten wirkt damit sofort.
  fmt.setTimezone(config.settings.timezone);

  const dashboard = (opts.dashboardId && configStore.findDashboard(config, opts.dashboardId)) ||
    configStore.currentRotationDashboard(config, Date.now());

  collectData(dashboard, function (data) {
    const context = {
      states: data.states,
      forecasts: data.forecasts,
      now: new Date(),
      dashboard: dashboard,
      nextDashboard: configStore.nextInRotation(config, dashboard),
      // Vorschau im Baukasten: Buttons werden dargestellt, sind aber inaktiv.
      preview: opts.noRefresh === true,
      // Der nav-Baustein braucht die Liste aller Dashboards.
      dashboards: config.dashboards
    };

    callback(renderPage(config, context, options));
  });
}

module.exports = { render, packRows };
