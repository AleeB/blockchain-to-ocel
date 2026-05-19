/**
 * mapper.js - Trasforma i record normalizzati in un documento OCEL 2.0
 *
 * Funziona sia in Node.js che nel browser.
 * Non legge file, non appiattisce, non valida: fa solo il mapping.
 */

export class OcelMapper {
  /**
   * @param {import('./types.js').MappingConfig} config
   */
  constructor(config) {
    this.config = config;
    // Controlla il config subito: meglio fallire ora con un messaggio chiaro
    // che in modo oscuro durante l'elaborazione di migliaia di record
    this._validateConfig();
  }

  /** Controlla che il config abbia almeno i campi obbligatori */
  _validateConfig() {
    const { activityColumn, eventIdColumn, objectTypes } = this.config;

    if (!activityColumn)
      throw new Error("MappingConfig: activityColumn is required");
    if (!eventIdColumn)
      throw new Error("MappingConfig: eventIdColumn is required");

    // timestampColumn e' opzionale: se assente, gli eventi avranno time: null

    if (!objectTypes || objectTypes.length === 0) {
      throw new Error("MappingConfig: at least one objectType is required");
    }

    for (const ot of objectTypes) {
      if (!ot.name || !ot.idColumn) {
        throw new Error(
          `objectType must have name and idColumn: ${JSON.stringify(ot)}`,
        );
      }
    }
  }

  /**
   * Trasforma i record normalizzati in un documento OCEL 2.0.
   * @param {object[]} records
   * @returns {import('./types.js').OcelLog}
   */
  map(records) {
    const ocel = this._createEmptyOcel();

    // objectsMap raccoglie gli oggetti ed evita i duplicati
    // La chiave e' "tipooggetto:idoggetto" (es. "wallet:0xAaBb...")
    const objectsMap = new Map();

    // Fase 1: un record alla volta
    for (const record of records) {
      const eventId = String(record[this.config.eventIdColumn]);
      const activity = record[this.config.activityColumn];
      const time = this._parseTimestamp(record[this.config.timestampColumn]);

      // Salta record senza ID o senza activity: non possono diventare eventi OCEL
      if (!eventId || !activity) continue;

      // 1a. Registra il tipo di evento (una sola volta per tipo)
      if (!ocel.eventTypes.find((et) => et.name === activity)) {
        ocel.eventTypes.push({
          name: activity,
          attributes: this._buildEventTypeAttributeSchema(),
        });
      }

      // 1b. Crea l'evento
      const event = {
        id: eventId,
        type: activity,
        time,
        attributes: this._extractEventAttributes(record),
        relationships: [],
      };

      // 1c. Estrai gli oggetti e aggiungi le relazioni evento-oggetto di default
      for (const otDef of this.config.objectTypes) {
        const objectId = record[otDef.idColumn];

        if (objectId === null || objectId === undefined || objectId === "")
          continue;

        const mapKey = `${otDef.name}:${objectId}`;

        if (!objectsMap.has(mapKey)) {
          // Prima volta che compare questo oggetto: lo crea e lo registra
          objectsMap.set(mapKey, {
            id: String(objectId),
            type: otDef.name,
            attributes: this._extractObjectAttributes(record, otDef),
          });

          if (!ocel.objectTypes.find((ot) => ot.name === otDef.name)) {
            ocel.objectTypes.push({
              name: otDef.name,
              attributes: this._buildObjectTypeAttributeSchema(otDef),
            });
          }
        }

        // Relazione evento-oggetto di default: qualifier = nome del tipo
        event.relationships.push({
          objectId: String(objectId),
          qualifier: otDef.name,
        });
      }

      // 1d. Applica le regole E2O (qualifier personalizzati)
      // Aggiungono relazioni in piu', non sostituiscono quelle di default
      if (this.config.e2oRules) {
        for (const rule of this.config.e2oRules) {
          const objectId = record[rule.column];
          if (objectId === null || objectId === undefined || objectId === "")
            continue;

          const mapKey = `${rule.objectType}:${objectId}`;
          if (!objectsMap.has(mapKey)) {
            objectsMap.set(mapKey, {
              id: String(objectId),
              type: rule.objectType,
              attributes: {},
            });
          }

          event.relationships.push({
            objectId: String(objectId),
            qualifier: rule.qualifier,
          });
        }
      }

      ocel.events.push(event);
    }

    // Fase 2: relazioni O2O
    // Va fatto prima di scrivere ocel.objects perche' potrebbe aggiungere
    // nuovi oggetti a objectsMap
    if (this.config.o2oRules) {
      ocel.o2o = this._buildO2O(records, objectsMap);
    }

    // Fase 3: scrivi tutti gli oggetti nell'OCEL
    // Solo ora objectsMap e' definitivamente completa
    ocel.objects = Array.from(objectsMap.values());

    return ocel;
  }

  /** @private */
  _createEmptyOcel() {
    return {
      objectTypes: [],
      eventTypes: [],
      objects: [],
      events: [],
      o2o: [],
    };
  }

  /**
   * Converte il timestamp grezzo in stringa ISO.
   * I dati blockchain di solito arrivano come Unix seconds (numero),
   * ma a volte sono già stringhe — gestisce entrambi i casi.
   * @private
   */
  _parseTimestamp(value) {
    if (!value) return null;

    if (typeof value === "number") {
      return new Date(value * 1000).toISOString();
    }

    const d = new Date(value);
    return isNaN(d.getTime())
      ? String(value) // formato non riconosciuto: mantiene la stringa originale
      : d.toISOString();
  }

  /** @private */
  _buildEventTypeAttributeSchema() {
    if (!this.config.eventAttributes) return [];
    return this.config.eventAttributes.map((attr) => ({
      name: attr,
      type: "string",
    }));
  }

  /** @private */
  _buildObjectTypeAttributeSchema(otDef) {
    if (!otDef.attributes) return [];
    return otDef.attributes.map((attr) => ({ name: attr, type: "string" }));
  }

  /** @private */
  _extractEventAttributes(record) {
    const attrs = {};
    if (this.config.eventAttributes) {
      for (const attr of this.config.eventAttributes) {
        if (record[attr] !== undefined) {
          attrs[attr] = record[attr];
        }
      }
    }
    return attrs;
  }

  /** @private */
  _extractObjectAttributes(record, otDef) {
    const attrs = {};
    if (otDef.attributes) {
      for (const attr of otDef.attributes) {
        if (record[attr] !== undefined) {
          attrs[attr] = record[attr];
        }
      }
    }
    return attrs;
  }

  /**
   * Costruisce le relazioni O2O evitando duplicati.
   * Attenzione: può aggiungere oggetti a objectsMap se una coppia
   * non è mai apparsa insieme in un evento — per questo va chiamata
   * prima di Array.from(objectsMap.values()).
   * @private
   */
  _buildO2O(records, objectsMap) {
    const seen = new Set();
    const result = [];

    for (const record of records) {
      for (const rule of this.config.o2oRules) {
        const sourceId = record[rule.sourceColumn];
        const targetId = record[rule.targetColumn];

        // Salta record con valori mancanti o con auto-relazione (stesso ID)
        if (!sourceId || !targetId || sourceId === targetId) continue;

        const dedupeKey = `${rule.sourceType}:${sourceId}->${rule.targetType}:${targetId}:${rule.qualifier}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        // Assicura che entrambi gli oggetti esistano in objectsMap
        const srcKey = `${rule.sourceType}:${sourceId}`;
        const tgtKey = `${rule.targetType}:${targetId}`;
        if (!objectsMap.has(srcKey)) {
          objectsMap.set(srcKey, {
            id: String(sourceId),
            type: rule.sourceType,
            attributes: {},
          });
        }
        if (!objectsMap.has(tgtKey)) {
          objectsMap.set(tgtKey, {
            id: String(targetId),
            type: rule.targetType,
            attributes: {},
          });
        }

        result.push({
          sourceId: String(sourceId),
          sourceType: rule.sourceType,
          targetId: String(targetId),
          targetType: rule.targetType,
          qualifier: rule.qualifier,
        });
      }
    }

    return result;
  }
}
