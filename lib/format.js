"use strict";

// Alle Formatierungen passieren serverseitig. Der Browser des Tablets
// (Android 2.3.4 / WebKit 533.1) hat keine brauchbare Intl-Unterstuetzung.

// Zeitzone kommt aus den Einstellungen, NICHT vom Betriebssystem. Der Server
// laeuft typischerweise auf UTC; ohne das hier zeigt das Dashboard im Sommer
// zwei Stunden zu wenig. Als Einstellung bleibt es auch dann richtig, wenn der
// Host neu aufgesetzt oder die Anzeige woanders betrieben wird.
let timeZone = "Europe/Berlin";
let partsFormatter = null;

// Deutsche Kurznamen selbst abbilden: die Locale-Ausgabe schwankt je nach
// ICU-Version zwischen "Do" und "Do." - das waere auf dem Panel sichtbar.
const WEEKDAY_NAMES = {
  Sun: "So", Mon: "Mo", Tue: "Di", Wed: "Mi", Thu: "Do", Fri: "Fr", Sat: "Sa"
};

function setTimezone(name) {
  if (!name || name === timeZone) {
    return;
  }

  try {
    // Wirft bei unbekanntem Namen - so faellt ein Tippfehler sofort auf,
    // statt still die falsche Zeit anzuzeigen.
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    timeZone = name;
    partsFormatter = null;
  } catch (err) {
    console.error("Unbekannte Zeitzone '" + name + "' - bleibe bei " + timeZone);
  }
}

function getTimezone() {
  return timeZone;
}

// Zerlegt ein Date in die Bestandteile der eingestellten Zeitzone.
function zoned(date) {
  if (!partsFormatter) {
    partsFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
  }

  const out = {};

  partsFormatter.formatToParts(date).forEach(function (part) {
    out[part.type] = part.value;
  });

  return out;
}

const WEATHER_TEXT = {
  "sunny": "Sonnig",
  "clear-night": "Klare Nacht",
  "cloudy": "Bewölkt",
  "partlycloudy": "Teils bewölkt",
  "rainy": "Regnerisch",
  "pouring": "Starker Regen",
  "lightning": "Gewitter",
  "lightning-rainy": "Gewitterregen",
  "snowy": "Schnee",
  "snowy-rainy": "Schneeregen",
  "fog": "Nebel",
  "hail": "Hagel",
  "windy": "Windig",
  "windy-variant": "Windig bewölkt",
  "exceptional": "Außergewöhnlich"
};

const WEATHER_BADGE = {
  "sunny": "SONNE",
  "clear-night": "NACHT",
  "cloudy": "WOLKEN",
  "partlycloudy": "TEILW.",
  "rainy": "REGEN",
  "pouring": "STARK",
  "lightning": "GEWITTER",
  "lightning-rainy": "GEWITTER",
  "snowy": "SCHNEE",
  "snowy-rainy": "SCHNEE",
  "fog": "NEBEL",
  "hail": "HAGEL",
  "windy": "WIND",
  "windy-variant": "WIND",
  "exceptional": "EXTREM"
};

function isBlank(value) {
  return value === null || value === undefined || value === "";
}

function isUnavailable(value) {
  return value === "unknown" || value === "unavailable" || value === "none";
}

// Zahl mit fester Nachkommastelle, sonst Rohtext. decimals === null => automatisch.
function formatState(rawState, decimals) {
  if (isBlank(rawState) || isUnavailable(rawState)) {
    return "--";
  }

  const number = Number(rawState);

  if (isNaN(number)) {
    return String(rawState);
  }

  if (typeof decimals === "number" && decimals >= 0) {
    return number.toFixed(decimals);
  }

  if (Math.abs(number - Math.round(number)) < 0.001) {
    return String(Math.round(number));
  }

  return number.toFixed(2);
}

function formatTemperature(value) {
  if (isBlank(value)) {
    return "";
  }

  const number = Number(value);

  if (isNaN(number)) {
    return String(value);
  }

  return String(Math.round(number));
}

// Niederschlag in mm. Der genutzte Forecast-Provider liefert "precipitation",
// NICHT "precipitation_probability" - siehe /api/services/weather/get_forecasts.
function formatPrecipitation(value) {
  if (isBlank(value)) {
    return "";
  }

  const number = Number(value);

  if (isNaN(number) || number <= 0) {
    return "";
  }

  return (number < 1 ? number.toFixed(1) : String(Math.round(number))) + " mm";
}

function pad2(value) {
  return value < 10 ? "0" + value : String(value);
}

function formatTime(date) {
  const p = zoned(date);
  return p.hour + ":" + p.minute;
}

function formatTimeWithSeconds(date) {
  const p = zoned(date);
  return p.hour + ":" + p.minute + ":" + p.second;
}

function formatDate(date) {
  const p = zoned(date);
  return WEEKDAY_NAMES[p.weekday] + ", " + p.day + "." + p.month + "." + p.year;
}

function formatDateTime(isoString) {
  if (!isoString) {
    return "--";
  }

  const date = new Date(isoString);

  if (isNaN(date.getTime())) {
    return String(isoString);
  }

  const p = zoned(date);
  return p.day + "." + p.month + "." + p.year + " " +
    p.hour + ":" + p.minute + ":" + p.second;
}

// Wichtig fuer die Vorhersage: die Zeitstempel kommen als UTC-ISO an. Ohne
// Umrechnung faellt ein Tag, der um 23:00 UTC beginnt, auf den Vortag.
function getWeekday(isoString) {
  const date = new Date(isoString);
  return isNaN(date.getTime()) ? "" : WEEKDAY_NAMES[zoned(date).weekday];
}

function getWeatherText(condition) {
  return WEATHER_TEXT[condition] || condition || "Unbekannt";
}

function getWeatherBadgeText(condition) {
  return WEATHER_BADGE[condition] || "WETTER";
}

module.exports = {
  setTimezone,
  getTimezone,
  isBlank,
  isUnavailable,
  formatState,
  formatTemperature,
  formatPrecipitation,
  pad2,
  formatTime,
  formatTimeWithSeconds,
  formatDate,
  formatDateTime,
  getWeekday,
  getWeatherText,
  getWeatherBadgeText
};
