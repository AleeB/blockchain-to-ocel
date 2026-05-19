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
 * @returns {Promise<object[]>} Dati del file come array
 * @throws {Error} Se il file non puo' essere letto o non contiene JSON/JSONL valido
 */
export function loadFromBrowserFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    // Lettura completata: prova a interpretare il testo come JSON
    reader.onload = (e) => {
      try {
        resolve(parseJsonOrJsonl(e.target.result));
      } catch (err) {
        reject(new Error(`Impossibile parsare "${file.name}": ${err.message}`));
      }
    };

    // Errore di lettura
    reader.onerror = () => {
      reject(new Error(`Impossibile leggere il file: ${file.name}`));
    };

    reader.readAsText(file);
  });
}
