/**
 * loader.browser.js - Legge file scelti dall'utente nel browser
 *
 * Usa l'API FileReader del browser
 * Viene usato da browser.js al posto di loader.js
 */

import { parseJsonOrJsonl } from "./parser.js";

export { parseJsonOrJsonl };

/**
 * Legge un file scelto dall'utente (da un input file o drag & drop)
 * e restituisce i dati come array di oggetti.
 *
 * @param {File} file Il file scelto dall'utente
 * @param {object} [opts]
 * @param {(p: {phase: string, loaded: number, total: number, ratio: number}) => void} [opts.onProgress]
 *   Callback opzionale chiamata durante la lettura per aggiornare un loader UI.
 *   phase ∈ "reading" | "parsing" | "done".
 * @returns {Promise<object[]>} Dati del file come array
 * @throws {Error} Se il file non puo' essere letto o non contiene JSON/JSONL valido
 */
export function loadFromBrowserFile(file, opts = {}) {
  const { onProgress } = opts;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const total = file.size || 0;

    // FileReader.onprogress arriva mano a mano che il browser legge
    reader.onprogress = (e) => {
      if (!onProgress) return;
      const loaded = e.loaded || 0;
      const t = e.total || total;
      onProgress({
        phase: "reading",
        loaded,
        total: t,
        ratio: t > 0 ? loaded / t : 0,
      });
    };

    reader.onload = (e) => {
      // Lettura completata: il parsing è sincrono, segnaliamo come "parsing"
      onProgress?.({ phase: "parsing", loaded: total, total, ratio: 1 });
      try {
        const data = parseJsonOrJsonl(e.target.result);
        onProgress?.({ phase: "done", loaded: total, total, ratio: 1 });
        resolve(data);
      } catch (err) {
        reject(new Error(`Impossibile parsare "${file.name}": ${err.message}`));
      }
    };

    reader.onerror = () => {
      reject(new Error(`Impossibile leggere il file: ${file.name}`));
    };

    reader.readAsText(file);
  });
}
