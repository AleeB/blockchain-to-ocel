/**
 * serializer.js - Converte un documento OCEL 2.0 in testo JSON
 *
 * Fa una cosa sola: trasformare l'oggetto OCEL in una stringa da salvare
 * su file o trasmettere via rete. Tenerlo separato permette di aggiungere
 * altri formati in futuro (es. XML) senza toccare il resto del codice. (Estendibilità)
 */

/**
 * Converte un documento OCEL 2.0 in stringa JSON.
 *
 * @param {import('./types.js').OcelLog} ocel
 * @param {{ pretty?: boolean }} [options]
 * @param {boolean} [options.pretty=true] prettify del JSON
 * @returns {string} Il documento OCEL come testo JSON
 */
export function serializeOcel(ocel, options = {}) {
  const { pretty = true } = options;
  return pretty ? JSON.stringify(ocel, null, 2) : JSON.stringify(ocel);
}
