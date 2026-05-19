/**
 * config.js - Builder per costruire un MappingConfig passo dopo passo.
 * Usato principalmente nei test e negli esempi.
 */
export class ConfigBuilder {
  /** @param {import('./types.js').MappingConfig} [base={}] config di partenza opzionale */
  constructor(base = {}) {
    // Copia difensiva: non modifica mai l'oggetto base originale
    this._config = {
      activityColumn: base.activityColumn,
      timestampColumn: base.timestampColumn,
      eventIdColumn: base.eventIdColumn,
      objectTypes: [...(base.objectTypes || [])],
      eventAttributes: [...(base.eventAttributes || [])],
      e2oRules: [...(base.e2oRules || [])],
      o2oRules: [...(base.o2oRules || [])],
    };
  }

  /** @returns {this} */
  setEventId(col) {
    this._config.eventIdColumn = col;
    return this;
  }

  /** @returns {this} */
  setActivity(col) {
    this._config.activityColumn = col;
    return this;
  }

  /** @returns {this} */
  setTimestamp(col) {
    this._config.timestampColumn = col;
    return this;
  }

  /** @returns {this} */
  addObjectType({ name, idColumn, attributes }) {
    if (!name || !idColumn) {
      throw new Error("addObjectType: name e idColumn sono obbligatori");
    }
    this._config.objectTypes.push({
      name,
      idColumn,
      attributes: attributes || [],
    });
    return this;
  }

  /** @returns {this} */
  addEventAttribute(col) {
    if (!this._config.eventAttributes.includes(col)) {
      this._config.eventAttributes.push(col);
    }
    return this;
  }

  /** @returns {this} */
  addE2O(objectType, qualifier, column) {
    this._config.e2oRules.push({ column, objectType, qualifier });
    return this;
  }

  /** @returns {this} */
  addO2O(sourceType, sourceColumn, targetType, targetColumn, qualifier) {
    this._config.o2oRules.push({
      sourceType,
      sourceColumn,
      targetType,
      targetColumn,
      qualifier,
    });
    return this;
  }

  /** @returns {import('./types.js').MappingConfig} */
  build() {
    return JSON.parse(JSON.stringify(this._config));
  }
}
