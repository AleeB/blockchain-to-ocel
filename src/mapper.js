/**
 * mapper.js - Trasforma i record normalizzati in un documento OCEL 2.0
 *
 * Funziona sia in Node.js che nel browser.
 * Non legge file, non appiattisce, non valida: fa solo il mapping.
 */

import { UUID_SENTINEL } from "./wizard-helpers.js";
import { flattenObject } from "./normalizer.js";

// crypto.randomUUID() è disponibile sia in Node ≥ 14.17 che nei browser moderni
function genUuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // fallback estremo (browser molto vecchi): UUID v4 non crittografico
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

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
    const { activityColumn, eventIdColumn, objectTypes, activitySources } = this.config;

    // È valido se c'è almeno una sorgente di activity: o la vecchia
    // activityColumn singola, o la nuova lista activitySources
    const hasActivity = !!activityColumn || (activitySources && activitySources.length > 0);
    if (!hasActivity)
      throw new Error("MappingConfig: serve almeno una activity column / activitySource");
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
   *
   * @param {object[]} records   - record normalizzati (chiavi piatte)
   * @param {object[]} [rawRecords] - record originali NON normalizzati;
   *   serve solo se sono configurate additionalEventSources, perché
   *   il mapper deve accedere agli array originali per generare eventi
   *   secondari. Se omesso, additionalEventSources viene ignorato.
   * @returns {import('./types.js').OcelLog}
   */
  /**
   * Versione sincrona — usata in tests e in CLI per dataset piccoli.
   * Consuma il generator interno fino in fondo.
   */
  map(records, rawRecords) {
    this._rawRecords = rawRecords ?? null;
    const gen = this._processGenerator(records);
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
  }

  /**
   * Versione asincrona — chiama onProgress ogni `progressEvery` record e
   * cede il controllo al browser così il loader UI può aggiornarsi.
   *
   * @param {object[]} records
   * @param {object[]} [rawRecords]
   * @param {object} [opts]
   * @param {(p: {phase: string, processed: number, total: number, ratio: number}) => void} [opts.onProgress]
   * @param {number} [opts.progressEvery=500]
   * @returns {Promise<import('./types.js').OcelLog>}
   */
  async mapAsync(records, rawRecords, opts = {}) {
    const { onProgress, progressEvery = 500 } = opts;
    this._rawRecords = rawRecords ?? null;
    const total = records.length;
    const gen = this._processGenerator(records);
    let r = gen.next();
    let processed = 0;
    onProgress?.({ phase: "mapping", processed: 0, total, ratio: 0 });
    while (!r.done) {
      processed = r.value; // il generator yield-a l'indice del record appena processato
      if (processed > 0 && processed % progressEvery === 0) {
        onProgress?.({
          phase: "mapping",
          processed,
          total,
          ratio: total > 0 ? processed / total : 0,
        });
        // cede il controllo al browser (1 task del macrotask queue)
        await new Promise((res) => setTimeout(res, 0));
      }
      r = gen.next();
    }
    onProgress?.({ phase: "done", processed: total, total, ratio: 1 });
    return r.value;
  }

  /**
   * Generator interno: produce gli eventi un record alla volta e alla fine
   * restituisce l'OCEL completo. Yield-a l'indice del record processato
   * così il caller (sync o async) sa dove siamo arrivati.
   * @private
   */
  *_processGenerator(records) {
    const ocel = this._createEmptyOcel();

    // objectsMap raccoglie gli oggetti ed evita i duplicati
    // La chiave e' "tipooggetto:idoggetto" (es. "wallet:0xAaBb...")
    const objectsMap = new Map();

    // Determina le activity sources. Due modalità:
    //   - modalità esplicita (activitySources non vuoto): il tipo evento è
    //     src.typeName, oppure "colonna:valore" se typeName è null/assente.
    //     Serve a disambiguare quando un record produce più eventi.
    //   - modalità legacy (solo activityColumn): il tipo evento è il valore
    //     raw della cella, senza prefisso. Mantiene il comportamento storico
    //     dell'unico activityColumn descritto nelle prime versioni del tool.
    const hasExplicitSources = !!(this.config.activitySources && this.config.activitySources.length);
    const sources = hasExplicitSources
      ? this.config.activitySources
      : [{ column: this.config.activityColumn, typeName: null, _legacyMode: true }];

    // Fase 1: un record alla volta
    for (let recIdx = 0; recIdx < records.length; recIdx++) {
      const record = records[recIdx];
      this._currentRecord = record; // accessibile da _applyE2ORules nei sub-eventi
      const rawRecord = this._rawRecords?.[recIdx] ?? record;
      const time = this._parseTimestamp(record[this.config.timestampColumn]);

      for (const src of sources) {
        const eventId = this._resolveEventId(record, src, sources.length);
        const cellValue = record[src.column];
        // Se la cella è vuota per QUESTA sorgente, salta SOLO questo evento.
        // Le altre sorgenti dello stesso record possono comunque produrre eventi.
        if (!eventId || cellValue === null || cellValue === undefined || cellValue === "")
          continue;

        // Modalità legacy → event.type = valore raw (nessun prefisso).
        // Modalità esplicita con typeName → event.type = typeName.
        // Modalità esplicita senza typeName → event.type = "colonna:valore",
        // per rendere visibile la provenienza nel log e nei tool OCPM.
        // Il valore originale finisce in attributes._activity per analisi a valle.
        const rawCell = String(cellValue);
        let activity;
        let extraAttrs;
        if (src._legacyMode) {
          activity = rawCell;
          extraAttrs = { _activity: rawCell };
        } else if (src.typeName) {
          activity = src.typeName;
          extraAttrs = { _activity: rawCell };
        } else {
          activity = `${src.column}:${rawCell}`;
          extraAttrs = { _activity: rawCell, _source: src.column };
        }

      // 1a. Registra il tipo di evento (una sola volta per tipo)
      if (!ocel.eventTypes.find((et) => et.name === activity)) {
        ocel.eventTypes.push({
          name: activity,
          attributes: this._buildEventTypeAttributeSchema(activity),
        });
      }

      // 1b. Crea l'evento
      const event = {
        id: eventId,
        type: activity,
        time,
        attributes: {
          ...this._extractEventAttributes(record, activity),
          ...extraAttrs,
        },
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

      // 1d. Applica le regole E2O per il tipo di evento corrente.
      this._applyE2ORules(record, event, objectsMap);

      ocel.events.push(event);

      // 1e. Eventi aggiuntivi estratti da array annidati nel record raw
      // Es: blockchain tx → events[] (eventi emessi) + internalTxs[] (chiamate interne)
      // Ogni elemento diventa un evento OCEL distinto, con gli stessi oggetti del padre
      this._emitAdditionalEvents(rawRecord, event, ocel, objectsMap);
      } // chiude for (const src of sources)

      // Yield al caller per consentirgli di aggiornare il loader UI.
      // In modalità sync il valore viene semplicemente ignorato.
      yield recIdx + 1;
    } // chiude for (record of records)

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

  /**
   * Restituisce l'ID dell'evento principale per un record.
   * Se eventIdColumn === UUID_SENTINEL, genera un UUID v4 al volo.
   * Altrimenti pesca dalla colonna indicata. Quando lo stesso record produce
   * più eventi (più activitySources) e l'ID è letto da colonna, concatena al
   * valore il nome della colonna sorgente per evitare la collisione di ID che
   * altrimenti farebbe fallire la validazione del log.
   * @private
   */
  _resolveEventId(record, src, sourcesCount = 1) {
    if (this.config.eventIdColumn === UUID_SENTINEL) return genUuid();
    const v = record[this.config.eventIdColumn];
    if (v === undefined || v === null) return "";
    const base = String(v);
    return sourcesCount > 1 && src?.column ? `${base}:${src.column}` : base;
  }

  /**
   * Genera eventi secondari da array annidati nel record raw.
   * Ogni elemento dell'array diventa un evento OCEL distinto
   * che eredita gli oggetti e il timestamp del record padre.
   * Le relazioni del padre vengono replicate con un qualifier specifico
   * della sorgente per distinguerle nei tool OCPM.
   * @private
   */
  _emitAdditionalEvents(rawRecord, parentEvent, ocel, objectsMap) {
    const sources = this.config.additionalEventSources;
    if (!sources || !sources.length) return;
    if (!this._rawRecords) return; // serve l'accesso al raw

    for (const src of sources) {
      const arr = rawRecord[src.arrayPath];
      if (!Array.isArray(arr)) continue;

      for (const item of arr) {
        if (!item || typeof item !== "object") continue;

        const rawActivity = src.activityField ? item[src.activityField] : src.qualifier;
        if (rawActivity === null || rawActivity === undefined || rawActivity === "")
          continue;

        // Filtro per tipo: se includeTypes è specificato e non vuoto,
        // emettiamo l'evento solo se il suo tipo è nella whitelist.
        // includeTypes vuoto / assente = nessun filtro (include tutti).
        if (
          Array.isArray(src.includeTypes) &&
          src.includeTypes.length > 0 &&
          !src.includeTypes.includes(String(rawActivity))
        ) {
          continue;
        }

        const id = src.idField && item[src.idField]
          ? String(item[src.idField])
          : genUuid();

        // Path semantico dell'origine del sub-evento (es. "events.eventName",
        // "internalTxs.activity"). Lo prefissiamo al valore così l'event.type
        // dice CHIARAMENTE da dove arriva l'evento, e si evita la collisione
        // di nomi (es. lock principale vs lock interno).
        const sourcePath = src.activityField
          ? `${src.arrayPath}.${src.activityField}`
          : src.arrayPath;
        const activity = `${sourcePath}:${String(rawActivity)}`;

        // Registra il tipo di evento secondario, con eventuali attributi
        // configurati dall'utente per quel tipo (o per la sorgente).
        if (!ocel.eventTypes.find((et) => et.name === activity)) {
          ocel.eventTypes.push({
            name: activity,
            attributes: this._buildEventTypeAttributeSchema(activity),
          });
        }

        // Il sub-evento parte con le relazioni di default dal padre
        // (oggetti del record sorgente), poi vengono filtrate le E2O specifiche
        // per il suo tipo. Così "Approval" può avere regole diverse da "lock".
        // _subEvent: true è il marker univoco che identifica gli eventi prodotti
        // da additionalEventSources (a differenza di _source, che il mapper
        // imposta anche su eventi principali in modalità activitySources).
        // Gli attributi utente vengono letti dall'ELEMENTO dell'array (item),
        // non dal record padre: i campi rilevanti sono quelli dell'elemento.
        // L'elemento raw è appiattito prima dell'estrazione: così campi
        // annidati come "inputs.0.name" sono leggibili con lo stesso schema
        // dot-notation usato per il record principale.
        const subEvent = {
          id,
          type: activity,
          time: parentEvent.time,
          attributes: {
            ...this._extractEventAttributes(flattenObject(item), activity),
            _subEvent: true,
            _source: src.qualifier,
            _activity: String(rawActivity),
          },
          relationships: this._defaultRelationships(parentEvent),
        };
        // Applica le regole E2O filtrate per il tipo del sub-evento.
        // Il record di riferimento è quello padre (i sub-eventi condividono il contesto).
        this._applyE2ORules(this._currentRecord, subEvent, objectsMap);

        ocel.events.push(subEvent);
      }
    }
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

  /**
   * Risolve la lista di attributi da estrarre per uno specifico tipo di evento.
   * Priorità: eventTypeAttributes[activity] -> eventTypeAttributes[colonnaSorgente]
   * (per attività value-based come "activity:order-placed") -> eventAttributes
   * (legacy globale).
   * @private
   */
  _resolveEventAttributesFor(activity) {
    const perType = this.config.eventTypeAttributes;
    if (perType && perType[activity]) return perType[activity];
    if (perType && typeof activity === "string" && activity.includes(":")) {
      const col = activity.split(":")[0];
      if (perType[col]) return perType[col];
    }
    return this.config.eventAttributes || [];
  }

  /** @private */
  _buildEventTypeAttributeSchema(activity) {
    const attrs = this._resolveEventAttributesFor(activity);
    return attrs.map((attr) => ({ name: attr, type: "string" }));
  }

  /** @private */
  _buildObjectTypeAttributeSchema(otDef) {
    if (!otDef.attributes) return [];
    return otDef.attributes.map((attr) => ({ name: attr, type: "string" }));
  }

  /** @private */
  _extractEventAttributes(record, activity) {
    const attrs = {};
    const attrList = this._resolveEventAttributesFor(activity);
    for (const attr of attrList) {
      if (record[attr] !== undefined) {
        attrs[attr] = record[attr];
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
  /** Restituisce l'idColumn dichiarato per un objectType, o null se assente. */
  _idColumnFor(typeName) {
    return this.config.objectTypes?.find((t) => t.name === typeName)?.idColumn ?? null;
  }

  /** Copia solo le relazioni "di default" (quelle con qualifier = nome del tipo
   *  oggetto), escludendo quelle aggiunte dalle regole E2O custom.
   *  Serve per dare al sub-evento un punto di partenza pulito senza ereditare
   *  ciecamente le regole specifiche del tipo padre. */
  _defaultRelationships(parentEvent) {
    const defaultQualifiers = new Set((this.config.objectTypes || []).map((t) => t.name));
    return parentEvent.relationships
      .filter((r) => defaultQualifiers.has(r.qualifier))
      .map((r) => ({ ...r }));
  }

  /** Applica le regole E2O filtrate per il tipo dell'evento corrente.
   *  Una regola con eventType null/'*' si applica a tutti gli eventi;
   *  una regola con eventType specifico si applica solo quando event.type matcha.
   *  Gli oggetti referenziati vengono auto-registrati in objectsMap. */
  _applyE2ORules(record, event, objectsMap) {
    if (!this.config.e2oRules) return;
    for (const rule of this.config.e2oRules) {
      // filtro per tipo evento (null/'*' = applica a tutti)
      if (rule.eventType && rule.eventType !== "*" && rule.eventType !== event.type)
        continue;

      const col = rule.column || this._idColumnFor(rule.objectType);
      if (!col) continue; // tipo non riconosciuto
      const objectId = record[col];
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

  _buildO2O(records, objectsMap) {
    const seen = new Set();
    const result = [];

    for (const record of records) {
      for (const rule of this.config.o2oRules) {
        // Schema nuovo: sourceColumn/targetColumn sono dedotti da idColumn dei tipi.
        // Schema vecchio: se sourceColumn/targetColumn sono presenti, vengono usati.
        const srcCol = rule.sourceColumn || this._idColumnFor(rule.sourceType);
        const tgtCol = rule.targetColumn || this._idColumnFor(rule.targetType);
        if (!srcCol || !tgtCol) continue;
        const sourceId = record[srcCol];
        const targetId = record[tgtCol];

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
