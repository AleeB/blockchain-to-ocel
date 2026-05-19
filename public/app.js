import {
  loadFromBrowserFile,
  parseJsonOrJsonl,
  normalizeRecords,
  detectNestedColumns,
  collectAllColumns,
  OcelMapper,
  buildConfig,
  freeColumns,
  sampleValues,
  validateOcel,
  getOcelStats,
  downloadOcel,
  downloadConfig,
  NONE_SENTINEL,
} from "../src/browser.js";

/*
   STATO GLOBALE
   Un singolo oggetto S (state) che accumula le scelte dell'utente
   passo dopo passo. Viene letto da runMapping() per costruire il config

   ESEMPIO DP BUILDER (oggetto che si definisce in modo progressivo)
*/

const S = {
  raw: [], // record grezzi caricati dal file
  records: [], // record normalizzati (dopo appiattimento)
  allCols: [], // nomi di tutte le colonne dopo normalizzazione
  nestedCols: [], // colonne rilevate come annidate
  selectedNested: [], // colonne annidate scelte dall'utente per l'appiattimento
  ocel: null, // documento OCEL 2.0 generato
  config: null, // MappingConfig usato per generare ocel
  filename: "output", // nome base del file

  // Selezioni dell'utente accumulate passo per passo:
  eventIdCol: "",
  activityCol: "",
  timestampCol: NONE_SENTINEL, //evitiamo un code smell
  objectCols: [], // [{ col: string, typeName: string }]
  objAttrs: {}, // { typeName: string[] }  — attributi per ogni tipo oggetto
  evAttrs: [], // colonne selezionate come attributi evento
  e2oRules: [], // [{ column, objectType, qualifier }]
  o2oRules: [], // [{ sourceType, sourceColumn, targetType, targetColumn, qualifier }]
};

// var che permette di capire dove siamo arrivati con il mapping (count Step)

let currentStep = 0;

/**
 * Naviga allo step corretto
 *
 * Esposta su window perché i bottoni HTML usano onclick="goTo(N)".
 *
 * @param {number} step - Indice dello step destinazione (0–7)
 */
window.goTo = function (step) {
  document.getElementById(`step-${currentStep}`).classList.add("hidden");
  document.getElementById(`step-${step}`).classList.remove("hidden");

  // Aggiorna le classi della progress bar
  document.querySelectorAll(".step-dot").forEach((el, i) => {
    el.classList.toggle("done", i < step);
    el.classList.toggle("active", i === step);
    // Rimuove "done" e "active" dagli step futuri (navigazione indietro)
    if (i > step) el.classList.remove("done", "active");
  });

  currentStep = step;

  // Ogni step ha una funzione render* che popola il suo contenuto dinamico
  if (step === 1) renderNormalizeStep();
  if (step === 2) renderCoreStep();
  if (step === 3) renderObjectsStep();
  if (step === 4) renderAttrsStep();
  if (step === 5) renderE2OStep();
  if (step === 6) renderO2OStep();
};

//#region STEP 0: UPLOAD JSON

const uploadZone = document.getElementById("uploadZone");
const fileInput = document.getElementById("fileInput");
const uploadStatus = document.getElementById("uploadStatus");
const btnGoStep1 = document.getElementById("btn01");

/*
Click sulla zona -> apre il file picker
La condizione "e.target !== fileInput" evita il doppio-click quando
l'utente clicca direttamente sull'input nascosto
*/
uploadZone.addEventListener("click", (e) => {
  if (e.target !== fileInput) fileInput.click();
});

/*
Drag & drop — usa un contatore per evitare
il flickering (aggiunta e rimozione repentina BUG) del bordo
quando il cursore attraversa elementi figli della zona
*/
let dragDepth = 0;
uploadZone.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  uploadZone.classList.add("drag");
});
uploadZone.addEventListener("dragleave", () => {
  dragDepth--;
  if (dragDepth === 0) uploadZone.classList.remove("drag");
});
uploadZone.addEventListener("dragover", (e) => e.preventDefault());
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  uploadZone.classList.remove("drag");
  handleFile(e.dataTransfer.files[0]);
});

// File picker
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

// aggiorna S e l'UI dopo il caricamento di un file
function _processRecords(records, filename) {
  if (!records.length) throw new Error("Il contenuto non contiene record.");

  S.filename = filename;
  S.raw = records;
  // Scansiona TUTTI i record per rilevare campi annidati:
  // record con functionName diversi possono avere strutture diverse
  S.nestedCols = detectNestedColumns(records);

  uploadStatus.className = "msg success";
  uploadStatus.textContent =
    `✓ Caricati ${records.length.toLocaleString()} record · ` +
    `${Object.keys(records[0]).length} colonne top-level`;
  uploadStatus.classList.remove("hidden");

  btnGoStep1.classList.remove("hidden");
}

/** Gestisce il file scelto (da picker o drag & drop) */
async function handleFile(file) {
  if (!file) return;

  uploadStatus.className = "msg";
  uploadStatus.textContent = "⏳ Caricamento…";
  uploadStatus.classList.remove("hidden");

  try {
    const records = await loadFromBrowserFile(file);
    _processRecords(records, file.name.replace(/\.[^.]+$/, ""));
  } catch (err) {
    uploadStatus.className = "msg error";
    uploadStatus.textContent = `✗ ${err.message}`;
    btnGoStep1.classList.add("hidden");
  }
}

// caricamento da textarea (JSON incollato)
window.loadFromText = function () {
  const raw = document.getElementById("jsonPasteArea").value.trim();
  if (!raw) return;

  uploadStatus.className = "msg";
  uploadStatus.textContent = "⏳ Parsing…";
  uploadStatus.classList.remove("hidden");

  try {
    const records = parseJsonOrJsonl(raw);
    _processRecords(records, "pasted-data");
  } catch (err) {
    uploadStatus.className = "msg error";
    uploadStatus.textContent = `✗ ${err.message} — Verifica che il testo sia JSON valido.`;
    btnGoStep1.classList.add("hidden");
  }
};

// reset completo — bottone "Start over"
window.resetAll = function () {
  // Azzera lo stato globale
  S.raw = [];
  S.records = [];
  S.allCols = [];
  S.nestedCols = [];
  S.selectedNested = [];
  S.ocel = null;
  S.config = null;
  S.filename = "output";
  S.eventIdCol = "";
  S.activityCol = "";
  S.timestampCol = NONE_SENTINEL;
  S.objectCols = [];
  S.objAttrs = {};
  S.evAttrs = [];
  S.e2oRules = [];
  S.o2oRules = [];

  // Azzera gli input di upload
  fileInput.value = "";
  document.getElementById("jsonPasteArea").value = "";

  // Nasconde il messaggio di stato e il bottone Next
  uploadStatus.textContent = "";
  uploadStatus.className = "hidden";
  btnGoStep1.classList.add("hidden");

  // Torna allo step 0
  goTo(0);
};

//#endregion

//#region STEP 1: Normalizzazione

// step 1: mostra i tag delle colonne annidate, tutte pre-selezionate
function renderNormalizeStep() {
  const container = document.getElementById("nestedCols");

  if (!S.nestedCols.length) {
    // Nessuna colonna annidata -> normalizzazione automatica (nulla da fare)
    container.innerHTML =
      '<p style="color:var(--muted); font-size:13px">Nessuna colonna annidata rilevata — nulla da appiattire.</p>';
    S.selectedNested = [];
    // Esegue la normalizzazione silenziosamente per aggiornare S.records e S.allCols
    _applyNormalization();
    return;
  }

  container.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "tag-grid";

  S.nestedCols.forEach((col) => {
    const tag = document.createElement("div");
    tag.className = "tag selected"; // pre-selezionate: default "appiattisce tutto"
    tag.dataset.col = col;
    tag.innerHTML = `${col} <span class="sample">(annidato)</span>`;

    tag.addEventListener("click", () => {
      tag.classList.toggle("selected");
      // Aggiorna selectedNested in tempo reale (utile se l'utente torna indietro)
      S.selectedNested = [...grid.querySelectorAll(".tag.selected")].map(
        (t) => t.dataset.col,
      );
    });

    grid.appendChild(tag);
  });

  container.appendChild(grid);
  S.selectedNested = [...S.nestedCols]; // tutte selezionate di default
}

// normalizzazione silenziosa — usata quando non ci sono colonne annidate
function _applyNormalization() {
  S.records = normalizeRecords(S.raw, S.selectedNested);
  // Raccoglie le chiavi da TUTTI i record, non solo il primo
  // (evita il problema di avere diverse colonne in case differenti nel JSON)
  // dopo la normalizzazione dot-notation (per esempio input.N.value), record diversi producono chiavi diverse
  S.allCols = collectAllColumns(S.records);
}

// bottone "Normalize & Continue": appiattisce e va allo step 2
window.doNormalize = function () {
  S.selectedNested = [
    ...document.querySelectorAll("#step-1 .tag.selected"),
  ].map((t) => t.dataset.col);
  S.records = normalizeRecords(S.raw, S.selectedNested);
  // Raccoglie le chiavi da TUTTI i record normalizzati
  S.allCols = collectAllColumns(S.records);

  // Progressione verso lo step 2
  goTo(2);
};

//#endregion

//#region STEP 2: Core Fields (campi chiave: EventID, Activity Column, TimeStamp Column)

// step 2: popola le tre <select> con le colonne e prova a fare auto-guess
function renderCoreStep() {
  /** genera le <option> HTML; addNone aggiunge "— nessuno —" in cima */
  const buildOptions = (addNone = false) => {
    let html = addNone
      ? `<option value="${NONE_SENTINEL}">— nessuno —</option>`
      : "";
    S.allCols.forEach((col) => {
      const samples = sampleValues(S.records, col).join(" | ");
      html += `<option value="${col}">${col}  (${samples})</option>`;
    });
    return html;
  };

  document.getElementById("sel-eventId").innerHTML = buildOptions(false);
  document.getElementById("sel-activity").innerHTML = buildOptions(false);
  document.getElementById("sel-timestamp").innerHTML = buildOptions(true);

  // Auto-selezione: scorre le keywords in ordine e seleziona
  _autoGuess("sel-eventId", [
    "txhash",
    "transactionhash",
    "id",
    "hash",
    "txid",
  ]);
  _autoGuess("sel-activity", [
    "functionname",
    "activity",
    "action",
    "method",
    "type",
    "event",
  ]);
  _autoGuess("sel-timestamp", [
    "timestamp",
    "time",
    "datetime",
    "createdat",
    "date",
  ]);
}

// cerca la prima keyword nella lista delle colonne e pre-seleziona quella
function _autoGuess(selectId, keywords) {
  const sel = document.getElementById(selectId);
  const lower = S.allCols.map((c) => c.toLowerCase());

  for (const kw of keywords) {
    const idx = lower.findIndex((c) => c.includes(kw));
    if (idx !== -1) {
      sel.value = S.allCols[idx];
      return;
    }
  }
}

//#endregion

//#region STEP 3: Tipi di Oggetto

// step 3: griglia di tag per scegliere le colonne ID oggetto
function renderObjectsStep() {
  const tagGrid = document.getElementById("objectTagGrid");
  const nameRows = document.getElementById("typeNameRows");
  tagGrid.innerHTML = "";
  nameRows.innerHTML = "";

  S.allCols.forEach((col) => {
    const tag = document.createElement("div");
    // Mantiene la selezione precedente se l'utente torna indietro
    const isSelected = S.objectCols.some((o) => o.col === col);
    tag.className = "tag" + (isSelected ? " selected" : "");
    tag.dataset.col = col;

    const sample = sampleValues(S.records, col)[0] || "";
    tag.innerHTML = `${col} <span class="sample">${sample}</span>`;

    tag.addEventListener("click", () => {
      tag.classList.toggle("selected");
      _syncObjectTypeRows();
    });

    tagGrid.appendChild(tag);
  });

  // Ripristina le righe dei nomi tipo se ci sono selezioni precedenti
  if (S.objectCols.length) _syncObjectTypeRows();
}

// aggiorna le righe input per i nomi-tipo ogni volta che cambia la selezione
function _syncObjectTypeRows() {
  const selected = [
    ...document.querySelectorAll("#objectTagGrid .tag.selected"),
  ].map((t) => t.dataset.col);
  const rows = document.getElementById("typeNameRows");
  rows.innerHTML = "";

  // Aggiorna S.objectCols preservando i typeName già inseriti
  S.objectCols = selected.map((col) => {
    const prev = S.objectCols.find((o) => o.col === col);
    // Default typeName: ultima parte del nome colonna (es. "sender" -> "sender")
    return {
      col,
      typeName: prev?.typeName || col.split(/[._]/).pop().toLowerCase(),
    };
  });

  // Crea una riga <input> per ogni tipo selezionato
  S.objectCols.forEach((obj, idx) => {
    const row = document.createElement("div");
    row.className = "grid-2";
    row.style.alignItems = "center";
    row.innerHTML = `
      <div style="font-size:12px; color:var(--muted)">
        Nome tipo per <strong style="color:var(--text)">${obj.col}</strong>
      </div>
      <input type="text" value="${obj.typeName}" data-idx="${idx}" placeholder="account" />
    `;
    // Aggiorna S.objectCols[idx].typeName in tempo reale mentre l'utente digita
    row.querySelector("input").addEventListener("input", (e) => {
      S.objectCols[idx].typeName = e.target.value.trim() || "object";
    });
    rows.appendChild(row);
  });
}

//#endregion

//#region STEP 4: Attributi (inserimento attributi a oggetti o eventi)

// step 4: attributi per ogni tipo oggetto + attributi evento
// esclude le colonne già usate nei passi precedenti
function renderAttrsStep() {
  // Colonne occupate dai campi core e dagli ID oggetto
  const coreUsed = new Set([
    document.getElementById("sel-eventId").value,
    document.getElementById("sel-activity").value,
    document.getElementById("sel-timestamp").value,
    ...S.objectCols.map((o) => o.col),
  ]);
  const remaining = S.allCols.filter((c) => !coreUsed.has(c));

  // Griglia attributi per ogni tipo oggetto
  const objRows = document.getElementById("objAttrRows");
  objRows.innerHTML = "";

  S.objectCols.forEach((obj) => {
    const prevAttrs = S.objAttrs[obj.typeName] || [];
    const section = document.createElement("div");
    section.style.marginBottom = "12px";
    section.innerHTML = `
      <label>Attributi per <strong>${obj.typeName}</strong></label>
      <div class="tag-grid" data-type="${obj.typeName}"></div>
    `;

    const tagGrid = section.querySelector(".tag-grid");
    remaining.forEach((col) => {
      const tag = document.createElement("div");
      tag.className = "tag" + (prevAttrs.includes(col) ? " selected" : "");
      tag.dataset.col = col;
      tag.textContent = col;
      tag.addEventListener("click", () => {
        tag.classList.toggle("selected");

        S.objAttrs[obj.typeName] = [
          ...tagGrid.querySelectorAll(".tag.selected"),
        ].map((t) => t.dataset.col);
      });
      tagGrid.appendChild(tag);
    });

    objRows.appendChild(section);
    S.objAttrs[obj.typeName] = prevAttrs;
  });

  // Griglia attributi evento (esclude le colonne già usate come attributi oggetto)
  const evGrid = document.getElementById("evAttrGrid");
  evGrid.innerHTML = "";
  const allObjAttrs = new Set(Object.values(S.objAttrs).flat());

  remaining
    .filter((c) => !allObjAttrs.has(c))
    .forEach((col) => {
      const tag = document.createElement("div");
      tag.className = "tag" + (S.evAttrs.includes(col) ? " selected" : "");
      tag.dataset.col = col;
      tag.textContent = col;
      tag.addEventListener("click", () => {
        tag.classList.toggle("selected");
        S.evAttrs = [...evGrid.querySelectorAll(".tag.selected")].map(
          (t) => t.dataset.col,
        );
      });
      evGrid.appendChild(tag);
    });
}

//#endregion

//#region STEP 5: REGOLE E2O

// step 5: lista regole E2O — parte con una riga vuota se non ce ne sono ancora
function renderE2OStep() {
  const list = document.getElementById("e2oList");
  list.innerHTML = "";
  if (!S.e2oRules.length) {
    addE2ORow(); // riga vuota
  } else {
    S.e2oRules.forEach((r) => addE2ORow(r));
  }
}

/** aggiunge una riga E2O (colonna + tipo + qualifier + tasto rimuovi) */
window.addE2ORow = function (preset = {}) {
  const list = document.getElementById("e2oList");
  const row = document.createElement("div");
  row.className = "rule-row e2o";

  const colOptions = S.allCols
    .map(
      (c) =>
        `<option value="${c}" ${c === preset.column ? "selected" : ""}>${c}</option>`,
    )
    .join("");
  const typeOptions = S.objectCols
    .map(
      (o) =>
        `<option value="${o.typeName}" ${o.typeName === preset.objectType ? "selected" : ""}>${o.typeName}</option>`,
    )
    .join("");

  row.innerHTML = `
    <div><label>Colonna</label><select>${colOptions}</select></div>
    <div><label>Tipo oggetto</label><select>${typeOptions}</select></div>
    <div><label>Qualifier</label>
      <input type="text" value="${preset.qualifier || ""}" placeholder="es. initiator" />
    </div>
    <button class="btn-rm" onclick="this.closest('.rule-row').remove(); _syncE2O()">✕</button>
  `;

  // Aggiorna S.e2oRules
  row.querySelectorAll("select, input").forEach((el) => {
    el.addEventListener("change", _syncE2O);
    el.addEventListener("input", _syncE2O);
  });

  list.appendChild(row);
  _syncE2O();
};

// legge le righe E2O dal DOM -> S.e2oRules (scarta quelle senza qualifier)
function _syncE2O() {
  S.e2oRules = [...document.querySelectorAll("#e2oList .rule-row")]
    .map((row) => {
      const [col, type] = [...row.querySelectorAll("select")].map(
        (s) => s.value,
      );
      const qual = row.querySelector("input").value.trim();
      return { column: col, objectType: type, qualifier: qual };
    })
    .filter((r) => r.qualifier);
}

// Esposta su window per essere chiamata dagli onclick delle righe
window._syncE2O = _syncE2O;

//#endregion

//#region STEP 6: Regole O2O

// step 6: lista regole O2O
function renderO2OStep() {
  const list = document.getElementById("o2oList");
  list.innerHTML = "";
  S.o2oRules.forEach((r) => addO2ORow(r));
}

/** aggiunge una riga O2O (src type + src col + dst type + dst col + qualifier) */
window.addO2ORow = function (preset = {}) {
  const list = document.getElementById("o2oList");
  const row = document.createElement("div");
  row.className = "rule-row o2o";

  const colOptions = S.allCols
    .map((c) => `<option value="${c}">${c}</option>`)
    .join("");
  const typeOptions = S.objectCols
    .map((o) => `<option value="${o.typeName}">${o.typeName}</option>`)
    .join("");

  row.innerHTML = `
    <div><label>Tipo src</label><select>${typeOptions}</select></div>
    <div><label>Col src</label><select>${colOptions}</select></div>
    <div><label>Tipo dst</label><select>${typeOptions}</select></div>
    <div><label>Col dst</label><select>${colOptions}</select></div>
    <div><label>Qualifier</label>
      <input type="text" value="${preset.qualifier || ""}" placeholder="es. interacts_with" />
    </div>
    <button class="btn-rm" onclick="this.closest('.rule-row').remove(); _syncO2O()">✕</button>
  `;

  // Pre-seleziona i valori del preset
  const selects = row.querySelectorAll("select");
  if (preset.sourceType) selects[0].value = preset.sourceType;
  if (preset.sourceColumn) selects[1].value = preset.sourceColumn;
  if (preset.targetType) selects[2].value = preset.targetType;
  if (preset.targetColumn) selects[3].value = preset.targetColumn;

  row.querySelectorAll("select, input").forEach((el) => {
    el.addEventListener("change", _syncO2O);
    el.addEventListener("input", _syncO2O);
  });

  list.appendChild(row);
  _syncO2O();
};

// legge le righe O2O dal DOM -> S.o2oRules
function _syncO2O() {
  S.o2oRules = [...document.querySelectorAll("#o2oList .rule-row")]
    .map((row) => {
      const [srcType, srcCol, tgtType, tgtCol] = [
        ...row.querySelectorAll("select"),
      ].map((s) => s.value);
      const qual = row.querySelector("input").value.trim();
      return {
        sourceType: srcType,
        sourceColumn: srcCol,
        targetType: tgtType,
        targetColumn: tgtCol,
        qualifier: qual,
      };
    })
    .filter((r) => r.qualifier);
}

window._syncO2O = _syncO2O;

//#endregion

//#region ESECUZIONE DEL MAPPING

// step finale: costruisce il config, esegue il mapping, va allo step 7
window.runMapping = function () {
  // Sincronizza le regole E2O e O2O prima di leggere S
  _syncE2O();
  _syncO2O();

  // Legge le selezioni core dai <select> dello step 2
  S.eventIdCol = document.getElementById("sel-eventId").value;
  S.activityCol = document.getElementById("sel-activity").value;
  S.timestampCol = document.getElementById("sel-timestamp").value;

  // Legge gli attributi oggetto dai tag selezionati dello step 4
  document.querySelectorAll("#objAttrRows [data-type]").forEach((grid) => {
    S.objAttrs[grid.dataset.type] = [
      ...grid.querySelectorAll(".tag.selected"),
    ].map((t) => t.dataset.col);
  });
  S.evAttrs = [...document.querySelectorAll("#evAttrGrid .tag.selected")].map(
    (t) => t.dataset.col,
  );

  // Costruisce objectTypes combinando col, typeName e attributi
  const objectTypes = S.objectCols.map((o) => ({
    name: o.typeName,
    idColumn: o.col,
    attributes: S.objAttrs[o.typeName] || [],
  }));

  // Assembla il MappingConfig
  S.config = buildConfig({
    eventIdColumn: S.eventIdCol,
    activityColumn: S.activityCol,
    timestampColumn: S.timestampCol,
    columnsToNormalize: S.selectedNested,
    objectTypes,
    eventAttributes: S.evAttrs,
    e2oRules: S.e2oRules,
    o2oRules: S.o2oRules,
  });

  try {
    S.ocel = new OcelMapper(S.config).map(S.records);
    goTo(7);
    _renderResult();
  } catch (err) {
    alert(`Errore durante il mapping: ${err.message}`);
  }
};

//#endregion

//#region STEP 7 — RISULTATO

// step 7: statistiche, messaggi di validazione e anteprima JSON
function _renderResult() {
  const { valid, errors, warnings } = validateOcel(S.ocel);
  const stats = getOcelStats(S.ocel);

  // Griglia statistiche
  const statsGrid = document.getElementById("statsGrid");
  statsGrid.innerHTML = [
    [stats.totalEvents, "Eventi"],
    [stats.totalObjects, "Oggetti"],
    [stats.totalE2ORelations, "Relazioni E2O"],
    [stats.totalO2ORelations, "Relazioni O2O"],
  ]
    .map(
      ([val, label]) => `
    <div class="stat-box">
      <div class="val">${val.toLocaleString()}</div>
      <div class="lbl">${label}</div>
    </div>
  `,
    )
    .join("");

  // Messaggi di validazione
  const msgs = document.getElementById("resultMsgs");
  msgs.innerHTML = "";

  if (valid && !warnings.length) {
    msgs.innerHTML = '<div class="msg success">✓ Log OCEL 2.0 valido</div>';
  }
  warnings.forEach((w) =>
    msgs.insertAdjacentHTML("beforeend", `<div class="msg warn">⚠ ${w}</div>`),
  );
  errors.forEach((e) =>
    msgs.insertAdjacentHTML("beforeend", `<div class="msg error">✗ ${e}</div>`),
  );

  // Anteprima JSON
  const full = JSON.stringify(S.ocel, null, 2);
  document.getElementById("jsonPreview").textContent = full;
}

//#endregion

//#region DOWNLOAD

// download del file OCEL o del config JSON
window.dl = function (type) {
  if (type === "ocel") downloadOcel(S.ocel, `${S.filename}.jsonocel`);
  if (type === "config") downloadConfig(S.config, `${S.filename}-config.json`);
};

//#endregion
