/**
 * exporter.browser.js - Fa scaricare file al browser
 *
 * Usa le API del browser (Blob, URL.createObjectURL).
 * La serializzazione dell'OCEL è delegata al modulo serializer.js, condiviso
 * con l'esportatore Node.js: così un eventuale nuovo formato di output
 * (XML, SQLite, …) si aggiunge in un solo punto e diventa disponibile in
 * entrambi gli ambienti senza duplicazione di codice.
 */

import { serializeOcel } from "./serializer.js";

/**
 * Fa scaricare il log OCEL come file .jsonocel
 *
 * @param {import('./types.js').OcelLog} ocel
 * @param {string} [filename='output.jsonocel']
 * @param {{ pretty?: boolean }} [options]
 * @param {boolean} [options.pretty=true] - Se true, aggiunge rientri per renderlo leggibile
 */
export function downloadOcel(ocel, filename = "output.jsonocel", options = {}) {
  const { pretty = true } = options;
  const json = serializeOcel(ocel, { pretty });
  _triggerDownload(json, filename, "application/json");
}

/**
 * Fa scaricare il MappingConfig come file JSON
 * Il file salvato puo' essere ricaricato nel wizard o usato con il CLI:
 *   node entrypoints/cli.js convert --config=config.json ...
 *
 * @param {import('./types.js').MappingConfig} config
 * @param {string} [filename='config.json']
 */
export function downloadConfig(config, filename = "config.json") {
  _triggerDownload(
    JSON.stringify(config, null, 2),
    filename,
    "application/json",
  );
}

/**
 * Crea un link invisibile, simula il click per avviare il download,
 * poi libera la memoria. E' il modo standard per far scaricare file
 * dal browser senza coinvolgere un server.
 *
 * @private
 */
function _triggerDownload(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  // Libera la memoria del link temporaneo. Defer al prossimo task della event
  // loop: alcuni browser non hanno ancora avviato il download nel momento in cui
  // anchor.click() ritorna, e revocare la URL troppo presto può abortirlo.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
