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
      columnsToNormalize: [...(base.columnsToNormalize || [])],
      objectTypes: [...(base.objectTypes || [])],
      eventAttributes: [...(base.eventAttributes || [])],
      e2oRules: [...(base.e2oRules || [])],
      o2oRules: [...(base.o2oRules || [])],
      activitySources: [...(base.activitySources || [])],
      additionalEventSources: [...(base.additionalEventSources || [])],
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
  setColumnsToNormalize(cols) {
    this._config.columnsToNormalize = [...(cols || [])];
    return this;
  }

  /** @returns {this} */
  addColumnToNormalize(col) {
    if (!this._config.columnsToNormalize.includes(col)) {
      this._config.columnsToNormalize.push(col);
    }
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

  /**
   * Aggiunge una regola E2O. Supporta due forme di chiamata:
   *   addE2O(objectType, qualifier, column)            — forma posizionale legacy
   *   addE2O({ objectType, qualifier, column, eventType }) — forma a oggetto,
   *     l'unica che consente il filtro opzionale per tipo di evento.
   * @returns {this}
   */
  addE2O(objectTypeOrSpec, qualifier, column) {
    const rule = typeof objectTypeOrSpec === "object" && objectTypeOrSpec !== null
      ? { ...objectTypeOrSpec }
      : { objectType: objectTypeOrSpec, qualifier, column };
    this._config.e2oRules.push(rule);
    return this;
  }

  /**
   * Aggiunge una regola O2O. Supporta due forme di chiamata:
   *   addO2O(sourceType, sourceColumn, targetType, targetColumn, qualifier)
   *     — forma posizionale legacy.
   *   addO2O({ sourceType, targetType, qualifier, sourceColumn?, targetColumn? })
   *     — forma a oggetto; sourceColumn/targetColumn sono opzionali e, se omessi,
   *     vengono dedotti dalle idColumn dei rispettivi objectType.
   * @returns {this}
   */
  addO2O(sourceTypeOrSpec, sourceColumn, targetType, targetColumn, qualifier) {
    const rule = typeof sourceTypeOrSpec === "object" && sourceTypeOrSpec !== null
      ? { ...sourceTypeOrSpec }
      : {
          sourceType: sourceTypeOrSpec,
          sourceColumn,
          targetType,
          targetColumn,
          qualifier,
        };
    this._config.o2oRules.push(rule);
    return this;
  }

  /**
   * Aggiunge una sorgente di attività. Quando ne sono presenti più di una, ogni
   * record può produrre più eventi distinti.
   * @returns {this}
   */
  addActivitySource({ column, typeName = null }) {
    if (!column) throw new Error("addActivitySource: column è obbligatorio");
    this._config.activitySources.push({ column, typeName });
    return this;
  }

  /**
   * Aggiunge una sorgente di eventi secondari estratti da un array annidato del
   * record (ad esempio gli eventi emessi da uno smart contract).
   * @returns {this}
   */
  addAdditionalEventSource({ arrayPath, activityField, idField, qualifier, includeTypes }) {
    if (!arrayPath) {
      throw new Error("addAdditionalEventSource: arrayPath è obbligatorio");
    }
    this._config.additionalEventSources.push({
      arrayPath,
      activityField,
      idField,
      qualifier,
      includeTypes: includeTypes || [],
    });
    return this;
  }

  /** @returns {import('./types.js').MappingConfig} */
  build() {
    return JSON.parse(JSON.stringify(this._config));
  }
}
