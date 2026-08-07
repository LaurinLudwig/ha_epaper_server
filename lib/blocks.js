"use strict";

const fmt = require("./format");
const { escapeHtml } = require("./html");

// Baustein-Register.
//
// Jeder Typ definiert an EINER Stelle:
//   defaults  - Startwerte fuer einen neu angelegten Baustein
//   fields    - Formularschema; daraus baut der Admin-Baukasten seine Maske
//   entities  - welche HA-Entitaeten geladen werden muessen
//   forecast  - optional: welcher Wetter-Forecast geladen werden muss
//   render    - HTML fuer das Tablet (HTML 4.01, tabellenbasiert, ohne JS)
//
// Ein neuer Bausteintyp = ein Eintrag hier. Weder Server noch Admin-UI
// muessen dafuer angefasst werden.

// Feldtypen fuer "fields": text, textarea, number, entity, select, checkbox, rows

function valueOf(states, entityId) {
  const entry = states[entityId];
  return entry && entry.ok ? entry : null;
}

function renderRowsTable(rows, states) {
  let html = "";

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const entry = valueOf(states, row.entity);

    let value = "--";
    let unit = row.unit || "";

    if (entry) {
      value = fmt.formatState(entry.state, typeof row.decimals === "number" ? row.decimals : null);

      if (!row.unit) {
        unit = entry.attributes.unit_of_measurement || "";
      }
    }

    const label = row.label || (entry && entry.attributes.friendly_name) || row.entity || "";

    html += '<div class="row">';
    html += '<div class="row-label">' + escapeHtml(label) + "</div>";
    html += '<div class="row-value">' + escapeHtml(value);

    if (unit) {
      html += ' <span class="unit">' + escapeHtml(unit) + "</span>";
    }

    html += "</div></div>";
  }

  return html;
}

const BLOCK_TYPES = {

  weather: {
    label: "Wetter",
    description: "Aktuelles Wetter mit Vorhersage-Tagen",
    defaults: { title: "", entity: "", days: 4, showPrecipitation: true },
    fields: [
      { key: "title", label: "Überschrift (leer = keine)", type: "text" },
      { key: "entity", label: "Wetter-Entität", type: "entity", domain: "weather" },
      { key: "days", label: "Vorhersage-Tage", type: "number", min: 0, max: 7 },
      { key: "showPrecipitation", label: "Niederschlag anzeigen", type: "checkbox" }
    ],
    normalize: function (block) {
      block.days = Math.max(0, Math.min(7, Number(block.days) || 0));
    },
    entities: function (block) {
      return [block.entity];
    },
    forecast: function (block) {
      return block.days > 0 && block.entity
        ? { entity: block.entity, type: "daily", days: block.days }
        : null;
    },
    render: function (block, context) {
      const entry = valueOf(context.states, block.entity);

      if (!entry) {
        return '<div class="error">Wetter nicht verfügbar<br>' +
          escapeHtml(block.entity || "keine Entität gewählt") + "</div>";
      }

      const condition = entry.state;
      const temperature = fmt.formatTemperature(entry.attributes.temperature);
      const unit = entry.attributes.temperature_unit || "°C";

      let html = '<table class="weather-top" width="100%" cellspacing="0" cellpadding="0"><tr>';
      html += '<td class="weather-badge-cell"><div class="badge">' +
        escapeHtml(fmt.getWeatherBadgeText(condition)) + "</div></td>";
      html += '<td class="weather-main-cell">';
      html += '<div class="weather-condition">' + escapeHtml(fmt.getWeatherText(condition)) + "</div>";
      html += '<div class="weather-name">' +
        escapeHtml(entry.attributes.friendly_name || block.entity) + "</div>";
      html += "</td>";
      html += '<td class="weather-temp-cell">' +
        escapeHtml(temperature === "" ? "--" : temperature + " " + unit) + "</td>";
      html += "</tr></table>";

      const forecast = context.forecasts[block.entity] || [];

      if (forecast.length > 0) {
        // Feste Spaltenbreite per <table>: kein overflow/scroll noetig, das
        // kann der Android-2.3-Browser ohnehin nicht bedienen.
        const columnWidth = Math.floor(100 / forecast.length);

        html += '<table class="forecast" width="100%" cellspacing="0" cellpadding="0"><tr>';

        for (let i = 0; i < forecast.length; i++) {
          const day = forecast[i];
          const high = fmt.formatTemperature(day.temperature);
          const low = fmt.formatTemperature(day.templow);
          const rain = block.showPrecipitation ? fmt.formatPrecipitation(day.precipitation) : "";

          html += '<td width="' + columnWidth + '%" class="forecast-day">';
          html += '<div class="forecast-weekday">' + escapeHtml(fmt.getWeekday(day.datetime)) + "</div>";
          html += '<div class="badge small">' + escapeHtml(fmt.getWeatherBadgeText(day.condition)) + "</div>";
          html += '<div class="forecast-high">' + escapeHtml(high === "" ? "--" : high + "°") + "</div>";
          html += '<div class="forecast-low">' + escapeHtml(low === "" ? "" : low + "°") + "</div>";
          html += '<div class="forecast-rain">' + escapeHtml(rain) + "</div>";
          html += "</td>";
        }

        html += "</tr></table>";
      }

      return html;
    }
  },

  sensors: {
    label: "Sensor-Liste",
    description: "Mehrere Werte untereinander, mit eigenen Bezeichnungen",
    defaults: { title: "Werte", rows: [] },
    fields: [
      { key: "title", label: "Überschrift", type: "text" },
      { key: "rows", label: "Werte", type: "rows" }
    ],
    normalize: function (block) {
      block.rows = Array.isArray(block.rows) ? block.rows.filter(function (row) {
        return row && row.entity;
      }) : [];
    },
    entities: function (block) {
      return block.rows.map(function (row) { return row.entity; });
    },
    render: function (block, context) {
      if (block.rows.length === 0) {
        return '<div class="muted">Noch keine Werte gewählt</div>';
      }

      return renderRowsTable(block.rows, context.states);
    }
  },

  bigvalue: {
    label: "Große Zahl",
    description: "Ein einzelner Wert, so groß wie möglich",
    // fill: Inhalt vertikal in der Kachel zentrieren. Sinnvoll, sobald die
    // Kachel durch einen hoeheren Nachbarn in derselben Zeile mitwaechst.
    fill: true,
    defaults: { title: "", entity: "", unit: "", decimals: 0 },
    fields: [
      { key: "title", label: "Überschrift", type: "text" },
      { key: "entity", label: "Entität", type: "entity" },
      { key: "unit", label: "Einheit (leer = aus HA)", type: "text" },
      { key: "decimals", label: "Nachkommastellen", type: "number", min: 0, max: 3 }
    ],
    normalize: function (block) {
      block.decimals = Math.max(0, Math.min(3, Number(block.decimals) || 0));
    },
    entities: function (block) {
      return [block.entity];
    },
    render: function (block, context) {
      const entry = valueOf(context.states, block.entity);

      if (!entry) {
        return '<div class="error">' + escapeHtml(block.entity || "keine Entität") + "<br>nicht verfügbar</div>";
      }

      const value = fmt.formatState(entry.state, block.decimals);
      const unit = block.unit || entry.attributes.unit_of_measurement || "";

      return '<div class="bigvalue">' + escapeHtml(value) +
        (unit ? ' <span class="unit">' + escapeHtml(unit) + "</span>" : "") + "</div>";
    }
  },

  clock: {
    label: "Uhr / Datum",
    description: "Serverzeit — aktualisiert sich mit jedem Seiten-Reload",
    defaults: { title: "", showDate: true, showTime: true },
    fields: [
      { key: "title", label: "Überschrift", type: "text" },
      { key: "showTime", label: "Uhrzeit anzeigen", type: "checkbox" },
      { key: "showDate", label: "Datum anzeigen", type: "checkbox" }
    ],
    entities: function () { return []; },
    render: function (block, context) {
      let html = "";

      if (block.showTime) {
        html += '<div class="bigvalue">' + escapeHtml(fmt.formatTime(context.now)) + "</div>";
      }

      if (block.showDate) {
        html += '<div class="clock-date">' + escapeHtml(fmt.formatDate(context.now)) + "</div>";
      }

      return html || '<div class="muted">Nichts ausgewählt</div>';
    }
  },

  text: {
    label: "Text / Notiz",
    description: "Fester Text, z. B. eine Erinnerung",
    defaults: { title: "", text: "", size: "normal" },
    fields: [
      { key: "title", label: "Überschrift", type: "text" },
      { key: "text", label: "Text", type: "textarea" },
      {
        key: "size", label: "Textgröße", type: "select",
        options: [
          { value: "normal", label: "Normal" },
          { value: "large", label: "Groß" }
        ]
      }
    ],
    entities: function () { return []; },
    render: function (block) {
      const cssClass = block.size === "large" ? "note large" : "note";
      // Zeilenumbrueche des Nutzers erhalten, ohne HTML zuzulassen.
      const safe = escapeHtml(block.text).replace(/\r?\n/g, "<br>");

      return '<div class="' + cssClass + '">' + safe + "</div>";
    }
  },

  spacer: {
    label: "Platzhalter",
    description: "Leere Fläche, um das Raster aufzufüllen",
    defaults: { title: "", text: "" },
    fields: [
      { key: "text", label: "Hinweistext (optional)", type: "text" }
    ],
    entities: function () { return []; },
    render: function (block) {
      return '<div class="muted">' + escapeHtml(block.text || "") + "</div>";
    }
  }
};

// Schema fuer die Admin-UI: alles ausser den Render-Funktionen.
function schema() {
  const out = {};

  for (const type in BLOCK_TYPES) {
    const definition = BLOCK_TYPES[type];

    out[type] = {
      type: type,
      label: definition.label,
      description: definition.description || "",
      defaults: definition.defaults || {},
      fields: definition.fields || []
    };
  }

  return out;
}

module.exports = { BLOCK_TYPES, schema };
