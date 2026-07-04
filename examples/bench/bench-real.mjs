/**
 * bench-real.mjs - Benchmark della pipeline blockchain-to-ocel su dataset reali
 * (Ethereum mainnet, da OSF) invece che sintetici come bench.mjs.
 *
 * Uso: node bench-real.mjs <file.json>
 */
import { readFileSync } from "fs";
import {
  detectNestedColumns,
  normalizeRecords,
  collectAllColumns,
  OcelMapper,
  validateOcel,
  serializeOcel,
} from "../../src/index.js";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node bench-real.mjs <file.json>");
  process.exit(1);
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

function now() {
  return performance.now();
}

const t = {};
const mem = () => process.memoryUsage().rss;
const peakStart = mem();
let peak = peakStart;
const trackPeak = () => {
  const m = mem();
  if (m > peak) peak = m;
};

console.log(`\n=== ${file} ===`);
const fileSizeBytes = readFileSync(file).length;
console.log(`Dimensione file: ${mb(fileSizeBytes)} MB`);

// 1. Lettura + parse
let t0 = now();
const raw = readFileSync(file, "utf-8");
const t1 = now();
const data = JSON.parse(raw);
const t2 = now();
const records = Array.isArray(data) ? data : Object.values(data);
trackPeak();

t.read = t1 - t0;
t.parse = t2 - t1;
console.log(`Record: ${records.length.toLocaleString()}`);
console.log(`  Lettura file:      ${t.read.toFixed(0)} ms`);
console.log(`  JSON.parse:        ${t.parse.toFixed(0)} ms`);

// 2. Rilevamento colonne annidate + normalizzazione (flattening)
let t3 = now();
const nested = detectNestedColumns(records);
let t4 = now();
const normalized = normalizeRecords(records, nested);
let t5 = now();
const allCols = collectAllColumns(normalized);
let t6 = now();
trackPeak();

t.detectNested = t4 - t3;
t.normalize = t5 - t4;
t.collectCols = t6 - t5;
console.log(`  detectNestedColumns: ${t.detectNested.toFixed(0)} ms (${nested.join(", ")})`);
console.log(`  normalizeRecords:    ${t.normalize.toFixed(0)} ms`);
console.log(`  collectAllColumns:   ${t.collectCols.toFixed(0)} ms -> ${allCols.length.toLocaleString()} colonne`);

// 3. Config: stesso schema usato per i test manuali su questo dataset
// (functionName/sender/contractAddress + internalTxs/events come sorgenti aggiuntive)
const config = {
  eventIdColumn: "transactionHash",
  activityColumn: "functionName",
  timestampColumn: normalized[0]?.["timestamp.$date"] !== undefined ? "timestamp.$date" : "timestamp",
  objectTypes: [
    { name: "account", idColumn: "sender", attributes: [] },
    { name: "contract", idColumn: "contractAddress", attributes: [] },
  ],
  eventAttributes: ["gasUsed", "blockNumber"],
  additionalEventSources: [
    { arrayPath: "internalTxs", activityField: "activity", qualifier: "internalTxs", includeTypes: [] },
    { arrayPath: "events", activityField: "eventName", qualifier: "events", includeTypes: [] },
  ],
  e2oRules: [{ objectType: "account", column: "sender", qualifier: "initiator" }],
  o2oRules: [],
};

// 4. Mapping (async, come nel wizard, per misurare anche il costo del chunking a progress)
let t7 = now();
const mapper = new OcelMapper(config);
const ocel = await mapper.mapAsync(normalized, records, { progressEvery: 5000 });
let t8 = now();
trackPeak();

t.map = t8 - t7;
console.log(`  OcelMapper.mapAsync: ${t.map.toFixed(0)} ms -> ${ocel.events.length.toLocaleString()} eventi, ${ocel.objects.length.toLocaleString()} oggetti`);

// 5. Validazione
let t9 = now();
const { valid, errors, warnings } = validateOcel(ocel);
let t10 = now();
trackPeak();
t.validate = t10 - t9;
console.log(`  validateOcel:        ${t.validate.toFixed(0)} ms (valid=${valid}, errors=${errors.length}, warnings=${warnings.length})`);

// 6. Serializzazione (formato OCEL 2.0 standard)
let t11 = now();
const json = serializeOcel(ocel);
let t12 = now();
trackPeak();
t.serialize = t12 - t11;
console.log(`  serializeOcel:       ${t.serialize.toFixed(0)} ms -> output ${mb(json.length)} MB`);

const total = Object.values(t).reduce((a, b) => a + b, 0);
console.log(`  ---`);
console.log(`  TOTALE:              ${(total / 1000).toFixed(2)} s`);
console.log(`  Picco memoria RSS:   ${mb(peak)} MB`);

console.log(
  `\nCSV,${file},${fileSizeBytes},${records.length},${allCols.length},${ocel.events.length},${ocel.objects.length},` +
    `${t.read.toFixed(0)},${t.parse.toFixed(0)},${t.detectNested.toFixed(0)},${t.normalize.toFixed(0)},${t.collectCols.toFixed(0)},${t.map.toFixed(0)},${t.validate.toFixed(0)},${t.serialize.toFixed(0)},${total.toFixed(0)},${mb(peak)}`,
);
