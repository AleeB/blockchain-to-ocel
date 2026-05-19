/**
 * exporter.browser.js - Fa scaricare file al browser
 *
 * Usa le API del browser (Blob, URL.createObjectURL)
 * Non valida, non serializza: si aspetta che i dati siano già pronti
 */

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
  const json = pretty ? JSON.stringify(ocel, null, 2) : JSON.stringify(ocel);
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

  // Libera la memoria del link temporaneo
  URL.revokeObjectURL(url);
}
