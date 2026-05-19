/**
 * exporter.js - Scrive file OCEL e config sul disco in Node.js
 *
 * Usa le funzioni di Node.js per scrivere i file.
 * Per il browser usare exporter.browser.js.
 */

import { writeFile } from "fs/promises";
import { serializeOcel } from "./serializer.js";

/**
 * Scrive il log OCEL su file. ".jsonocel"
 *
 * @param {import('./types.js').OcelLog} ocel
 * @param {string} filePath - Percorso di destinazione
 * @param {{ pretty?: boolean }} [options]
 */
export async function writeOcelFile(ocel, filePath, options = {}) {
  const json = serializeOcel(ocel, options);
  try {
    await writeFile(filePath, json, "utf-8");
  } catch (err) {
    throw new Error(`Impossibile scrivere "${filePath}": ${err.message}`);
  }
}

/**
 * Scrive il MappingConfig su file JSON.
 *
 * @param {import('./types.js').MappingConfig} config
 * @param {string} filePath - Percorso di destinazione
 */
export async function writeConfigFile(config, filePath) {
  try {
    await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
  } catch (err) {
    throw new Error(`Impossibile scrivere "${filePath}": ${err.message}`);
  }
}
