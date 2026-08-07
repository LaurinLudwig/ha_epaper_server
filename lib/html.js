"use strict";

const ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};

// Pflicht, sobald Texte aus HA oder aus dem Baukasten kommen. Der alte
// Android-Browser hat keine Content-Security-Policy als Rueckfallebene.
function escapeHtml(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).replace(/[&<>"']/g, function (char) {
    return ESCAPE_MAP[char];
  });
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function tag(name, attributes, content) {
  let html = "<" + name;

  if (attributes) {
    for (const key in attributes) {
      const value = attributes[key];

      if (value !== null && value !== undefined && value !== false) {
        html += " " + key + '="' + escapeAttr(value) + '"';
      }
    }
  }

  html += ">";

  if (content !== undefined && content !== null) {
    html += content + "</" + name + ">";
  }

  return html;
}

module.exports = { escapeHtml, escapeAttr, tag };
