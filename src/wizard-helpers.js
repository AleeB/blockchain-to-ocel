/**
 * wizard-helpers.js - Funzioni condivise tra wizard CLI e wizard browser.
 * Centralizzate qui per non duplicarle.
 */

// sentinella per "nessun timestamp scelto" — il mapper la interpreta come null
export const NONE_SENTINEL = "__none__";

// sentinella per "genera UUID v4 random" come Event ID
// il mapper la interpreta come "non leggere da colonna, genera ID al volo"
export const UUID_SENTINEL = "__uuid__";

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
  eventTypeAttributes,
  e2oRules,
  o2oRules,
  additionalEventSources,
  activitySources,
}) {
  return {
    activityColumn,
    timestampColumn: timestampColumn === NONE_SENTINEL ? null : timestampColumn,
    eventIdColumn,
    columnsToNormalize: columnsToNormalize ?? [],
    objectTypes,
    eventAttributes,
    eventTypeAttributes: eventTypeAttributes ?? {},
    e2oRules,
    o2oRules,
    additionalEventSources: additionalEventSources ?? [],
    // Multi-source di activity: ogni elemento produce un evento OCEL per record.
    // Se vuoto o di lunghezza 1, il mapper usa il vecchio activityColumn.
    activitySources: activitySources ?? [],
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
