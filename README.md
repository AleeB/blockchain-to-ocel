# blockchain-to-ocel

Libreria e CLI per convertire dati blockchain (transazioni, log di eventi, chiamate interne, ecc.) in formato **[OCEL 2.0](https://www.ocel-standard.org/)** (Object-Centric Event Log), lo standard per il process mining object-centric.

Include:
- una **libreria Node.js** zero-dipendenze per il mapping (`OcelMapper`) e la costruzione del config (`ConfigBuilder`);
- un **wizard web** interattivo per configurare il mapping senza scrivere codice;
- una **CLI** per convertire un file blockchain in un file `.jsonocel` a partire da un config.

## Indice
- [Requisiti](#requisiti)
- [Installazione](#installazione)
- [Wizard web](#wizard-web)
- [CLI](#cli)
- [Uso programmatico](#uso-programmatico)
- [MappingConfig](#mappingconfig)
- [Struttura del progetto](#struttura-del-progetto)
- [Esempi](#esempi)
- [Benchmark](#benchmark)
- [Licenza](#licenza)

## Requisiti

- Node.js ≥ 18 (usa `crypto.randomUUID`, ES Modules, `util.parseArgs`)
- Nessuna dipendenza esterna: il progetto non ha pacchetti npm in `dependencies`

## Installazione

```bash
git clone <repo-url>
cd blockchain-to-ocel
```

Non serve `npm install`: il progetto non ha dipendenze di runtime.

## Wizard web

Avvia il server statico che serve il wizard:

```bash
npm start
# oppure: node entrypoints/server.js [porta]   (default: 3000)
```

Poi apri `http://localhost:3000` nel browser. Il wizard guida passo dopo passo attraverso:

1. **Upload** — carica un file JSON o JSONL (drag & drop, file picker o incolla testo)
2. **Normalize** — appiattisce i campi annidati (oggetti e array di oggetti) in dot-notation
3. **Events** — sceglie Event ID, Timestamp, colonne di attività (anche multiple, con tipi diversi) e sorgenti di eventi aggiuntive (array annidati come `internalTxs[]` o `events[]`, ognuno dei quali genera eventi OCEL distinti)
4. **Event Attrs** — per ogni sorgente/tipo di evento, seleziona quali campi diventano attributi (con modalità collassata o espansa per tipo)
5. **Objects** — sceglie quali colonne rappresentano entità partecipanti (account, contratto, asset…)
6. **Object Attrs** — attributi per ogni tipo di oggetto
7. **E2O** — regole evento→oggetto con qualifier obbligatorio (es. `sender → account : initiator`)
8. **O2O** — relazioni dirette oggetto→oggetto con qualifier obbligatorio
9. **Result** — statistiche, validazione, anteprima JSON e download di `.jsonocel` + `config.json`

Tutto il lavoro avviene nel browser: nessun dato viene inviato a un server esterno.

## CLI

```bash
node entrypoints/cli.js convert -i txs.json -c config.json -o log.jsonocel
```

Opzioni:

| Flag | Alias | Descrizione |
|---|---|---|
| `--input <file>` | `-i` | File blockchain JSON o JSONL (obbligatorio) |
| `--config <file>` | `-c` | File `MappingConfig` JSON (obbligatorio) |
| `--output <file>` | `-o` | File di output (default: `output.jsonocel`) |
| `--no-validate` | | Salta la validazione dell'output |

Il file di config può essere scritto a mano seguendo lo schema [MappingConfig](#mappingconfig), oppure esportato dal wizard web ("Download config" nello step Result).

## Uso programmatico

```js
import { OcelMapper, ConfigBuilder, loadFromFile, validateOcel } from "blockchain-to-ocel";

const records = await loadFromFile("./txs.json");

const config = new ConfigBuilder()
  .setEventId("txHash")
  .setActivity("activity")
  .setTimestamp("timestamp")
  .addObjectType({ name: "account", idColumn: "sender" })
  .addObjectType({ name: "contract", idColumn: "contractAddress" })
  .addEventAttribute("gasUsed")
  .addE2O({ objectType: "account", column: "sender", qualifier: "initiator" })
  .build();

const mapper = new OcelMapper(config);
const ocel = mapper.map(records); // sincrono

// Su dataset grandi, usare la variante asincrona con progress callback:
// const ocel = await mapper.mapAsync(records, rawRecords, { onProgress: (p) => ... });

const { valid, errors, warnings } = validateOcel(ocel);
```

Per il browser, importare da `blockchain-to-ocel/browser` invece della root (non usa `fs`):

```js
import { OcelMapper, loadFromBrowserFile, downloadOcel } from "blockchain-to-ocel/browser";
```

## MappingConfig

Oggetto JSON che descrive come i record sorgente diventano un log OCEL 2.0.

| Campo | Tipo | Descrizione |
|---|---|---|
| `eventIdColumn` | `string` | Colonna usata come ID evento (o sentinella UUID per generarlo) |
| `activityColumn` | `string` | Colonna singola che fa da tipo evento (alternativa a `activitySources`) |
| `activitySources` | `{column, typeName}[]` | Più colonne di attività, ognuna con un tipo OCEL opzionale — un record può produrre più eventi |
| `timestampColumn` | `string \| null` | Colonna timestamp, `null` se assente |
| `columnsToNormalize` | `string[]` | Colonne annidate da appiattire prima del mapping |
| `objectTypes` | `{name, idColumn, attributes}[]` | Tipi di oggetto da estrarre e i loro attributi |
| `eventAttributes` | `string[]` | Attributi evento globali (fallback) |
| `eventTypeAttributes` | `{[eventType]: string[]}` | Attributi per specifico tipo di evento; ha priorità su `eventAttributes` (match esatto → prefisso → fallback globale) |
| `additionalEventSources` | `{arrayPath, activityField, idField, qualifier, includeTypes}[]` | Array annidati (es. `internalTxs[]`) da cui estrarre eventi secondari, uno per elemento |
| `e2oRules` | `{eventType?, objectType, column?, qualifier}[]` | Qualifier personalizzati per le relazioni evento→oggetto |
| `o2oRules` | `{sourceType, sourceColumn?, targetType, targetColumn?, qualifier}[]` | Relazioni dirette oggetto→oggetto |

Vedi [`src/types.js`](src/types.js) per le definizioni JSDoc complete e [`examples/pharma-config.json`](examples/pharma-config.json) per un esempio reale.

## Struttura del progetto

```
entrypoints/
  cli.js            CLI (comando "convert")
  server.js         server statico per il wizard web
public/
  index.html        UI del wizard
  app.js            logica del wizard (stato, rendering, eventi)
src/
  index.js          entry point Node.js (esporta l'intera API)
  browser.js         entry point browser (senza fs)
  loader.js / loader.browser.js   caricamento file JSON/JSONL
  normalizer.js      appiattimento campi annidati (dot-notation)
  mapper.js          motore di trasformazione record -> OCEL 2.0 (OcelMapper)
  config.js          builder fluente per MappingConfig (ConfigBuilder)
  wizard-helpers.js  funzioni condivise tra wizard CLI/web e config
  validator.js       validazione e statistiche del log OCEL
  serializer.js      serializzazione in JSON
  exporter.js / exporter.browser.js   scrittura/download dei file di output
  types.js           definizioni di tipo (JSDoc) del progetto
examples/            dataset di esempio, config e output di riferimento
bench.mjs            benchmark della pipeline su dataset sintetici
```

## Esempi

La cartella [`examples/`](examples/) contiene dataset e config di riferimento per diversi scenari (e-commerce, farmaceutico, governance on-chain, transazioni con chiamate interne ed eventi annidati). Sono usati anche per verificare a mano la compatibilità tra wizard e CLI.

## Benchmark

```bash
node bench.mjs 50000
```

Genera un dataset sintetico blockchain-like (con campi annidati) di N record, esegue l'intera pipeline (normalizzazione, mapping, validazione, serializzazione) e stampa una riga CSV `N,timeMs,peakRssMB,events,objects`.

## Licenza

MIT
