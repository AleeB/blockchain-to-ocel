/**
 * loader.js - Legge file JSON in Node.js
 *
 * Usa le funzioni di Node.js per accedere ai file
 * Per il browser usare loader.browser.js
 */

import { readFile } from "fs/promises";
import { parseJsonOrJsonl } from "./parser.js";

export { parseJsonOrJsonl };

/**
 * Legge un file e restituisce i dati come array di oggetti
 *
 * @param {string} filePath - Percorso del file
 * @returns {Promise<object[]>} Dati del file come array
 * @throws {Error} Se il file non esiste o il contenuto non e' JSON valido
 */
export async function loadFromFile(filePath) {
  let raw;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new Error(
      `Impossibile leggere il file "${filePath}": ${err.message}`,
    );
  }
  try {
    return parseJsonOrJsonl(raw);
  } catch (err) {
    throw new Error(`Impossibile parsare "${filePath}": ${err.message}`);
  }
}
