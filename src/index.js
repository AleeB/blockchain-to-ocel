/**
 * index.js - Entry point della libreria per Node.js
 *
 * Esporta tutte le funzionalita' del core da un unico punto.
 * Per l'uso nel browser importare browser.js invece di questo file.
 *
 * @example
 *   import { OcelMapper, loadFromFile, validateOcel } from 'blockchain-to-ocel';
 */

// Caricamento file (Node.js)
export { loadFromFile, parseJsonOrJsonl } from "./loader.js";

// Appiattimento strutture JSON annidate
export {
  flattenObject,
  detectNestedColumns,
  normalizeRecords,
  collectAllColumns,
} from "./normalizer.js";

// Motore di trasformazione: record -> OCEL 2.0
export { OcelMapper } from "./mapper.js";

// Controllo e statistiche del log OCEL
export { validateOcel, getOcelStats } from "./validator.js";

// Serializzazione in JSON
export { serializeOcel } from "./serializer.js";

// Scrittura file (Node.js)
export { writeOcelFile, writeConfigFile } from "./exporter.js";

// Funzioni di supporto per costruire il config
export {
  buildConfig,
  freeColumns,
  sampleValues,
  columnChoices,
  NONE_SENTINEL,
} from "./wizard-helpers.js";

// Builder per il config
export { ConfigBuilder } from "./config.js";
