/**
 * types.js - Tutte le definizioni di tipo del progetto in un posto solo.
 * Importare con: @type {import('./types.js').NomeTipo}
 */

//#region MappingConfig — quello che il wizard costruisce e il mapper consuma

/**
 * @typedef {object} ObjectTypeMapping
 * @property {string}   name
 * @property {string}   idColumn
 * @property {string[]} [attributes]
 */

/**
 * Regola E2O: qualifier personalizzato per la relazione evento-oggetto.
 * Es: { column: 'sender', objectType: 'wallet', qualifier: 'initiator' }
 *
 * @typedef {object} E2ORule
 * @property {string} column
 * @property {string} objectType
 * @property {string} qualifier
 */

/**
 * Regola O2O: relazione diretta tra due oggetti.
 *
 * @typedef {object} O2ORule
 * @property {string} sourceType
 * @property {string} sourceColumn
 * @property {string} targetType
 * @property {string} targetColumn
 * @property {string} qualifier
 */

/**
 * @typedef {object} MappingConfig
 * @property {string}              eventIdColumn
 * @property {string}              activityColumn
 * @property {string|null}         timestampColumn
 * @property {ObjectTypeMapping[]} objectTypes
 * @property {string[]}            [columnsToNormalize]
 * @property {string[]}            [eventAttributes]
 * @property {E2ORule[]}           [e2oRules]
 * @property {O2ORule[]}           [o2oRules]
 */

//#endregion

//#region Struttura OCEL 2.0

/** @typedef {object} OcelAttributeDef
 *  @property {string} name
 *  @property {string} type
 */

/** @typedef {object} OcelObjectType
 *  @property {string}             name
 *  @property {OcelAttributeDef[]} attributes
 */

/** @typedef {object} OcelEventType
 *  @property {string}             name
 *  @property {OcelAttributeDef[]} attributes
 */

/** @typedef {object} OcelObject
 *  @property {string}              id
 *  @property {string}              type
 *  @property {Record<string, any>} attributes
 */

/** relazione evento -> oggetto
 *  @typedef {object} OcelE2ORelation
 *  @property {string} objectId
 *  @property {string} qualifier
 */

/** @typedef {object} OcelEvent
 *  @property {string}             id
 *  @property {string}             type
 *  @property {string|null}        time
 *  @property {Record<string,any>} attributes
 *  @property {OcelE2ORelation[]}  relationships
 */

/** @typedef {object} OcelO2ORelation
 *  @property {string} sourceId
 *  @property {string} sourceType
 *  @property {string} targetId
 *  @property {string} targetType
 *  @property {string} qualifier
 */

/** documento OCEL 2.0 completo
 *  @typedef {object} OcelLog
 *  @property {OcelObjectType[]}  objectTypes
 *  @property {OcelEventType[]}   eventTypes
 *  @property {OcelObject[]}      objects
 *  @property {OcelEvent[]}       events
 *  @property {OcelO2ORelation[]} o2o
 */

//#endregion

//#region Output validator

/** @typedef {object} ValidationResult
 *  @property {boolean}  valid
 *  @property {string[]} errors
 *  @property {string[]} warnings
 */

/** @typedef {object} OcelStats
 *  @property {number}               totalEvents
 *  @property {number}               totalObjects
 *  @property {number}               totalE2ORelations
 *  @property {number}               totalO2ORelations
 *  @property {Record<string,number>} eventTypes
 *  @property {Record<string,number>} objectTypes
 */

//#endregion

// Export minimo per far riconoscere il file come modulo ES
export const __TYPES_MODULE__ = true;
