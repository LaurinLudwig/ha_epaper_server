"use strict";

// Legacy-Check: prueft das erzeugte Tablet-HTML und tablet.css auf
// Konstrukte, die der Android-2.3.4-Browser (WebKit 533.1) nicht kann.
//
// Aufruf:  node tools/legacy-check.js
//          node tools/legacy-check.js http://localhost:8080/
//
// Faengt Fehler ab, bevor man mit dem Tolino in der Hand davorsteht.

const http = require("http");
const fs = require("fs");
const path = require("path");

const target = process.argv[2] || "http://localhost:8080/";

const HTML_RULES = [
  { re: /<svg\b/i, msg: "<svg> - SVG kann Android erst ab 3.0" },
  { re: /<canvas\b/i, msg: "<canvas> - auf E-Ink sinnlos und langsam" },
  { re: /\brequestAnimationFrame\b/, msg: "requestAnimationFrame gibt es nicht" },
  { re: /\bquerySelectorAll\b.*\bforEach\b/, msg: "NodeList.forEach fehlt in WebKit 533" },
  { re: /\bclassList\b/, msg: "classList fehlt in Android 2.3" },
  { re: /\bdataset\b/, msg: "dataset fehlt - getAttribute nutzen" },
  { re: /=>/, msg: "Arrow-Funktion - kein ES6 auf dem Geraet" },
  { re: /\blet\s+[A-Za-z_$]/, msg: "let - kein ES6 auf dem Geraet" },
  { re: /\bconst\s+[A-Za-z_$]/, msg: "const - kein ES6 auf dem Geraet" },
  { re: /`/, msg: "Template-String - kein ES6 auf dem Geraet" },
  { re: /\bfetch\s*\(/, msg: "fetch() gibt es nicht" },
  { re: /\blocalStorage\b/, msg: "localStorage: vorhanden, aber auf dem Geraet unzuverlaessig" },
  // Eine Schaltaktion als GET-Link wuerde durch den Meta-Refresh des Panels
  // endlos wiederholt. Sie MUSS als Formular mit POST ausgeliefert werden.
  { re: /<a[^>]+href="\/action/i, msg: "Schaltaktion als GET-Link - wird vom Meta-Refresh endlos wiederholt" },
];

// Jedes <form>-Tag einzeln pruefen. Eine zeilenweise Regex genuegt nicht: das
// Tablet-HTML steht komplett auf einer Zeile, ein Lookahead wuerde dann ins
// naechste Formular greifen und falschen Alarm schlagen.
function checkActionForms(html) {
  const problems = [];
  const tags = html.match(/<form\b[^>]*>/gi) || [];

  tags.forEach(function (tag) {
    if (!/action\s*=\s*"\/action"/i.test(tag)) {
      return;
    }

    if (!/method\s*=\s*"post"/i.test(tag)) {
      problems.push({
        line: 0,
        msg: "Schalt-Formular ohne method=\"post\" - der Meta-Refresh wiederholt die Aktion sonst",
        text: tag.slice(0, 90)
      });
    }
  });

  return problems;
}

const CSS_RULES = [
  { re: /position\s*:\s*fixed/i, msg: "position:fixed ist vor Android 3.0 defekt" },
  { re: /display\s*:\s*flex/i, msg: "display:flex - kein moderner Flexbox in WebKit 533" },
  { re: /display\s*:\s*grid/i, msg: "display:grid gibt es nicht" },
  { re: /\bcalc\s*\(/i, msg: "calc() gibt es nicht" },
  { re: /\bvar\s*\(\s*--/i, msg: "CSS-Variablen gibt es nicht" },
  // Nach einer Ziffer gibt es keine Wortgrenze - "1rem" braucht daher
  // die Ziffer im Muster, sonst matcht \brem\b nie.
  { re: /[\d.]\s*rem\b/, msg: "rem-Einheit wird nicht unterstuetzt - px oder em nutzen" },
  { re: /[\d.]\s*(vh|vw|vmin|vmax)\b/, msg: "vh/vw gibt es nicht" },
  { re: /:\s*(grid|flex)-/i, msg: "Grid-/Flex-Eigenschaft ohne Wirkung" },
  { re: /@font-face/i, msg: "@font-face - Webfonts auf E-Ink vermeiden" },
  { re: /\btransition\b/i, msg: "transition - auf E-Ink wirkungslos" },
  { re: /\banimation\b/i, msg: "animation - auf E-Ink wirkungslos" }
];

// box-sizing ohne -webkit- wirkt in WebKit 533 nicht. Das ist der Fehler,
// der Layouts am haeufigsten kaputt macht, deshalb eine eigene Pruefung.
function checkBoxSizing(css) {
  const problems = [];
  const lines = stripComments(css).split("\n");

  for (let i = 0; i < lines.length; i++) {
    // Unpraefigiertes box-sizing irgendwo in der Zeile, auch inline im Block.
    if (!/(?<!-webkit-)box-sizing\s*:/.test(lines[i])) {
      continue;
    }

    // Die praefigierte Variante darf in derselben oder einer der drei
    // vorangehenden Zeilen stehen (uebliche Schreibweise im Regelblock).
    const window = lines.slice(Math.max(0, i - 3), i + 1).join("\n");

    if (!/-webkit-box-sizing\s*:/.test(window)) {
      problems.push({
        line: i + 1,
        msg: "box-sizing ohne -webkit-box-sizing (wirkt in WebKit 533 sonst nicht)",
        text: lines[i].trim().slice(0, 90)
      });
    }
  }

  return problems;
}

// Kommentare durch Leerzeilen ersetzen (nicht loeschen), damit die
// gemeldeten Zeilennummern zur Originaldatei passen. Sonst schlaegt die
// Pruefung auf Kommentartexten an, die genau diese Konstrukte benennen.
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, function (match) {
      return match.replace(/[^\n]/g, " ");
    })
    .replace(/<!--[\s\S]*?-->/g, function (match) {
      return match.replace(/[^\n]/g, " ");
    });
}

function scan(text, rules, label) {
  const problems = [];
  const lines = stripComments(text).split("\n");

  lines.forEach(function (line, index) {
    rules.forEach(function (rule) {
      if (rule.re.test(line)) {
        problems.push({ line: index + 1, msg: rule.msg, text: line.trim().slice(0, 90) });
      }
    });
  });

  return { label: label, problems: problems };
}

function report(results) {
  let total = 0;

  results.forEach(function (result) {
    console.log("\n=== " + result.label + " ===");

    if (result.problems.length === 0) {
      console.log("  keine Probleme");
      return;
    }

    result.problems.forEach(function (problem) {
      total++;
      console.log("  Zeile " + problem.line + ": " + problem.msg);

      if (problem.text) {
        console.log("    > " + problem.text);
      }
    });
  });

  console.log("\n" + (total === 0
    ? "Ergebnis: sauber - nichts gefunden, was Android 2.3.4 überfordert."
    : "Ergebnis: " + total + " Treffer prüfen."));

  process.exit(total === 0 ? 0 : 1);
}

const cssPath = path.join(__dirname, "..", "public", "tablet.css");
const css = fs.readFileSync(cssPath, "utf8");

const cssResult = scan(css, CSS_RULES, "public/tablet.css");
checkBoxSizing(css).forEach(function (problem) {
  cssResult.problems.push(problem);
});

http.get(target, function (res) {
  let html = "";

  res.setEncoding("utf8");
  res.on("data", function (chunk) { html += chunk; });

  res.on("end", function () {
    const htmlResult = scan(html, HTML_RULES, "Tablet-HTML von " + target);

    checkActionForms(html).forEach(function (problem) {
      htmlResult.problems.push(problem);
    });

    report([htmlResult, cssResult]);
  });
}).on("error", function (err) {
  console.log("Server unter " + target + " nicht erreichbar (" + err.message + ").");
  console.log("Prüfe nur das Stylesheet.\n");
  report([cssResult]);
});
