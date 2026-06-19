/**
 * cli.js - Entry point del CLI blockchain-to-ocel.
 *
 * Comando disponibile:
 *   convert -> Legge un file blockchain e un file config, produce un file OCEL 2.0
 *
 * Uso:
 *   --input	-i	—	Obbligatorio. File blockchain JSON
 *   --config	-c	—	Obbligatorio. File MappingConfig JSON
 *   --output	-o	output.jsonocel	File di output OCEL
 *   --no-validate	—	Salta la validazione dell'output
 */

import { parseArgs } from "util";
import { resolve } from "path";

import { loadFromFile } from "../src/loader.js";
import {
  detectNestedColumns,
  normalizeRecords,
  collectAllColumns,
} from "../src/normalizer.js";
import { OcelMapper } from "../src/mapper.js";
import { validateOcel, getOcelStats } from "../src/validator.js";
import { writeOcelFile } from "../src/exporter.js";

// Colori ANSI per l'output nel terminale
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function info(msg) {
  console.log(`${c.cyan}i${c.reset}  ${msg}`);
}
function ok(msg) {
  console.log(`${c.green}ok${c.reset} ${msg}`);
}
function warn(msg) {
  console.warn(`${c.yellow}!${c.reset}  ${msg}`);
}
function err(msg) {
  console.error(`${c.red}x${c.reset}  ${msg}`);
}
function section(msg) {
  console.log(`\n${c.bold}${msg}${c.reset}`);
}

const HELP = `
${c.bold}blockchain-to-ocel${c.reset} - Converti dati blockchain in formato OCEL 2.0

${c.bold}USO${c.reset}
  node entrypoints/cli.js convert [opzioni]

${c.bold}OPZIONI${c.reset}
  -i, --input    <file>       File blockchain JSON o JSONL (obbligatorio)
  -c, --config   <file>       File MappingConfig JSON (obbligatorio)
  -o, --output   <file>       File di output (default: output.jsonocel)
  --no-validate               Salta la validazione dell'output

${c.bold}ESEMPIO${c.reset}
  node entrypoints/cli.js convert -i txs.json -c config.json -o log.jsonocel
`;

async function runConvert(args) {
  const { values } = parseArgs({
    args,
    options: {
      input: { type: "string", short: "i" },
      config: { type: "string", short: "c" },
      output: { type: "string", short: "o", default: "output.jsonocel" },
      validate: { type: "boolean", default: true },
    },
    strict: false,
  });

  if (!values.input || !values.config) {
    err("--input e --config sono obbligatori");
    console.log(HELP);
    process.exit(1);
  }

  // Carica e normalizza il file di input
  section("Caricamento");
  info(`File dati:   ${values.input}`);
  info(`File config: ${values.config}`);

  const raw = await loadFromFile(resolve(values.input));

  // Carica il config
  const configData = await loadFromFile(resolve(values.config));
  const config = Array.isArray(configData) ? configData[0] : configData;

  // Usa le colonne dal config; se non ci sono, le rileva automaticamente
  const nested = config.columnsToNormalize ?? detectNestedColumns(raw);
  const records = normalizeRecords(raw, nested);
  const columns = collectAllColumns(records);
  ok(`${raw.length} record caricati, ${columns.length} colonne trovate`);
  if (nested.length) info(`Colonne appiattite: ${nested.join(", ")}`);

  // Mapping
  section("Mapping");
  const mapper = new OcelMapper(config);
  // Passa anche i record RAW: servono al mapper per accedere agli array
  // originali quando il config contiene additionalEventSources (es. blockchain
  // tx con events[] o internalTxs[] da estrarre come eventi distinti).
  const ocel = mapper.map(records, raw);
  ok(`Prodotti ${ocel.events.length} eventi e ${ocel.objects.length} oggetti`);
  if (config.additionalEventSources?.length) {
    const subCount = ocel.events.filter((e) => e.attributes?._subEvent === true).length;
    if (subCount) info(`Di cui ${subCount} estratti dalle sorgenti aggiuntive`);
  }

  // Validazione
  if (values.validate) {
    const result = validateOcel(ocel);
    if (!result.valid) {
      err("Validazione fallita:");
      result.errors.forEach((e) => err("  " + e));
      process.exit(1);
    }
    result.warnings.forEach((w) => warn(w));
    ok("Validazione superata");
  }

  // Statistiche
  const stats = getOcelStats(ocel);
  section("Statistiche");
  console.log(`  ${c.dim}Eventi:${c.reset}       ${stats.totalEvents}`);
  console.log(`  ${c.dim}Oggetti:${c.reset}      ${stats.totalObjects}`);
  console.log(`  ${c.dim}Rel. E2O:${c.reset}     ${stats.totalE2ORelations}`);
  console.log(`  ${c.dim}Rel. O2O:${c.reset}     ${stats.totalO2ORelations}`);
  const etLines = Object.entries(stats.eventTypes)
    .map(([k, v]) => `${k}: ${v}`)
    .join("  ");
  const otLines = Object.entries(stats.objectTypes)
    .map(([k, v]) => `${k}: ${v}`)
    .join("  ");
  if (etLines) console.log(`  ${c.dim}Tipi evento:${c.reset}  ${etLines}`);
  if (otLines) console.log(`  ${c.dim}Tipi oggetto:${c.reset} ${otLines}`);

  // Scrittura output
  await writeOcelFile(ocel, resolve(values.output));
  ok(`Output salvato: ${values.output}\n`);
}

// Dispatch
const [, , command, ...rest] = process.argv;

if (!command || command === "--help" || command === "-h") {
  console.log(HELP);
  process.exit(0);
}

if (command === "convert") {
  runConvert(rest).catch((e) => {
    err(e.message);
    process.exit(1);
  });
} else {
  err(`Comando sconosciuto: "${command}"`);
  console.log(HELP);
  process.exit(1);
}
