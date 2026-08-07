"use strict";

const fs = require("fs");
const path = require("path");

const REPORT_FILE = path.join(__dirname, "..", "diag-report.json");

// Diagnoseseite fuer das Zielgeraet.
//
// Sie muss auf einem Browser laufen, dessen Faehigkeiten wir gerade erst
// herausfinden wollen - deshalb: document.write statt DOM-API, jede Messung
// einzeln in try/catch, und die Ruecksendung per Image-Beacon (funktioniert
// auch ohne XHR2).

function renderPage(options) {
  const useDeviceDpi = options.deviceDpi;

  const viewport = useDeviceDpi
    ? "width=device-width, target-densitydpi=device-dpi"
    : "width=device-width";

  return '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN" ' +
    '"http://www.w3.org/TR/html4/loose.dtd">\n' +
    "<html>\n<head>\n" +
    '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n' +
    '<meta http-equiv="Pragma" content="no-cache">\n' +
    '<meta name="viewport" content="' + viewport + '">\n' +
    "<title>Geräte-Diagnose</title>\n" +
    '<style type="text/css">\n' +
    "body { background:#fff; color:#000; font-family:sans-serif; margin:0; padding:8px; }\n" +
    "h2 { font-size:20px; margin:14px 0 6px 0; border-bottom:2px solid #000; }\n" +
    "table.data { width:100%; border-collapse:collapse; font-size:15px; }\n" +
    "table.data td { border:1px solid #000; padding:3px 5px; }\n" +
    "table.data td.k { width:48%; }\n" +
    "b.v { font-size:17px; }\n" +
    ".ruler div { background:#000; color:#fff; font-size:13px; margin-bottom:2px;\n" +
    "  padding:2px 4px; overflow:hidden; white-space:nowrap; }\n" +
    ".ladder div { border-bottom:1px solid #999; padding:2px 0; }\n" +
    ".box { border:2px solid #000; padding:6px; margin-bottom:6px; }\n" +
    "</style>\n</head>\n<body>\n" +
    "<h2>1. Messwerte</h2>\n" +
    '<table class="data" id="out">\n' +
    "<script type=\"text/javascript\">\n" + measurementScript(useDeviceDpi) + "\n</script>\n" +
    "</table>\n" +
    '<div id="beacon"></div>\n' +
    "<h2>2. Wie breit ist der Bildschirm?</h2>\n" +
    "<p style=\"font-size:15px;margin:4px 0\">Der breiteste Balken, der noch <b>vollständig</b> " +
    "sichtbar ist (kein Abschneiden rechts), ist die nutzbare Breite.</p>\n" +
    '<div class="ruler">' + ruler() + "</div>\n" +
    "<h2>3. Welche Schriftgröße ist gut lesbar?</h2>\n" +
    '<div class="ladder">' + ladder() + "</div>\n" +
    "<h2>4. Kontrast-Test</h2>\n" +
    grayscale() +
    "<h2>5. Gegenprobe</h2>\n" +
    '<p style="font-size:16px"><a href="' + (useDeviceDpi ? "/diag?dpi=off" : "/diag") +
    '">' + (useDeviceDpi ? "Ohne target-densitydpi laden" : "Mit target-densitydpi laden") +
    "</a><br>Beide Varianten einmal öffnen — die Werte werden automatisch " +
    "an den Server gemeldet.</p>\n" +
    "</body>\n</html>";
}

function measurementScript(useDeviceDpi) {
  return [
    "var rows = [];",
    "function probe(name, fn) {",
    "  var value;",
    "  try { value = fn(); } catch (e) { value = 'FEHLER'; }",
    "  if (value === undefined) { value = 'nicht vorhanden'; }",
    "  if (value === true) { value = 'ja'; }",
    "  if (value === false) { value = 'NEIN'; }",
    "  rows.push([name, String(value)]);",
    "  document.write('<tr><td class=\"k\">' + name + '</td><td><b class=\"v\">' + value + '</b></td></tr>');",
    "}",
    "",
    "probe('screen.width', function () { return screen.width; });",
    "probe('screen.height', function () { return screen.height; });",
    "probe('screen.availWidth', function () { return screen.availWidth; });",
    "probe('screen.availHeight', function () { return screen.availHeight; });",
    "probe('devicePixelRatio', function () { return window.devicePixelRatio; });",
    "probe('documentElement.clientWidth', function () { return document.documentElement.clientWidth; });",
    "probe('documentElement.clientHeight', function () { return document.documentElement.clientHeight; });",
    "probe('window.innerWidth', function () { return window.innerWidth; });",
    "probe('window.innerHeight', function () { return window.innerHeight; });",
    "probe('window.orientation', function () { return window.orientation; });",
    "probe('colorDepth', function () { return screen.colorDepth; });",
    "",
    "probe('JSON', function () { return typeof JSON === 'object' && !!JSON.parse; });",
    "probe('querySelector', function () { return !!document.querySelector; });",
    "probe('addEventListener', function () { return !!window.addEventListener; });",
    "probe('localStorage', function () { return !!window.localStorage; });",
    "probe('Function.bind', function () { return !!Function.prototype.bind; });",
    "probe('Array.forEach', function () { return !!Array.prototype.forEach; });",
    "probe('XHR onload (XHR2)', function () { return 'onload' in new XMLHttpRequest(); });",
    "probe('classList', function () { return 'classList' in document.createElement('div'); });",
    "probe('SVG', function () {",
    "  return !!(document.createElementNS &&",
    "    document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGRect);",
    "});",
    "",
    "function styleSupport(prop) {",
    "  var el = document.createElement('div');",
    "  var caps = prop.charAt(0).toUpperCase() + prop.slice(1);",
    "  var names = [prop, 'Webkit' + caps, 'Moz' + caps, 'O' + caps];",
    "  for (var i = 0; i < names.length; i++) {",
    "    if (names[i] in el.style) { return names[i]; }",
    "  }",
    "  return false;",
    "}",
    "probe('box-sizing', function () { return styleSupport('boxSizing'); });",
    "probe('border-radius', function () { return styleSupport('borderRadius'); });",
    "probe('box-shadow', function () { return styleSupport('boxShadow'); });",
    "probe('transform', function () { return styleSupport('transform'); });",
    "probe('userAgent', function () { return navigator.userAgent; });",
    "",
    "// Ruecksendung per Image-Beacon: braucht weder XHR noch JSON.",
    "try {",
    "  var query = 'dpi=" + (useDeviceDpi ? "on" : "off") + "';",
    "  for (var i = 0; i < rows.length; i++) {",
    "    query += '&' + encodeURIComponent(rows[i][0]) + '=' + encodeURIComponent(rows[i][1]);",
    "  }",
    "  var beacon = new Image();",
    "  beacon.src = '/diag/report?' + query;",
    "} catch (e) {}"
  ].join("\n");
}

function ruler() {
  const widths = [320, 400, 480, 505, 600, 700, 758, 800, 1024];

  return widths.map(function (width) {
    return '<div style="width:' + width + "px\">" + width + " px</div>";
  }).join("");
}

function ladder() {
  const sizes = [14, 18, 22, 26, 30, 36, 44];

  return sizes.map(function (size) {
    return '<div style="font-size:' + size + 'px">' + size +
      " px — Balkon 169 W, 25° sonnig</div>";
  }).join("");
}

function grayscale() {
  const shades = ["#000000", "#333333", "#666666", "#999999", "#cccccc"];

  let html = '<div class="box"><table width="100%" cellspacing="0" cellpadding="0"><tr>';

  shades.forEach(function (shade) {
    html += '<td style="background:' + shade + ';color:#fff;font-size:13px;padding:12px 2px;' +
      'text-align:center">' + shade.slice(1, 3) + "</td>";
  });

  html += "</tr></table>";
  html += '<p style="font-size:15px;margin:6px 0 0 0">Welche dieser Graustufen sind auf dem ' +
    "E-Ink noch klar unterscheidbar? Danach richtet sich, wie viele Grautöne das " +
    "Dashboard benutzen darf.</p></div>";

  return html;
}

// Nimmt den Beacon entgegen, schreibt ihn weg und antwortet mit einem
// 1x1-GIF, damit der Browser ein gueltiges Bild bekommt.
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function handleReport(req, res, query) {
  const report = { receivedAt: new Date().toISOString(), values: {} };

  query.forEach(function (value, key) {
    report.values[key] = value;
  });

  let all = [];

  try {
    all = JSON.parse(fs.readFileSync(REPORT_FILE, "utf8"));
    if (!Array.isArray(all)) {
      all = [];
    }
  } catch (err) {
    all = [];
  }

  all.unshift(report);
  all = all.slice(0, 10);

  try {
    fs.writeFileSync(REPORT_FILE, JSON.stringify(all, null, 2), "utf8");
  } catch (err) {
    console.error("Diagnosebericht konnte nicht gespeichert werden:", err.message);
  }

  console.log("--- Diagnosebericht empfangen (dpi=" + (report.values.dpi || "?") + ") ---");
  console.log("  clientWidth:", report.values["documentElement.clientWidth"],
    "| screen.width:", report.values["screen.width"],
    "| devicePixelRatio:", report.values.devicePixelRatio);
  console.log("  UA:", report.values.userAgent);

  res.writeHead(200, {
    "Content-Type": "image/gif",
    "Content-Length": PIXEL.length,
    "Cache-Control": "no-store"
  });
  res.end(PIXEL);
}

module.exports = { renderPage, handleReport, REPORT_FILE };
