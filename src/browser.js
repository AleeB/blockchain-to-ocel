/**
 * browser.js - Entry point della libreria per il browser.
 *
 * Importa solo moduli senza dipendenze da Node.js.
 * Non importare loader.js, exporter.js o wizard.js da qui:
 * usano funzioni di Node.js non disponibili nel browser.
 *
 * Uso in una pagina HTML:
 *   import { OcelMapper, buildConfig } from '/src/browser.js';
 */

// Caricamento file (FileReader API del browser)
export { loadFromBrowserFile, parseJsonOrJsonl } from "./loader.browser.js";

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

// Download file nel browser
export { downloadOcel, downloadConfig } from "./exporter.browser.js";

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
