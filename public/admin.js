"use strict";

// Baukasten-Oberfläche. Läuft im modernen Browser, nicht auf dem Tolino.
//
// Die Formulare werden aus dem Schema in lib/blocks.js erzeugt. Ein neuer
// Bausteintyp braucht deshalb hier keine Zeile Code.

let schema = null;
let config = null;
let selectedId = null;
let dirty = false;
let entities = null;
let pickerCallback = null;
let pickerDomain = "";

const $ = (id) => document.getElementById(id);

function setStatus(text, kind) {
  const el = $("status");
  el.textContent = text;
  el.className = "status" + (kind ? " " + kind : "");
}

function markDirty() {
  dirty = true;
  setStatus("Ungespeicherte Änderungen", "dirty");
  schedulePreview();
}

// ---------------------------------------------------------------- Laden

async function boot() {
  try {
    const [schemaRes, configRes] = await Promise.all([
      fetch("/api/schema"),
      fetch("/api/config")
    ]);

    schema = (await schemaRes.json()).blockTypes;
    config = await configRes.json();
  } catch (err) {
    setStatus("Laden fehlgeschlagen: " + err.message, "err");
    return;
  }

  const typeSelect = $("newBlockType");
  typeSelect.innerHTML = "";

  Object.keys(schema).forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = schema[type].label;
    typeSelect.appendChild(option);
  });

  selectedId = config.blocks.length ? config.blocks[0].id : null;

  renderBlockList();
  renderSettings();
  renderEditor();
  refreshPreview();
  setStatus("Geladen", "ok");
}

// ------------------------------------------------------- Bausteinliste

function renderBlockList() {
  const list = $("blockList");
  list.innerHTML = "";

  if (config.blocks.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Noch keine Bausteine.";
    list.appendChild(empty);
    return;
  }

  config.blocks.forEach((block, index) => {
    const definition = schema[block.type] || { label: block.type };

    const item = document.createElement("li");
    item.className = "block-item" + (block.id === selectedId ? " active" : "");
    item.onclick = () => { selectedId = block.id; renderBlockList(); renderEditor(); };

    const main = document.createElement("div");
    main.className = "block-item-main";

    const name = document.createElement("div");
    name.className = "block-item-name";
    name.textContent = block.title || definition.label;

    const meta = document.createElement("div");
    meta.className = "block-item-meta";
    meta.textContent = definition.label + " · " + (block.width === "half" ? "halbe" : "volle") + " Breite";

    main.append(name, meta);

    const buttons = document.createElement("div");
    buttons.className = "block-item-buttons";
    buttons.append(
      iconButton("↑", "Nach oben", (e) => { e.stopPropagation(); move(index, -1); }, index === 0),
      iconButton("↓", "Nach unten", (e) => { e.stopPropagation(); move(index, 1); }, index === config.blocks.length - 1),
      iconButton("⧉", "Duplizieren", (e) => { e.stopPropagation(); duplicate(index); }),
      iconButton("✕", "Löschen", (e) => { e.stopPropagation(); remove(index); })
    );

    item.append(main, buttons);
    list.appendChild(item);
  });
}

function iconButton(label, title, onClick, disabled) {
  const button = document.createElement("button");
  button.textContent = label;
  button.title = title;
  button.disabled = !!disabled;
  button.style.opacity = disabled ? 0.3 : 1;
  button.onclick = onClick;
  return button;
}

function move(index, delta) {
  const target = index + delta;

  if (target < 0 || target >= config.blocks.length) {
    return;
  }

  const [block] = config.blocks.splice(index, 1);
  config.blocks.splice(target, 0, block);

  markDirty();
  renderBlockList();
}

function duplicate(index) {
  const copy = JSON.parse(JSON.stringify(config.blocks[index]));
  copy.id = "b" + Date.now().toString(36);

  config.blocks.splice(index + 1, 0, copy);
  selectedId = copy.id;

  markDirty();
  renderBlockList();
  renderEditor();
}

function remove(index) {
  const block = config.blocks[index];
  const definition = schema[block.type] || { label: block.type };

  if (!confirm('Baustein "' + (block.title || definition.label) + '" löschen?')) {
    return;
  }

  config.blocks.splice(index, 1);

  if (selectedId === block.id) {
    selectedId = config.blocks.length ? config.blocks[0].id : null;
  }

  markDirty();
  renderBlockList();
  renderEditor();
}

$("btnAdd").onclick = () => {
  const type = $("newBlockType").value;
  const block = Object.assign({}, JSON.parse(JSON.stringify(schema[type].defaults)), {
    id: "b" + Date.now().toString(36),
    type: type,
    width: "full"
  });

  config.blocks.push(block);
  selectedId = block.id;

  markDirty();
  renderBlockList();
  renderEditor();
};

// ------------------------------------------------------------- Editor

function selectedBlock() {
  return config.blocks.find((block) => block.id === selectedId) || null;
}

function renderEditor() {
  const form = $("editorForm");
  const block = selectedBlock();

  form.innerHTML = "";

  if (!block) {
    $("editorTitle").textContent = "Baustein";
    form.innerHTML = '<p class="hint">Links einen Baustein auswählen oder hinzufügen.</p>';
    return;
  }

  const definition = schema[block.type];
  $("editorTitle").textContent = definition.label;

  if (definition.description) {
    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent = definition.description;
    form.appendChild(desc);
  }

  form.appendChild(widthField(block));

  definition.fields.forEach((field) => {
    form.appendChild(buildField(block, field));
  });
}

function widthField(block) {
  const wrap = document.createElement("div");
  wrap.className = "field";

  const label = document.createElement("label");
  label.textContent = "Breite im Raster";

  const select = document.createElement("select");
  [["full", "Volle Breite"], ["half", "Halbe Breite (zwei nebeneinander)"]].forEach(([value, text]) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    option.selected = block.width === value;
    select.appendChild(option);
  });

  select.onchange = () => {
    block.width = select.value;
    markDirty();
    renderBlockList();
  };

  wrap.append(label, select);
  return wrap;
}

function buildField(block, field) {
  const wrap = document.createElement("div");
  wrap.className = field.type === "checkbox" ? "field field-inline" : "field";

  const label = document.createElement("label");
  label.textContent = field.label;

  if (field.type === "checkbox") {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = block[field.key] !== false;
    input.onchange = () => { block[field.key] = input.checked; markDirty(); };
    wrap.append(input, label);
    return wrap;
  }

  wrap.appendChild(label);

  if (field.type === "entity") {
    wrap.appendChild(entityInput(block, field));
    return wrap;
  }

  if (field.type === "rows") {
    wrap.appendChild(rowsEditor(block, field));
    return wrap;
  }

  if (field.type === "select") {
    const select = document.createElement("select");

    field.options.forEach((option) => {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      el.selected = block[field.key] === option.value;
      select.appendChild(el);
    });

    select.onchange = () => { block[field.key] = select.value; markDirty(); };
    wrap.appendChild(select);
    return wrap;
  }

  const input = document.createElement(field.type === "textarea" ? "textarea" : "input");

  if (field.type === "number") {
    input.type = "number";
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined) input.max = field.max;
  } else if (field.type !== "textarea") {
    input.type = "text";
  }

  input.value = block[field.key] === undefined ? "" : block[field.key];
  input.oninput = () => {
    block[field.key] = field.type === "number" ? Number(input.value) : input.value;
    markDirty();

    if (field.key === "title") {
      renderBlockList();
    }
  };

  wrap.appendChild(input);
  return wrap;
}

function entityInput(block, field) {
  const wrap = document.createElement("div");
  wrap.className = "entity-field";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "sensor.beispiel";
  input.value = block[field.key] || "";
  input.oninput = () => { block[field.key] = input.value; markDirty(); };

  const button = document.createElement("button");
  button.className = "btn btn-small";
  button.textContent = "Wählen …";
  button.onclick = () => {
    openPicker(field.domain, (entity) => {
      block[field.key] = entity.entity_id;
      input.value = entity.entity_id;
      markDirty();
    });
  };

  wrap.append(input, button);
  return wrap;
}

function rowsEditor(block, field) {
  const wrap = document.createElement("div");
  wrap.className = "rows-editor";

  const rows = block[field.key] || (block[field.key] = []);

  rows.forEach((row, index) => {
    wrap.appendChild(buildRowEditor(block, field, row, index));
  });

  const add = document.createElement("button");
  add.className = "btn btn-small";
  add.textContent = "+ Wert hinzufügen";
  add.onclick = () => {
    openPicker("", (entity) => {
      rows.push({
        label: entity.name,
        entity: entity.entity_id,
        unit: "",
        decimals: 0
      });
      markDirty();
      renderEditor();
    });
  };

  wrap.appendChild(add);
  return wrap;
}

function buildRowEditor(block, field, row, index) {
  const rows = block[field.key];

  const box = document.createElement("div");
  box.className = "row-editor";

  const head = document.createElement("div");
  head.className = "row-editor-head span2";

  const title = document.createElement("strong");
  title.textContent = "Wert " + (index + 1);

  const buttons = document.createElement("div");
  buttons.append(
    iconButton("↑", "Nach oben", () => {
      if (index > 0) {
        [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
        markDirty();
        renderEditor();
      }
    }, index === 0),
    iconButton("↓", "Nach unten", () => {
      if (index < rows.length - 1) {
        [rows[index + 1], rows[index]] = [rows[index], rows[index + 1]];
        markDirty();
        renderEditor();
      }
    }, index === rows.length - 1),
    iconButton("✕", "Entfernen", () => {
      rows.splice(index, 1);
      markDirty();
      renderEditor();
    })
  );

  head.append(title, buttons);
  box.appendChild(head);

  const entityWrap = document.createElement("div");
  entityWrap.className = "entity-field span2";

  const entityInputEl = document.createElement("input");
  entityInputEl.type = "text";
  entityInputEl.value = row.entity || "";
  entityInputEl.oninput = () => { row.entity = entityInputEl.value; markDirty(); };

  const pick = document.createElement("button");
  pick.className = "btn btn-small";
  pick.textContent = "Wählen …";
  pick.onclick = () => {
    openPicker("", (entity) => {
      row.entity = entity.entity_id;
      if (!row.label) row.label = entity.name;
      markDirty();
      renderEditor();
    });
  };

  entityWrap.append(entityInputEl, pick);
  box.appendChild(entityWrap);

  box.appendChild(smallField("Bezeichnung", row, "label", "text"));
  box.appendChild(smallField("Einheit (leer = aus HA)", row, "unit", "text"));
  box.appendChild(smallField("Nachkommastellen", row, "decimals", "number"));

  return box;
}

function smallField(labelText, target, key, type) {
  const wrap = document.createElement("div");
  wrap.className = "field";

  const label = document.createElement("label");
  label.textContent = labelText;

  const input = document.createElement("input");
  input.type = type;
  input.value = target[key] === undefined ? "" : target[key];
  input.oninput = () => {
    target[key] = type === "number" ? Number(input.value) : input.value;
    markDirty();
  };

  wrap.append(label, input);
  return wrap;
}

// --------------------------------------------------------- Einstellungen

const SETTING_FIELDS = [
  { key: "title", label: "Seitentitel", type: "text" },
  { key: "timezone", label: "Zeitzone (z. B. Europe/Berlin)", type: "text" },
  { key: "refreshSeconds", label: "Neu laden alle … Sekunden", type: "number", min: 5, max: 3600 },
  { key: "baseFontSize", label: "Basis-Schriftgröße (px)", type: "number", min: 10, max: 80 },
  { key: "contentWidth", label: "Rasterbreite in px (0 = volle Breite)", type: "number", min: 0, max: 2000 },
  { key: "deviceDpi", label: "1:1-Pixel (target-densitydpi)", type: "checkbox" },
  { key: "showFooter", label: "Fußzeile mit Zeitstempel", type: "checkbox" }
];

function renderSettings() {
  const form = $("settingsForm");
  form.innerHTML = "";

  SETTING_FIELDS.forEach((field) => {
    form.appendChild(buildField(config.settings, field));
  });
}

// -------------------------------------------------------------- Picker

// Entitäts-IDs sind meist ohne Umlaute geschrieben ("aussen_temperatur"),
// gesucht wird aber mit ("Außentemperatur"). Beide Seiten werden deshalb auf
// dieselbe umlautfreie Form gebracht — sonst findet man die Entität nie.
//
// Reihenfolge zählt: erst ä→ae, dann Akzente strippen. Andersherum würde
// "ü" zu "u" und träfe "ue" nicht mehr.
function foldSearch(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

async function openPicker(domain, callback) {
  pickerCallback = callback;
  pickerDomain = domain || "";

  $("pickerBackdrop").classList.remove("hidden");
  $("pickerSearch").value = "";
  $("pickerSearch").focus();
  $("pickerList").innerHTML = '<div class="picker-empty">Lade Entitäten …</div>';

  if (!entities) {
    try {
      const res = await fetch("/api/entities");
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "HTTP " + res.status);
      }

      entities = data.entities;

      // Suchtext einmal vorberechnen statt bei jedem Tastendruck 495-mal.
      entities.forEach((entity) => {
        entity._search = foldSearch(entity.entity_id + " " + entity.name + " " + entity.unit);
      });
    } catch (err) {
      $("pickerList").innerHTML = '<div class="picker-empty">Fehler: ' + err.message + "</div>";
      return;
    }
  }

  renderDomainChips();
  renderPickerList();
}

function renderDomainChips() {
  const wrap = $("pickerDomains");
  wrap.innerHTML = "";

  const counts = {};
  entities.forEach((entity) => { counts[entity.domain] = (counts[entity.domain] || 0) + 1; });

  const domains = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  domains.unshift("");

  domains.forEach((domain) => {
    const button = document.createElement("button");
    button.textContent = domain === "" ? "Alle" : domain + " (" + counts[domain] + ")";
    button.className = domain === pickerDomain ? "active" : "";
    button.onclick = () => { pickerDomain = domain; renderDomainChips(); renderPickerList(); };
    wrap.appendChild(button);
  });
}

function renderPickerList() {
  if (!entities) {
    return;
  }

  const list = $("pickerList");

  // Mehrwortsuche: "aussen temp" findet auch "aussen_temperatur".
  const terms = foldSearch($("pickerSearch").value).split(/\s+/).filter(Boolean);

  const matches = entities.filter((entity) => {
    if (pickerDomain && entity.domain !== pickerDomain) {
      return false;
    }

    return terms.every((term) => entity._search.includes(term));
  });

  list.innerHTML = "";

  if (matches.length === 0) {
    list.innerHTML = '<div class="picker-empty">Nichts gefunden.</div>';
    return;
  }

  // Kappung nur als Bremse für sehr große Installationen. Sie muss hoch genug
  // liegen, dass man ohne Suchbegriff jede Entität erreicht — bei 200 waren
  // die meisten sensor.* unerreichbar, weil sie alphabetisch hinten stehen.
  const LIMIT = 500;

  matches.slice(0, LIMIT).forEach((entity) => {
    const item = document.createElement("div");
    item.className = "picker-item";

    const left = document.createElement("div");
    const name = document.createElement("div");
    name.className = "picker-item-name";
    name.textContent = entity.name;

    const id = document.createElement("div");
    id.className = "picker-item-id";
    id.textContent = entity.entity_id;

    left.append(name, id);

    const state = document.createElement("div");
    state.className = "picker-item-state";
    state.textContent = entity.state + (entity.unit ? " " + entity.unit : "");

    item.append(left, state);
    item.onclick = () => {
      // Callback sichern, BEVOR closePicker() ihn auf null setzt - sonst
      // schliesst sich der Dialog und die Auswahl verpufft.
      const callback = pickerCallback;
      closePicker();
      if (callback) {
        callback(entity);
      }
    };

    list.appendChild(item);
  });

  if (matches.length > LIMIT) {
    const more = document.createElement("div");
    more.className = "picker-empty";
    more.textContent = matches.length - LIMIT + " weitere — Suche verfeinern.";
    list.appendChild(more);
  }
}

function closePicker() {
  $("pickerBackdrop").classList.add("hidden");
  pickerCallback = null;
}

$("pickerSearch").oninput = renderPickerList;
$("pickerClose").onclick = closePicker;
$("pickerBackdrop").onclick = (e) => { if (e.target === $("pickerBackdrop")) closePicker(); };
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("pickerBackdrop").classList.contains("hidden")) {
    closePicker();
  }
});

// ------------------------------------------------------------ Vorschau

let previewTimer = null;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 600);
}

async function refreshPreview() {
  const frame = $("previewFrame");

  frame.style.width = $("previewWidth").value + "px";
  frame.classList.toggle("gray", $("previewGray").checked);

  try {
    // POST statt GET: so zeigt die Vorschau den ungespeicherten Entwurf.
    const res = await fetch("/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    });

    frame.srcdoc = await res.text();
  } catch (err) {
    frame.srcdoc = "<p style='font-family:sans-serif'>Vorschau fehlgeschlagen: " + err.message + "</p>";
  }
}

$("btnPreview").onclick = refreshPreview;
$("previewWidth").onchange = refreshPreview;
$("previewGray").onchange = refreshPreview;

// ------------------------------------------------------------ Speichern

$("btnSave").onclick = async () => {
  setStatus("Speichere …");

  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || "HTTP " + res.status);
    }

    config = data;
    dirty = false;

    // Der Server normalisiert beim Speichern - danach neu zeichnen, damit
    // die Oberfläche exakt zeigt, was wirklich in der Datei steht.
    if (!config.blocks.some((block) => block.id === selectedId)) {
      selectedId = config.blocks.length ? config.blocks[0].id : null;
    }

    renderBlockList();
    renderSettings();
    renderEditor();
    refreshPreview();
    setStatus("Gespeichert", "ok");
  } catch (err) {
    setStatus("Fehler: " + err.message, "err");
  }
};

$("btnReload").onclick = async () => {
  if (dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) {
    return;
  }

  dirty = false;
  await boot();
};

window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

boot();
