/**
 * validator.js - Controlla che un documento OCEL 2.0 sia strutturalmente corretto.
 *
 * Distingue tra errori gravi (es. relazioni verso oggetti inesistenti)
 * e avvertimenti non bloccanti (es. timestamp mancanti, ID duplicati).
 */

// Campi che ogni documento OCEL 2.0 deve avere obbligatoriamente
const REQUIRED_ARRAYS = ["objectTypes", "eventTypes", "objects", "events"];

/**
 * Verifica la struttura di un documento OCEL 2.0.
 * Controlla: campi obbligatori, unicità degli ID, coerenza delle relazioni
 * e che ogni tipo usato sia dichiarato in objectTypes/eventTypes.
 *
 * @param {object} ocel
 * @returns {import('./types.js').ValidationResult}
 */
export function validateOcel(ocel) {
  const errors = [];
  const warnings = [];

  // Controllo 1: tipo dell'input
  if (!ocel || typeof ocel !== "object") {
    return {
      valid: false,
      errors: ["Il documento OCEL deve essere un oggetto"],
      warnings,
    };
  }

  // Controllo 2: array obbligatori
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(ocel[key])) {
      errors.push(`Campo obbligatorio mancante o non-array: "${key}"`);
    }
  }
  // Se manca anche solo un array obbligatorio i controlli successivi non possono procedere
  if (errors.length > 0) return { valid: false, errors, warnings };

  // Controllo 3 + 4: eventi
  const eventIds = new Set();
  for (const event of ocel.events) {
    if (!event.id) {
      errors.push("Trovato un evento senza id");
    } else if (eventIds.has(event.id)) {
      errors.push(`ID evento duplicato: ${event.id}`);
    } else {
      eventIds.add(event.id);
    }

    if (!event.type) {
      errors.push(`Evento ${event.id ?? "?"}: type mancante`);
    }

    // Il timestamp mancante e' un avvertimento, non blocca l'uso del log
    if (!event.time) {
      warnings.push(`Evento ${event.id ?? "?"}: time mancante`);
    }

    if (!Array.isArray(event.relationships)) {
      errors.push(
        `Evento ${event.id ?? "?"}: "relationships" deve essere un array`,
      );
    }
  }

  // Controllo 5: oggetti
  const objectIds = new Set();
  for (const obj of ocel.objects) {
    if (!obj.id) {
      errors.push("Trovato un oggetto senza id");
    } else if (objectIds.has(obj.id)) {
      // ID duplicati negli oggetti: avvertimento perche' alcuni strumenti lo tollerano,
      // ma di solito indica che la colonna scelta come ID non e' univoca
      warnings.push(`ID oggetto duplicato: ${obj.id}`);
    } else {
      objectIds.add(obj.id);
    }

    if (!obj.type) {
      errors.push(`Oggetto ${obj.id ?? "?"}: type mancante`);
    }
  }

  // Controllo 6: ogni relazione evento-oggetto deve puntare a un oggetto esistente
  for (const event of ocel.events) {
    if (!Array.isArray(event.relationships)) continue;
    for (const rel of event.relationships) {
      if (!rel.objectId) {
        errors.push(`Evento ${event.id}: relazione senza objectId`);
      } else if (!objectIds.has(rel.objectId)) {
        errors.push(
          `Evento ${event.id}: relazione verso oggetto inesistente "${rel.objectId}"`,
        );
      }
      if (!rel.qualifier) {
        warnings.push(`Evento ${event.id}: relazione senza qualifier`);
      }
    }
  }

  // Controllo 7: ogni relazione O2O deve puntare a oggetti esistenti
  if (Array.isArray(ocel.o2o)) {
    for (const rel of ocel.o2o) {
      if (!objectIds.has(rel.sourceId)) {
        errors.push(
          `O2O: sorgente inesistente "${rel.sourceId}" (tipo: ${rel.sourceType})`,
        );
      }
      if (!objectIds.has(rel.targetId)) {
        errors.push(
          `O2O: destinazione inesistente "${rel.targetId}" (tipo: ${rel.targetType})`,
        );
      }
    }
  }

  // Controllo 8: ogni oggetto/evento deve avere un tipo dichiarato in objectTypes/eventTypes
  // Un tipo non dichiarato non e' un errore formale, ma spesso segnala un config incompleto
  const declaredObjectTypes = new Set(ocel.objectTypes.map((t) => t.name));
  for (const obj of ocel.objects) {
    if (obj.type && !declaredObjectTypes.has(obj.type)) {
      warnings.push(
        `Oggetto "${obj.id}": tipo "${obj.type}" non dichiarato in objectTypes`,
      );
    }
  }

  const declaredEventTypes = new Set(ocel.eventTypes.map((t) => t.name));
  for (const event of ocel.events) {
    if (event.type && !declaredEventTypes.has(event.type)) {
      warnings.push(
        `Evento "${event.id}": tipo "${event.type}" non dichiarato in eventTypes`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Calcola statistiche aggregate (conteggi per tipo, totale relazioni ecc.).
 * Non fa validazione — quello tocca a validateOcel().
 *
 * @param {import('./types.js').OcelLog} ocel
 */
export function getOcelStats(ocel) {
  // Conta gli oggetti per tipo (es. { wallet: 1781, contract: 1 })
  const objectTypeCounts = {};
  for (const obj of ocel.objects ?? []) {
    objectTypeCounts[obj.type] = (objectTypeCounts[obj.type] ?? 0) + 1;
  }

  // Conta gli eventi per tipo di attivita' (es. { lock: 8202, unlock: 3325 })
  const eventTypeCounts = {};
  for (const event of ocel.events ?? []) {
    eventTypeCounts[event.type] = (eventTypeCounts[event.type] ?? 0) + 1;
  }

  // Totale relazioni E2O: somma delle relationships di tutti gli eventi
  let totalE2O = 0;
  for (const event of ocel.events ?? []) {
    totalE2O += Array.isArray(event.relationships)
      ? event.relationships.length
      : 0;
  }

  return {
    totalEvents: (ocel.events ?? []).length,
    totalObjects: (ocel.objects ?? []).length,
    totalE2ORelations: totalE2O,
    totalO2ORelations: (ocel.o2o ?? []).length,
    eventTypes: eventTypeCounts,
    objectTypes: objectTypeCounts,
  };
}
