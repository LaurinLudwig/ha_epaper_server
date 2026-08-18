"use strict";

const { escapeHtml } = require("./html");

// Anmeldemaske fuer den Baukasten. Laeuft im modernen Browser, nicht auf
// dem Tolino - hier sind also keine WebKit-533-Ruecksichten noetig.
function renderPage(options) {
  const opts = options || {};

  return "<!DOCTYPE html>\n<html lang=\"de\">\n<head>\n" +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    "<title>Anmeldung — Dashboard-Baukasten</title>\n" +
    "<style>\n" +
    "body { margin:0; min-height:100vh; display:flex; align-items:center;" +
    " justify-content:center; background:#f3f4f6;" +
    " font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; }\n" +
    "form { background:#fff; padding:28px; border-radius:12px; width:min(340px,90vw);" +
    " border:1px solid #e5e7eb; }\n" +
    "h1 { font-size:17px; margin:0 0 4px 0; }\n" +
    "p.sub { font-size:13px; color:#6b7280; margin:0 0 18px 0; }\n" +
    "label { display:block; font-size:12px; font-weight:600; color:#374151; margin-bottom:4px; }\n" +
    "input { width:100%; box-sizing:border-box; padding:9px 10px; font-size:14px;" +
    " border:1px solid #d1d5db; border-radius:6px; }\n" +
    "button { width:100%; margin-top:14px; padding:10px; font-size:14px; font-weight:600;" +
    " background:#2563eb; color:#fff; border:0; border-radius:6px; cursor:pointer; }\n" +
    "button:hover { background:#1d4ed8; }\n" +
    ".err { background:#fef2f2; color:#b91c1c; border:1px solid #fecaca;" +
    " padding:8px 10px; border-radius:6px; font-size:13px; margin-bottom:14px; }\n" +
    "</style>\n</head>\n<body>\n" +
    '<form method="post" action="/admin/login">\n' +
    "<h1>Dashboard-Baukasten</h1>\n" +
    '<p class="sub">Anmeldung erforderlich</p>\n' +
    (opts.error ? '<div class="err">' + escapeHtml(opts.error) + "</div>\n" : "") +
    '<label for="pw">Passwort</label>\n' +
    '<input type="password" id="pw" name="password" autofocus autocomplete="current-password">\n' +
    "<button type=\"submit\">Anmelden</button>\n" +
    "</form>\n</body>\n</html>";
}

module.exports = { renderPage };
