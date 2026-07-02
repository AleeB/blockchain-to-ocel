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
  serializeOcel,
  downloadOcel,
  downloadConfig,
  NONE_SENTINEL,
  UUID_SENTINEL,
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
  // Colonne che fungono da activity. Stessa UX di objectCols: lista con un
  // typeName opzionale per ognuna. Se typeName è vuoto, l'event.type sarà il
  // valore della cella; se è valorizzato, l'event.type sarà il typeName e il
  // valore della cella finisce in attributes._activity.
  activityCols: [], // [{ col: string, typeName: string }]
  timestampCol: NONE_SENTINEL, //evitiamo un code smell
  objectCols: [], // [{ col: string, typeName: string }]
  objAttrs: {}, // { typeName: string[] }  — attributi per ogni tipo oggetto
  evAttrs: {}, // { [eventType]: string[] } — attributi PER tipo di evento
  evAttrExpanded: {}, // { [sourceKey]: bool } — sorgenti espanse per tipo
  e2oRules: [], // [{ column, objectType, qualifier }]
  o2oRules: [], // [{ sourceType, sourceColumn, targetType, targetColumn, qualifier }]

  // Sorgenti di eventi aggiuntive: ogni elemento di un array annidato
  // produce un evento OCEL extra che eredita oggetti e tempo dal padre
  extraSources: [], // [{ arrayPath, activityField, qualifier }]
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
  if (step === 2) renderEventsStep();
  if (step === 3) renderEventAttrsStep();
  if (step === 4) renderObjectsStep();
  if (step === 5) renderObjectAttrsStep();
  if (step === 6) renderE2OStep();
  if (step === 7) renderO2OStep();
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

/** Crea un mini-bottone "Seleziona/Deseleziona tutti" per una tag-grid.
 *  Lo aggiunge sopra il `gridEl`, calcolando lo stato iniziale dai tag presenti.
 *  Quando l'utente clicca, vengono triggerati anche i click sui singoli tag
 *  per mantenere consistenti gli handler già collegati (sync di S, ecc.). */
function _addToggleAllButton(gridEl, label = "Seleziona tutti") {
  // Evita doppi inserimenti se la funzione viene richiamata sullo stesso grid
  const existing = gridEl.previousElementSibling;
  if (existing?.classList.contains("toggle-all-btn")) existing.remove();

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "toggle-all-btn";
  btn.textContent = label;
  btn.addEventListener("click", () => {
    const tags = [...gridEl.querySelectorAll(".tag")];
    if (!tags.length) return;
    const allSelected = tags.every((t) => t.classList.contains("selected"));
    // Se tutti sono già selezionati, deseleziona tutti; altrimenti seleziona tutti
    tags.forEach((tag) => {
      const isSelected = tag.classList.contains("selected");
      if (allSelected && isSelected) tag.click();
      else if (!allSelected && !isSelected) tag.click();
    });
  });

  gridEl.parentNode.insertBefore(btn, gridEl);
}

/** Raggruppa i tag di una grid che condividono lo stesso prefisso di array
 *  appiattito (es. "inputs.0.inputName", "inputs.1.type" → prefisso "inputs")
 *  dietro un bottone-combobox + un triangolino di espansione separato:
 *  - il bottone (testo + contatore) seleziona/deseleziona TUTTO il gruppo
 *    in un click, com'era già;
 *  - il triangolino ▸/▾ espande/comprime la lista SENZA toccare la
 *    selezione, così è possibile selezionare anche un singolo elemento su
 *    centinaia senza dover prima selezionarli tutti e poi deselezionare
 *    il resto.
 *
 *  I tag del gruppo sono visibili quando il gruppo è espanso a mano
 *  (triangolino) OPPURE quando c'è almeno un elemento selezionato al suo
 *  interno (così lo stato "parziale" resta sempre ispezionabile).
 *
 *  Stato del bottone principale:
 *  - tutti selezionati  → stile "pieno" (classe selected)
 *  - nessuno selezionato → stile normale, contatore "(0)"
 *  - selezione parziale  → stile normale ma testo in grassetto
 *
 *  Va chiamata DOPO che i singoli tag (con i loro handler di stato) sono
 *  già stati inseriti nella grid, così il bottone può riusare tag.click()
 *  per restare sincronizzato con lo stato applicativo (S.*) senza duplicarlo. */
function _addGroupedToggleButtons(gridEl) {
  const tags = [...gridEl.querySelectorAll(".tag[data-col]")];
  if (!tags.length) return;

  // Una colonna appartiene a un gruppo quando è nella forma "prefix.<indice>.resto"
  const groupRe = /^(.+?)\.\d+\.[^.]+$/;
  const groups = new Map(); // prefix -> tagEl[]
  tags.forEach((tag) => {
    const m = tag.dataset.col.match(groupRe);
    if (!m) return;
    const prefix = m[1];
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push(tag);
  });

  for (const [prefix, groupTags] of groups) {
    // Se il gruppo arriva già con qualcosa di selezionato (es. tornando a
    // uno step precedente), parte espanso così lo stato è visibile subito.
    // Da qui in poi però il triangolino è l'unico a decidere: si può
    // richiudere il gruppo anche con elementi ancora selezionati.
    let expanded = groupTags.some((t) => t.classList.contains("selected"));

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag group-toggle";

    const caret = document.createElement("button");
    caret.type = "button";
    caret.className = "group-toggle-caret";
    caret.title = "Espandi/comprimi la lista";

    // Contenitore dei tag del gruppo: "display:contents" li fa comportare
    // come figli diretti della grid (stesso layout flex-wrap), ma permette
    // di nascondere/mostrare l'intero gruppo con un solo display toggle.
    const wrapper = document.createElement("div");
    wrapper.className = "group-wrapper";
    gridEl.insertBefore(wrapper, groupTags[0]);
    groupTags.forEach((t) => wrapper.appendChild(t));

    // Righe separatrici (colore del bottone) che delimitano visivamente
    // dove iniziano e finiscono i campi del gruppo, visibili solo quando
    // il gruppo è espanso. flex-basis:100% forza a capo nella grid a
    // flex-wrap, facendo apparire la riga come un divisore a tutta larghezza.
    const topLine = document.createElement("div");
    topLine.className = "group-divider";
    const bottomLine = document.createElement("div");
    bottomLine.className = "group-divider";

    gridEl.insertBefore(topLine, wrapper);
    gridEl.insertBefore(caret, topLine);
    gridEl.insertBefore(btn, caret);
    wrapper.after(bottomLine);

    const updateVisibility = () => {
      wrapper.style.display = expanded ? "contents" : "none";
      topLine.style.display = expanded ? "block" : "none";
      bottomLine.style.display = expanded ? "block" : "none";
      caret.textContent = expanded ? "▾" : "▸";
    };

    const updateBtn = () => {
      const selCount = groupTags.filter((t) =>
        t.classList.contains("selected"),
      ).length;
      const allSel = selCount === groupTags.length;
      const noneSel = selCount === 0;
      btn.classList.toggle("selected", allSel);
      btn.style.fontWeight = !allSel && !noneSel ? "700" : "400";
      btn.textContent = `${prefix} (${selCount})`;
    };

    btn.addEventListener("click", () => {
      const selCount = groupTags.filter((t) =>
        t.classList.contains("selected"),
      ).length;
      const allSel = selCount === groupTags.length;
      // Tutti selezionati -> deseleziona tutto; altrimenti seleziona tutto
      groupTags.forEach((t) => {
        const isSel = t.classList.contains("selected");
        if (allSel && isSel) t.click();
        else if (!allSel && !isSel) t.click();
      });
      // Selezionando tutto vogliamo vederlo; deselezionando tutto torniamo
      // allo stato compatto (a meno che l'utente non riespanda a mano).
      expanded = !allSel;
      updateBtn();
      updateVisibility();
    });

    caret.addEventListener("click", () => {
      expanded = !expanded;
      updateVisibility();
    });

    // Ogni click su un tag del gruppo (singolo) tiene aggiornato il bottone
    // (solo contatore/grassetto: la visibilità resta decisa dal triangolino)
    groupTags.forEach((t) => t.addEventListener("click", updateBtn));

    updateBtn();
    updateVisibility();
  }
}

/** Mostra/aggiorna/nasconde un loader generico (upload o mapping). */
function _showLoader(prefix, text, ratio) {
  const root = document.getElementById(`${prefix}Loader`);
  if (!root) return;
  root.classList.remove("hidden");
  document.getElementById(`${prefix}LoaderText`).textContent = text;
  const pct = Math.round((ratio || 0) * 100);
  document.getElementById(`${prefix}LoaderPct`).textContent = `${pct}%`;
  document.getElementById(`${prefix}LoaderFill`).style.width = `${pct}%`;
}
function _hideLoader(prefix) {
  document.getElementById(`${prefix}Loader`)?.classList.add("hidden");
}

/** Gestisce il file scelto (da picker o drag & drop) */
async function handleFile(file) {
  if (!file) return;

  uploadStatus.className = "msg";
  uploadStatus.textContent = "⏳ Caricamento…";
  uploadStatus.classList.remove("hidden");

  try {
    const records = await loadFromBrowserFile(file, {
      onProgress: (p) => {
        const label = p.phase === "parsing" ? "Parsing JSON…" : "Lettura file…";
        _showLoader("upload", label, p.ratio);
      },
    });
    _hideLoader("upload");
    _processRecords(records, file.name.replace(/\.[^.]+$/, ""));
  } catch (err) {
    _hideLoader("upload");
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
  S.activityCols = [];
  S.timestampCol = NONE_SENTINEL;
  S.objectCols = [];
  S.objAttrs = {};
  S.evAttrs = {};
  S.evAttrExpanded = {};
  S.e2oRules = [];
  S.o2oRules = [];
  S.extraSources = [];

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
  _addToggleAllButton(grid, "Seleziona / Deseleziona tutti");
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

//#region STEP 2: Events (EventID + activity + timestamp + sorgenti aggiuntive)

// step 2: popola le tre <select> con le colonne e prova a fare auto-guess.
// Mostra anche la sezione "sorgenti aggiuntive" per estrarre eventi extra
// da array annidati (es. events[], internalTxs[]).
function renderEventsStep() {
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

  const evIdSel = document.getElementById("sel-eventId");
  evIdSel.innerHTML = buildOptions(false);
  document.getElementById("sel-timestamp").innerHTML = buildOptions(true);

  // Se in passaggi precedenti era stato attivato UUID, ripristina lo stato visuale
  _applyUuidVisualState(S.eventIdCol === UUID_SENTINEL);

  // Auto-selezione: scorre le keywords in ordine e seleziona
  _autoGuess("sel-eventId", [
    "eventid",
    "txhash",
    "transactionhash",
    "id",
    "hash",
    "txid",
  ]);
  _autoGuess("sel-timestamp", [
    "timestamp",
    "time",
    "datetime",
    "createdat",
    "date",
  ]);

  // Griglia di tag per scegliere le colonne activity (stesso pattern di Objects)
  _renderActivityTagGrid();

  // Sorgenti aggiuntive: array di oggetti annidati nei record raw
  _renderExtraSourcesSection();
}

/** Griglia di tag per gli Event types: stessa UX di Objects.
 *  L'utente seleziona N colonne; ognuna avrà un input per il typeName. */
function _renderActivityTagGrid() {
  const grid = document.getElementById("activityTagGrid");
  if (!grid) return;
  grid.innerHTML = "";

  S.allCols.forEach((col) => {
    const tag = document.createElement("div");
    const isSel = S.activityCols.some((a) => a.col === col);
    tag.className = "tag" + (isSel ? " selected" : "");
    tag.dataset.col = col;
    const sample = sampleValues(S.records, col)[0] || "";
    tag.innerHTML = `${col} <span class="sample">${sample}</span>`;
    tag.addEventListener("click", () => {
      tag.classList.toggle("selected");
      _syncActivityTypeRows();
    });
    grid.appendChild(tag);
  });

  // Auto-detect: se non c'è nessuna selezione, pre-seleziona la prima colonna
  // che assomiglia a un campo activity
  if (!S.activityCols.length) {
    const lower = S.allCols.map((c) => c.toLowerCase());
    const candidates = ["functionname", "activity", "action", "method", "type", "event"];
    for (const kw of candidates) {
      const idx = lower.findIndex((c) => c.includes(kw));
      if (idx !== -1) {
        const tag = grid.querySelector(`.tag[data-col="${S.allCols[idx]}"]`);
        if (tag) tag.classList.add("selected");
        break;
      }
    }
  }
  _addToggleAllButton(grid, "Seleziona / Deseleziona tutti");
  _addGroupedToggleButtons(grid);
  _syncActivityTypeRows();
}

/** Aggiorna S.activityCols in base ai tag attualmente selezionati. */
function _syncActivityTypeRows() {
  const selected = [
    ...document.querySelectorAll("#activityTagGrid .tag.selected[data-col]"),
  ].map((t) => t.dataset.col);

  // Il typeName resta sempre vuoto: il tipo OCEL è il valore della cella.
  S.activityCols = selected.map((col) => ({ col, typeName: "" }));
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

/** Attiva/disattiva la modalità "UUID random" per l'Event ID.
 *  Quando attiva, il select viene disabilitato e S.eventIdCol = UUID_SENTINEL.
 *  Il bottone alterna stato visivo (acceso/spento) per dare feedback chiaro. */
window.toggleUuidId = function () {
  const wasOn = S.eventIdCol === UUID_SENTINEL;
  S.eventIdCol = wasOn ? "" : UUID_SENTINEL;
  _applyUuidVisualState(!wasOn);
};

function _applyUuidVisualState(on) {
  const sel = document.getElementById("sel-eventId");
  const btn = document.getElementById("btnUuid");
  if (!sel || !btn) return;
  sel.disabled = on;
  sel.style.opacity = on ? "0.4" : "1";
  if (on) {
    btn.classList.remove("btn-secondary");
    btn.classList.add("btn-success");
    btn.textContent = "UUID attivo";
  } else {
    btn.classList.add("btn-secondary");
    btn.classList.remove("btn-success");
    btn.textContent = "UUID";
  }
}

/** Mostra i tag delle colonne RAW che sono array di oggetti, oltre alle
 *  righe di configurazione per quelle attualmente selezionate. */
function _renderExtraSourcesSection() {
  const grid = document.getElementById("extraSourcesGrid");
  const rows = document.getElementById("extraSourcesRows");
  if (!grid || !rows) return;
  grid.innerHTML = "";

  // Trova le colonne top-level dei record raw che sono array di oggetti.
  // Sono le uniche utilizzabili come sorgenti aggiuntive (un elemento = un evento).
  const sample = S.raw[0] || {};
  const candidates = Object.keys(sample).filter((k) => {
    const v = sample[k];
    return Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null;
  });

  if (!candidates.length) {
    grid.innerHTML =
      '<p style="color:var(--muted); font-size:12px">Nessun array di oggetti rilevato nei record sorgente.</p>';
    rows.innerHTML = "";
    return;
  }

  candidates.forEach((path) => {
    const tag = document.createElement("div");
    const isSel = S.extraSources.some((s) => s.arrayPath === path);
    tag.className = "tag" + (isSel ? " selected" : "");
    tag.dataset.path = path;
    tag.innerHTML = `${path}[]`;
    tag.addEventListener("click", () => {
      tag.classList.toggle("selected");
      _syncExtraSourceRows();
    });
    grid.appendChild(tag);
  });

  _addToggleAllButton(grid, "Seleziona / Deseleziona tutti");
  _syncExtraSourceRows();
}

/** Anteprima di un elemento rappresentativo per un dato valore del campo
 *  activity: alcuni campi scalari (non activityField) del primo item, in
 *  qualsiasi record raw, con quel valore — utile per distinguere i tipi
 *  quando il campo activity non è tra le prime chiavi dell'oggetto. */
function _itemPreviewForType(arrayPath, activityField, typeValue) {
  for (const r of S.raw) {
    const arr = r[arrayPath];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (!item || String(item[activityField]) !== typeValue) continue;
      const parts = [];
      for (const [k, v] of Object.entries(item)) {
        if (k === activityField) continue;
        if (v === null || typeof v === "object") continue;
        parts.push(`${k}: ${String(v).slice(0, 30)}`);
        if (parts.length >= 3) break;
      }
      return parts.join(", ");
    }
  }
  return "";
}

/** Calcola i valori distinti di un campo dentro un array path,
 *  attraverso tutti i record raw. Cappa il numero per evitare grid enormi. */
function _distinctValuesInArray(arrayPath, fieldName, cap = 200) {
  const out = new Set();
  for (const r of S.raw) {
    const arr = r[arrayPath];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const v = item?.[fieldName];
      if (v !== null && v !== undefined && v !== "") out.add(String(v));
      if (out.size >= cap) break;
    }
    if (out.size >= cap) break;
  }
  return [...out].sort();
}

/** Valori distinti di una colonna top-level. Stessa logica con cap di sicurezza. */
function _distinctValuesInColumn(col, cap = 200) {
  const out = new Set();
  for (const r of S.records) {
    const v = r[col];
    if (v !== null && v !== undefined && v !== "") out.add(String(v));
    if (out.size >= cap) break;
  }
  return [...out].sort();
}

/** Allinea S.extraSources e le righe di config in base ai tag selezionati. */
function _syncExtraSourceRows() {
  const selected = [
    ...document.querySelectorAll("#extraSourcesGrid .tag.selected"),
  ].map((t) => t.dataset.path);

  // Aggiorna S.extraSources preservando i valori già inseriti
  S.extraSources = selected.map((path) => {
    const prev = S.extraSources.find((s) => s.arrayPath === path);
    const sampleItem = S.raw[0]?.[path]?.[0] || {};
    const itemKeys = Object.keys(sampleItem);
    return {
      arrayPath: path,
      activityField: prev?.activityField || itemKeys[0] || "",
      qualifier: prev?.qualifier || path,
      // includeTypes vuoto = nessun filtro (include tutti i tipi distinti)
      includeTypes: prev?.includeTypes ? [...prev.includeTypes] : [],
    };
  });

  const rows = document.getElementById("extraSourcesRows");
  rows.innerHTML = "";

  S.extraSources.forEach((src, idx) => {
    const sampleItem = S.raw[0]?.[src.arrayPath]?.[0] || {};
    const fieldOptions = Object.keys(sampleItem)
      .map(
        (k) =>
          `<option value="${k}" ${k === src.activityField ? "selected" : ""}>${k}</option>`,
      )
      .join("");

    const card = document.createElement("div");
    card.style.padding = "12px";
    card.style.background = "var(--bg)";
    card.style.border = "1px solid var(--border)";
    card.style.borderRadius = "8px";
    card.style.marginBottom = "10px";
    card.dataset.srcIdx = idx;

    // Riga di configurazione (campo activity + qualifier)
    card.innerHTML = `
      <div style="display:grid; grid-template-columns: auto 1fr 1fr 1fr; gap:8px; align-items:end">
        <div style="font-size:12px; padding:6px 10px; background:var(--surface); border-radius:4px">
          <strong>${src.arrayPath}</strong>[]
        </div>
        <div>
          <label>Event Type Name</label>
          <select data-key="activityField">${fieldOptions}</select>
        </div>
        <div style="font-size:11px; color:var(--muted)">
          ${(S.raw[0]?.[src.arrayPath] || []).length} elementi nel primo record
        </div>
      </div>
      <div style="margin-top:10px">
        <label>Tipi evento da includere</label>
        <div class="card-desc" style="margin:0 0 6px; font-size:11px">
          Lascia tutti selezionati per includere ogni tipo, oppure scegli solo
          quelli che ti interessano. I tipi sono i valori distinti del
          <code>campo activity</code> qui sopra.
        </div>
        <div class="tag-grid" data-key="includeTypes"></div>
      </div>
    `;

    // Bind input handlers
    card.querySelectorAll("[data-key]").forEach((el) => {
      if (el.dataset.key === "includeTypes") return; // gestito sotto
      const sync = (e) => {
        S.extraSources[idx][e.target.dataset.key] = e.target.value.trim();
        // Se cambia il campo activity, ricalcola la sub-grid dei tipi
        if (e.target.dataset.key === "activityField") {
          S.extraSources[idx].includeTypes = []; // reset filtro
          _renderIncludeTypesGrid(card, idx);
        }
      };
      el.addEventListener("input", sync);
      el.addEventListener("change", sync);
    });

    rows.appendChild(card);
    _renderIncludeTypesGrid(card, idx);
  });
}

/** Disegna la sub-grid dei tipi evento distinti per una sorgente.
 *  Tutti i tag sono selezionati di default; includeTypes vuoto = include tutto.
 *  Quando l'utente deseleziona qualcosa, includeTypes contiene la lista
 *  esplicita dei tipi ammessi. */
function _renderIncludeTypesGrid(card, idx) {
  const src = S.extraSources[idx];
  const grid = card.querySelector('[data-key="includeTypes"]');
  grid.innerHTML = "";
  const types = _distinctValuesInArray(src.arrayPath, src.activityField);
  if (!types.length) {
    grid.innerHTML =
      '<p style="color:var(--muted); font-size:12px">Nessun valore trovato per questo campo.</p>';
    return;
  }
  // Se includeTypes è vuoto significa "tutti": pre-seleziona tutti i tag
  const includeAll = !src.includeTypes || src.includeTypes.length === 0;
  types.forEach((t) => {
    const tag = document.createElement("div");
    const isSel = includeAll || src.includeTypes.includes(t);
    tag.className = "tag" + (isSel ? " selected" : "");
    tag.dataset.type = t;
    const preview = _itemPreviewForType(src.arrayPath, src.activityField, t);
    tag.innerHTML = `${t} <span class="sample">${preview}</span>`;
    tag.addEventListener("click", () => {
      tag.classList.toggle("selected");
      const allSelected = [...grid.querySelectorAll(".tag.selected")].map(
        (x) => x.dataset.type,
      );
      // Se TUTTI selezionati → memorizza [] (= nessun filtro = include tutti)
      // Altrimenti memorizza la lista esplicita dei tipi da includere
      S.extraSources[idx].includeTypes =
        allSelected.length === types.length ? [] : allSelected;
    });
    grid.appendChild(tag);
  });
  _addToggleAllButton(grid, "Seleziona / Deseleziona tutti");
}

//#endregion

//#region STEP 3: Tipi di Oggetto

// step 3: griglia di tag per scegliere le colonne ID oggetto
function renderObjectsStep() {
  const tagGrid = document.getElementById("objectTagGrid");
  tagGrid.innerHTML = "";

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

  _addToggleAllButton(tagGrid, "Seleziona / Deseleziona tutti");
  _addGroupedToggleButtons(tagGrid);
  _syncObjectTypeRows();
}

// aggiorna S.objectCols ogni volta che cambia la selezione dei tag.
// Il typeName è derivato automaticamente dal nome colonna (niente input manuale).
function _syncObjectTypeRows() {
  const selected = [
    ...document.querySelectorAll("#objectTagGrid .tag.selected[data-col]"),
  ].map((t) => t.dataset.col);

  // Default typeName: ultima parte del nome colonna (es. "sender" -> "sender")
  S.objectCols = selected.map((col) => ({
    col,
    typeName: col.split(/[._]/).pop().toLowerCase(),
  }));

  // Risoluzione collisioni: colonne diverse possono derivare lo stesso nome
  // (es. inputs.0.inputName e inputs.1.inputName -> "inputname"). Un typeName
  // duplicato farebbe confluire oggetti distinti nello stesso tipo OCEL e le
  // selezioni di attributi (S.objAttrs, indicizzate per typeName) si
  // sovrascriverebbero a vicenda. In caso di conflitto ogni colonna usa il
  // proprio percorso completo (univoco per costruzione) come nome tipo.
  const nameCounts = {};
  S.objectCols.forEach((o) => {
    nameCounts[o.typeName] = (nameCounts[o.typeName] || 0) + 1;
  });
  S.objectCols.forEach((o) => {
    if (nameCounts[o.typeName] > 1) o.typeName = o.col.toLowerCase();
  });
}

//#endregion

//#region STEP 4 & 5: Attributi (eventi e oggetti in step separati)

/** Calcola le colonne libere (non assegnate a ruoli core né a oggetti). */
function _remainingColumns() {
  const used = new Set([
    document.getElementById("sel-eventId").value,
    document.getElementById("sel-timestamp").value,
    ...S.activityCols.map((a) => a.col),
    ...S.objectCols.map((o) => o.col),
  ]);
  return S.allCols.filter((c) => !used.has(c));
}

// step 4: una sezione per ogni SORGENTE di evento. Ogni sorgente ha due modalità:
//  - Collassata (default): un'unica grid di attributi che vale per TUTTI gli
//    eventi prodotti dalla sorgente. Comodo quando i tipi condividono lo
//    schema o quando ce ne sono molti.
//  - Espansa: una sotto-grid per CIASCUN tipo distinto, così l'utente può
//    dare attributi diversi a eventi diversi della stessa sorgente.
// La chiave del mapper-resolver fa fallback sul prefisso, quindi la modalità
// collassata funziona automaticamente (key = sourcePath senza valore).
function renderEventAttrsStep() {
  const evGrid = document.getElementById("evAttrGrid");
  evGrid.innerHTML = "";

  const sources = _enumerateSourcesForAttrs();

  if (!sources.length) {
    evGrid.innerHTML =
      '<p style="color:var(--muted); font-size:13px">Nessuna sorgente di evento selezionata allo step 3.</p>';
    return;
  }

  sources.forEach((src) => _renderEvAttrSource(evGrid, src));
}

/**
 * Per ogni sorgente di evento, descrive:
 *  - sourceKey: chiave "prefisso" (es. "functionName", "internalTxs.activity")
 *  - sourceLabel: etichetta human-readable per il box
 *  - columns: colonne disponibili come attributi
 *  - canExpand: se la sorgente può produrre più di un tipo (toggle espandibile)
 *  - types: lista di sotto-tipi distinti, ognuno con { key, value, label }
 */
function _enumerateSourcesForAttrs() {
  const out = [];
  const remainingTop = _remainingColumns();

  // ----- 1) Sorgenti principali -----
  S.activityCols.forEach((src) => {
    // Valore di esempio della colonna: rende riconoscibile la sorgente
    // anche quando più colonne hanno nomi simili (es. inputs.N.inputName)
    const srcSample = sampleValues(S.records, src.col)[0] || "";
    const sampleHtml = srcSample
      ? ` — es. <span class="sample">${srcSample}</span>`
      : "";
    if (src.typeName) {
      // typeName esplicito: tipo singolo, niente da espandere
      out.push({
        sourceKey: src.typeName,
        sourceLabel: `<strong>${src.typeName}</strong> <span style="color:var(--muted); font-weight:normal">(da ${src.col}${sampleHtml})</span>`,
        columns: remainingTop,
        canExpand: false,
        types: [],
      });
    } else {
      const values = _distinctValuesInColumn(src.col);
      out.push({
        sourceKey: src.col,
        sourceLabel: `<strong>${src.col}</strong> <span style="color:var(--muted); font-weight:normal">(uno per valore${sampleHtml})</span>`,
        columns: remainingTop,
        canExpand: values.length > 1,
        types: values.map((v) => ({
          key: `${src.col}:${v}`,
          value: v,
          label: v,
        })),
      });
    }
  });

  // ----- 2) Sorgenti aggiuntive (additional event sources) -----
  // Stessa lista di colonne della sorgente principale: gli attributi
  // disponibili per functionName sono visualizzabili anche qui.
  S.extraSources.forEach((src) => {
    const sourcePath = src.activityField
      ? `${src.arrayPath}.${src.activityField}`
      : src.arrayPath;

    if (!src.activityField) {
      out.push({
        sourceKey: sourcePath,
        sourceLabel: `<strong>${src.arrayPath}[]</strong> <span style="color:var(--muted); font-weight:normal">(additional, tipo unico)</span>`,
        columns: remainingTop,
        canExpand: false,
        types: [],
        empty: "Nessun campo disponibile sugli elementi (oltre activity / id).",
      });
      return;
    }

    const values =
      Array.isArray(src.includeTypes) && src.includeTypes.length > 0
        ? src.includeTypes
        : _distinctValuesInArray(src.arrayPath, src.activityField);

    out.push({
      sourceKey: sourcePath,
      sourceLabel:
        `<strong>${src.arrayPath}[]</strong> ` +
        `<span style="color:var(--muted); font-weight:normal">(additional, tipo letto da <code>${src.activityField}</code>)</span>`,
      columns: remainingTop,
      canExpand: values.length > 1,
      types: values.map((v) => ({
        key: `${sourcePath}:${v}`,
        value: v,
        label: v,
      })),
      empty: "Nessun campo disponibile sugli elementi (oltre activity / id).",
    });
  });

  return out;
}

/** Disegna un box per una singola sorgente: header con toggle, e poi
 *  una grid (collassata) o N grid (espansa). */
function _renderEvAttrSource(parent, src) {
  const isExpanded = !!S.evAttrExpanded[src.sourceKey];

  const box = document.createElement("div");
  box.style.cssText =
    "background:var(--bg); border:1px solid var(--border); border-radius:8px; padding:12px; margin-bottom:10px";

  // Header con toggle
  const header = document.createElement("div");
  header.style.cssText =
    "display:flex; align-items:center; justify-content:space-between; margin-bottom:10px";
  const headerLabel = document.createElement("div");
  headerLabel.style.cssText = "font-size:13px";
  headerLabel.innerHTML = `Sorgente: ${src.sourceLabel}`;
  header.appendChild(headerLabel);

  if (src.canExpand) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn btn-secondary";
    toggle.style.cssText = "font-size:11px; padding:4px 10px";
    toggle.textContent = isExpanded
      ? `← Comprimi (attributi condivisi)`
      : `Espandi per tipo (${src.types.length}) →`;
    toggle.addEventListener("click", () => {
      S.evAttrExpanded[src.sourceKey] = !isExpanded;
      renderEventAttrsStep();
    });
    header.appendChild(toggle);
  }

  box.appendChild(header);

  if (!isExpanded || !src.canExpand) {
    // Modalità collassata: una sola grid, key = sourceKey
    // (il mapper farà fallback sul prefisso per ogni tipo prodotto)
    _renderEvAttrSection(box, {
      key: src.sourceKey,
      label: `<em>tutti i tipi</em>`,
      columns: src.columns,
      empty: src.empty,
    });
  } else {
    // Modalità espansa: una grid per ciascun sotto-tipo
    src.types.forEach((t) => {
      _renderEvAttrSection(box, {
        key: t.key,
        label: `<strong>${t.label}</strong>`,
        columns: src.columns,
        empty: src.empty,
      });
    });
  }

  parent.appendChild(box);
}

/** Helper: una sezione "attributi per tipo di evento". */
function _renderEvAttrSection(parent, { key, label, columns, empty }) {
  const prevAttrs = S.evAttrs[key] || [];

  const section = document.createElement("div");
  section.style.marginBottom = "8px";
  section.innerHTML = `
    <label style="font-size:12px">Select Attriutes per event type: ${label}</label>
    <div class="tag-grid" data-evtype="${key}"></div>
  `;
  const tagGrid = section.querySelector(".tag-grid");

  if (!columns.length) {
    tagGrid.innerHTML = `<p style="color:var(--muted); font-size:12px">${
      empty || "Nessuna colonna libera disponibile."
    }</p>`;
  } else {
    columns.forEach((col) => {
      const tag = document.createElement("div");
      tag.className = "tag" + (prevAttrs.includes(col) ? " selected" : "");
      tag.dataset.col = col;
      const sample = sampleValues(S.records, col)[0] || "";
      tag.innerHTML = `${col} <span class="sample">${sample}</span>`;
      tag.addEventListener("click", () => {
        tag.classList.toggle("selected");
        const selected = [
          ...tagGrid.querySelectorAll(".tag.selected[data-col]"),
        ].map((t) => t.dataset.col);
        // Niente entry vuote: se non ci sono tag selezionati lasciamo che il
        // resolver del mapper cada sul prefisso o sul globale.
        if (selected.length === 0) delete S.evAttrs[key];
        else S.evAttrs[key] = selected;
      });
      tagGrid.appendChild(tag);
    });
    _addGroupedToggleButtons(tagGrid);
  }

  parent.appendChild(section);
}

// step 5: per ogni tipo oggetto, griglia di tag per i suoi attributi
// (campi che restano costanti per quella istanza)
function renderObjectAttrsStep() {
  const objRows = document.getElementById("objAttrRows");
  objRows.innerHTML = "";

  // Esclude le colonne già usate come attributi evento (in QUALSIASI eventType)
  // per evitare che un campo sia sia event-attr sia object-attr.
  const usedAsEvAttr = new Set(
    Object.values(S.evAttrs || {}).flat(),
  );
  const remaining = _remainingColumns().filter((c) => !usedAsEvAttr.has(c));

  S.objectCols.forEach((obj) => {
    const prevAttrs = S.objAttrs[obj.typeName] || [];
    // Mostra anche la colonna ID di origine e un valore di esempio: più
    // tipi oggetto possono condividere lo stesso typeName derivato
    // (es. inputs.0.inputName e inputs.1.inputName -> "inputname") e senza
    // questa informazione le sezioni sarebbero indistinguibili.
    const idSample = sampleValues(S.records, obj.col)[0] || "";
    const section = document.createElement("div");
    section.style.marginBottom = "12px";
    section.innerHTML = `
      <label>Select Attributes per Object Type: <strong>${obj.typeName}</strong>
        <span style="color:var(--muted); font-weight:normal">— ID da <code>${obj.col}</code>${
          idSample ? ` <span class="sample">(es. ${idSample})</span>` : ""
        }</span>
      </label>
      <div class="tag-grid" data-type="${obj.typeName}"></div>
    `;

    const tagGrid = section.querySelector(".tag-grid");
    remaining.forEach((col) => {
      const tag = document.createElement("div");
      tag.className = "tag" + (prevAttrs.includes(col) ? " selected" : "");
      tag.dataset.col = col;
      const sample = sampleValues(S.records, col)[0] || "";
      tag.innerHTML = `${col} <span class="sample">${sample}</span>`;
      tag.addEventListener("click", () => {
        tag.classList.toggle("selected");
        S.objAttrs[obj.typeName] = [
          ...tagGrid.querySelectorAll(".tag.selected[data-col]"),
        ].map((t) => t.dataset.col);
      });
      tagGrid.appendChild(tag);
    });
    _addGroupedToggleButtons(tagGrid);

    objRows.appendChild(section);
    S.objAttrs[obj.typeName] = prevAttrs;
  });

  if (!S.objectCols.length) {
    objRows.innerHTML =
      '<p style="color:var(--muted); font-size:13px">Nessun tipo oggetto selezionato allo step precedente.</p>';
  }
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

/** Raccoglie tutti i tipi evento utilizzabili come filtro nelle regole E2O.
 *  Il formato segue quello prodotto dal mapper: "colonna:valore" oppure
 *  "arrayPath.field:valore", così l'utente vede chiaramente da dove
 *  arriva l'evento e si evitano collisioni di nome. */
function _collectEventTypes() {
  const out = new Set();
  // Tipi dalle activity columns dello step 2
  (S.activityCols || []).forEach((ac) => {
    if (ac.typeName) {
      out.add(ac.typeName); // l'utente ha scelto un nome esplicito
    } else {
      // typeName vuoto -> "colonna:valore" per ogni valore distinto
      for (const r of S.records) {
        const v = r[ac.col];
        if (v !== null && v !== undefined && v !== "")
          out.add(`${ac.col}:${String(v)}`);
        if (out.size > 50) break;
      }
    }
  });
  // Tipi dalle sorgenti aggiuntive (eventi annidati)
  (S.extraSources || []).forEach((src) => {
    const prefix = src.activityField
      ? `${src.arrayPath}.${src.activityField}`
      : src.arrayPath;
    if (src.activityField) {
      for (const r of S.raw) {
        const arr = r[src.arrayPath];
        if (!Array.isArray(arr)) continue;
        for (const item of arr) {
          const v = item?.[src.activityField];
          if (v !== null && v !== undefined && v !== "")
            out.add(`${prefix}:${String(v)}`);
          if (out.size > 200) break;
        }
        if (out.size > 200) break;
      }
    } else if (src.qualifier) {
      out.add(`${prefix}:${src.qualifier}`);
    }
  });
  return [...out].sort();
}

/** aggiunge una riga E2O (event type + object type + qualifier + tasto rimuovi).
 *  La colonna sorgente viene dedotta dall'idColumn del tipo oggetto al momento
 *  del mapping. L'event type "*" applica la regola a tutti gli eventi. */
window.addE2ORow = function (preset = {}) {
  const list = document.getElementById("e2oList");
  const row = document.createElement("div");
  row.className = "rule-row e2o";

  const evTypes = _collectEventTypes();
  const evOptions =
    `<option value="*" ${!preset.eventType || preset.eventType === "*" ? "selected" : ""}>* (tutti)</option>` +
    evTypes
      .map(
        (t) =>
          `<option value="${t}" ${t === preset.eventType ? "selected" : ""}>${t}</option>`,
      )
      .join("");

  const objOptions = S.objectCols
    .map(
      (o) =>
        `<option value="${o.typeName}" ${o.typeName === preset.objectType ? "selected" : ""}>${o.typeName}</option>`,
    )
    .join("");

  row.innerHTML = `
    <div><label>Event type</label><select data-key="eventType">${evOptions}</select></div>
    <div><label>Object type</label><select data-key="objectType">${objOptions}</select></div>
    <div><label>Qualifier <span style="color:var(--error)">*</span></label>
      <input type="text" value="${preset.qualifier || ""}" placeholder="es. initiator" />
    </div>
    <button class="btn-rm" onclick="this.closest('.rule-row').remove(); _syncE2O()">✕</button>
  `;

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
      const ev = row.querySelector('[data-key="eventType"]').value;
      const ot = row.querySelector('[data-key="objectType"]').value;
      const qual = row.querySelector("input").value.trim();
      // eventType "*" o vuoto -> null = applica a tutti i tipi evento
      return {
        eventType: ev && ev !== "*" ? ev : null,
        objectType: ot,
        qualifier: qual,
      };
    })
    .filter((r) => r.qualifier && r.objectType);

  _updateE2ONavState();
}

// Esposta su window per essere chiamata dagli onclick delle righe
window._syncE2O = _syncE2O;

/** Disabilita "Next: O2O" finché ogni riga E2O non ha un qualifier compilato.
 *  Evidenzia in rosso gli input vuoti per dare feedback immediato. */
function _updateE2ONavState() {
  const rows = [...document.querySelectorAll("#e2oList .rule-row")];
  let valid = true;
  rows.forEach((row) => {
    const input = row.querySelector("input");
    const empty = !input.value.trim();
    input.classList.toggle("input-error", empty);
    if (empty) valid = false;
  });
  document.getElementById("btnE2ONext").disabled = !valid;
}

//#endregion

//#region STEP 6: Regole O2O

// step 6: lista regole O2O
function renderO2OStep() {
  const list = document.getElementById("o2oList");
  list.innerHTML = "";
  S.o2oRules.forEach((r) => addO2ORow(r));
}

/** aggiunge una riga O2O (src type + dst type + qualifier).
 *  Le colonne sorgente/target vengono dedotte dagli idColumn dei tipi al
 *  momento del mapping, quindi non sono più chieste nella UI. */
window.addO2ORow = function (preset = {}) {
  const list = document.getElementById("o2oList");
  const row = document.createElement("div");
  row.className = "rule-row o2o";

  const typeOptions = S.objectCols
    .map((o) => `<option value="${o.typeName}">${o.typeName}</option>`)
    .join("");

  row.innerHTML = `
    <div><label>Obj Type src</label><select>${typeOptions}</select></div>
    <div><label>Obj Type dst</label><select>${typeOptions}</select></div>
    <div><label>Qualifier <span style="color:var(--error)">*</span></label>
      <input type="text" value="${preset.qualifier || ""}" placeholder="es. interacts_with"/>
    </div>
    <button class="btn-rm" onclick="this.closest('.rule-row').remove(); _syncO2O()">✕</button>
  `;

  // Pre-seleziona i valori del preset; se assenti, scegli sorgente e target
  // DIVERSI di default (primo e secondo tipo). Così l'utente che digita solo
  // il qualifier non finisce con src === dst (il mapper salterebbe la regola).
  const selects = row.querySelectorAll("select");
  if (preset.sourceType) {
    selects[0].value = preset.sourceType;
  } else if (S.objectCols[0]) {
    selects[0].value = S.objectCols[0].typeName;
  }
  if (preset.targetType) {
    selects[1].value = preset.targetType;
  } else if (S.objectCols[1]) {
    selects[1].value = S.objectCols[1].typeName;
  } else if (S.objectCols[0]) {
    selects[1].value = S.objectCols[0].typeName;
  }

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
      const [srcType, tgtType] = [...row.querySelectorAll("select")].map(
        (s) => s.value,
      );
      const qual = row.querySelector("input").value.trim();
      return {
        sourceType: srcType,
        targetType: tgtType,
        qualifier: qual,
      };
    })
    .filter((r) => r.qualifier && r.sourceType && r.targetType);

  _updateO2ONavState();
}

window._syncO2O = _syncO2O;

/** Disabilita "Esegui mapping" finché ogni riga O2O non ha un qualifier
 *  compilato. Evidenzia in rosso gli input vuoti per feedback immediato. */
function _updateO2ONavState() {
  const rows = [...document.querySelectorAll("#o2oList .rule-row")];
  let valid = true;
  rows.forEach((row) => {
    const input = row.querySelector("input");
    const empty = !input.value.trim();
    input.classList.toggle("input-error", empty);
    if (empty) valid = false;
  });
  document.getElementById("btnRunMapping").disabled = !valid;
}

//#endregion

//#region ESECUZIONE DEL MAPPING

// step finale: costruisce il config, esegue il mapping, va allo step 8
window.runMapping = async function () {
  // Sincronizza le regole E2O e O2O prima di leggere S
  _syncE2O();
  _syncO2O();

  // Event ID: se UUID è attivo, ignoriamo il valore del select e usiamo la sentinella
  if (S.eventIdCol !== UUID_SENTINEL) {
    S.eventIdCol = document.getElementById("sel-eventId").value;
  }
  S.timestampCol = document.getElementById("sel-timestamp").value;
  // activityCols viene aggiornato in tempo reale dai listener sui tag/input

  // Legge gli attributi oggetto dai tag selezionati dello step 5
  document.querySelectorAll("#objAttrRows [data-type]").forEach((grid) => {
    S.objAttrs[grid.dataset.type] = [
      ...grid.querySelectorAll(".tag.selected"),
    ].map((t) => t.dataset.col);
  });
  // Step 4 - attributi evento PER TIPO di evento. La modalità collassata/espansa
  // determina le chiavi visibili nell'UI. Salvo solo entry NON vuote: così il
  // resolver del mapper cade sul prefisso (collapse) o sul globale quando un
  // tipo non ha attributi configurati.
  document.querySelectorAll("#evAttrGrid [data-evtype]").forEach((grid) => {
    const key = grid.dataset.evtype;
    const selected = [...grid.querySelectorAll(".tag.selected")].map(
      (t) => t.dataset.col,
    );
    if (selected.length === 0) delete S.evAttrs[key];
    else S.evAttrs[key] = selected;
  });

  // Costruisce objectTypes combinando col, typeName e attributi
  const objectTypes = S.objectCols.map((o) => ({
    name: o.typeName,
    idColumn: o.col,
    attributes: S.objAttrs[o.typeName] || [],
  }));

  // Assembla il MappingConfig.
  // Per compat con il mapper attuale, se c'è una sola activity column la passa
  // come activityColumn; altrimenti popola activitySources (multi-tipo)
  const cfgActivityColumn = S.activityCols[0]?.col || "";
  const activitySources = S.activityCols.map((a) => ({
    column: a.col,
    typeName: a.typeName || null, // null = usa il valore della cella
  }));

  // Per retro-compatibilità (config esportato + chi rilegge il file): manteniamo
  // anche un eventAttributes globale = unione di tutti gli attributi scelti.
  // Il mapper preferisce la mappa per-tipo quando presente.
  const evAttrsGlobal = [
    ...new Set(Object.values(S.evAttrs || {}).flat()),
  ];

  S.config = buildConfig({
    eventIdColumn: S.eventIdCol,
    activityColumn: cfgActivityColumn,
    timestampColumn: S.timestampCol,
    columnsToNormalize: S.selectedNested,
    objectTypes,
    eventAttributes: evAttrsGlobal,
    eventTypeAttributes: S.evAttrs,
    e2oRules: S.e2oRules,
    o2oRules: S.o2oRules,
    additionalEventSources: S.extraSources,
    activitySources,
  });

  const btn = document.getElementById("btnRunMapping");
  btn?.setAttribute("disabled", "true");
  _showLoader("mapping", "Avvio mapping…", 0);
  try {
    // Passa anche S.raw: serve al mapper per accedere agli array originali
    // (necessario per generare gli eventi dalle additionalEventSources).
    // Usiamo mapAsync così la UI può aggiornare la barra di progresso e
    // restare reattiva anche su dataset grandi (decine di migliaia di record).
    S.ocel = await new OcelMapper(S.config).mapAsync(S.records, S.raw, {
      progressEvery: 250,
      onProgress: (p) => {
        const label =
          p.phase === "done"
            ? "Mapping completato"
            : `Eventi processati: ${p.processed.toLocaleString()} / ${p.total.toLocaleString()}`;
        _showLoader("mapping", label, p.ratio);
      },
    });
    _hideLoader("mapping");
    goTo(8);
    _renderResult();
  } catch (err) {
    _hideLoader("mapping");
    alert(`Errore durante il mapping: ${err.message}`);
  } finally {
    btn?.removeAttribute("disabled");
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

  // Anteprima JSON: usa il serializzatore così l'anteprima coincide
  // esattamente con il file .jsonocel che verrà scaricato (formato standard)
  document.getElementById("jsonPreview").textContent = serializeOcel(S.ocel);
}

//#endregion

//#region DOWNLOAD

// download del file OCEL o del config JSON
window.dl = function (type) {
  if (type === "ocel") downloadOcel(S.ocel, `${S.filename}.jsonocel`);
  if (type === "config") downloadConfig(S.config, `${S.filename}-config.json`);
};

//#endregion
