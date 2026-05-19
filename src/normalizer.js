/**
 *
 * normalizer.js - Appiattisce strutture JSON annidate
 *
 */

/**
 * Appiattisce un oggetto annidato usando dot-notation.
 * Es: { a: { b: 1 } } -> { "a.b": 1 }
 * Gli array di valori semplici (numeri, stringhe) rimangono invariati.
 *
 * @param {object} obj
 * @param {string} prefix
 */
export function flattenObject(obj, prefix = "") {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      result[fullKey] = null;
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        result[fullKey] = [];
      } else if (typeof value[0] === "object" && value[0] !== null) {
        // Array di oggetti: ogni elemento diventa una serie di chiavi numerate
        value.forEach((item, i) => {
          const nested = flattenObject(item, `${fullKey}.${i}`);
          Object.assign(result, nested);
        });
      } else {
        // Array di valori semplici (numeri, stringhe): lascia invariato
        result[fullKey] = value;
      }
    } else if (typeof value === "object") {
      // Oggetto annidato: ripeti la funzione con il nuovo prefisso
      Object.assign(result, flattenObject(value, fullKey));
    } else {
      result[fullKey] = value;
    }
  }

  return result;
}

/**
 * Rileva le colonne con strutture annidate (oggetti o array di oggetti).
 * Usato dal wizard per pre-selezionare cosa appiattire.
 */
export function detectNestedColumns(recordOrRecords) {
  const records = Array.isArray(recordOrRecords)
    ? recordOrRecords
    : [recordOrRecords];

  const nested = new Set();

  for (const record of records) {
    if (!record || typeof record !== "object") continue;

    for (const [key, value] of Object.entries(record)) {
      if (nested.has(key)) continue;
      if (value !== null && typeof value === "object") {
        if (Array.isArray(value)) {
          // Considera "annidato" solo un array di oggetti, non di numeri o stringhe
          // es. inputs ([{...}]) e' annidato, tags (["a","b"]) non lo e'
          if (value.length > 0 && typeof value[0] === "object") {
            nested.add(key);
          }
        } else {
          nested.add(key);
        }
      }
    }
  }

  return [...nested];
}

/**
 * Raccoglie tutte le colonne da tutti i record (non solo il primo).
 * Serve perché transazioni diverse nel dataset blockchain possono avere
 * campi diversi — guardare solo il primo record non basta.
 */
export function collectAllColumns(records) {
  const keys = new Set();
  for (const record of records) {
    for (const key of Object.keys(record)) {
      keys.add(key);
    }
  }
  return [...keys];
}

/**
 * Appiattisce un array di record sulle colonne indicate.
 * Se columnsToNormalize non è passato, le rileva automaticamente.
 *
 * @param {object[]} records
 * @param {string[]} [columnsToNormalize]
 */
export function normalizeRecords(records, columnsToNormalize) {
  if (records.length === 0) return [];

  const columns = columnsToNormalize || detectNestedColumns(records);

  return records.map((record) => {
    const flat = {};

    for (const [key, value] of Object.entries(record)) {
      if (
        columns.includes(key) &&
        value !== null &&
        typeof value === "object"
      ) {
        // Colonna da appiattire: aggiunge le chiavi dot-notation al record
        Object.assign(flat, flattenObject(value, key));
      } else {
        // Colonna da copiare invariata
        flat[key] = value;
      }
    }

    return flat;
  });
}
