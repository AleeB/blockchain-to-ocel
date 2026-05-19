/**
 * wizard-helpers.js - Funzioni condivise tra wizard CLI e wizard browser.
 * Centralizzate qui per non duplicarle.
 */

// sentinella per "nessun timestamp scelto" — il mapper la interpreta come null
export const NONE_SENTINEL = "__none__";

/**
 * Restituisce fino a n valori di esempio non vuoti per una colonna,
 * troncati a 60 caratteri. Utile per mostrare all'utente cosa c'è dentro.
 */
export function sampleValues(records, column, n = 3) {
  return records
    .map((r) => r[column])
    .filter((v) => v !== null && v !== undefined && v !== "")
    .slice(0, n)
    .map((v) => String(v).slice(0, 60));
}

/**
 * Converte i nomi delle colonne in oggetti choice per inquirer (e il browser).
 * Ogni voce include esempi reali: "sender  (e.g. 0xAaBb... | 0x1122...)"
 */
export function columnChoices(columns, records) {
  return columns.map((col) => ({
    name: `${col}  \x1b[2m(e.g. ${sampleValues(records, col).join(" | ")})\x1b[0m`,
    value: col,
    short: col,
  }));
}

/**
 * Assembla il MappingConfig dalle scelte del wizard.
 * Se timestampColumn === NONE_SENTINEL lo converte in null.
 *
 * @returns {import('./types.js').MappingConfig}
 */
export function buildConfig({
  eventIdColumn,
  activityColumn,
  timestampColumn,
  columnsToNormalize,
  objectTypes,
  eventAttributes,
  e2oRules,
  o2oRules,
}) {
  return {
    activityColumn,
    timestampColumn: timestampColumn === NONE_SENTINEL ? null : timestampColumn,
    eventIdColumn,
    columnsToNormalize: columnsToNormalize ?? [],
    objectTypes,
    eventAttributes,
    e2oRules,
    o2oRules,
  };
}

/**
 * Ritorna le colonne non ancora assegnate a nessun ruolo OCEL.
 * Serve per sapere cosa si può ancora usare come attributo evento.
 */
export function freeColumns(
  allColumns,
  {
    eventIdColumn,
    activityColumn,
    timestampColumn,
    objectColumns,
    objectAttributeColumns,
  },
) {
  const used = new Set([
    eventIdColumn,
    activityColumn,
    timestampColumn,
    ...objectColumns,
    ...objectAttributeColumns,
  ]);

  return allColumns.filter((c) => !used.has(c));
}
