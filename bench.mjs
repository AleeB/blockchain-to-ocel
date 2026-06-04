/**
 * bench.mjs - Benchmark della pipeline blockchain-to-ocel.
 *
 * Genera dataset sintetici (struttura blockchain-like con campi annidati)
 * di dimensione crescente, esegue la pipeline completa e misura tempo e memoria.
 *
 * Uso:  node bench.mjs <numeroRecord>
 * Stampa una riga CSV: N,timeMs,peakRssMB,events,objects
 */

import {
  normalizeRecords,
  OcelMapper,
  validateOcel,
  serializeOcel,
} from "./src/index.js";

const N = Number(process.argv[2] ?? 10000);

// --- Generazione dataset sintetico (blockchain-like, con annidamento) ---
function makeRecords(n) {
  const records = [];
  const activities = ["transfer", "approve", "sendFrom", "mint", "burn"];
  for (let i = 0; i < n; i++) {
    records.push({
      txHash: `0x${i.toString(16).padStart(8, "0")}`,
      blockNumber: String(19000000 + i),
      contractAddress: `0xC${(i % 50).toString(16)}`, // 50 contratti distinti
      sender: `0xW${(i % 2000).toString(16)}`, // 2000 wallet distinti
      gasUsed: String(21000 + (i % 100000)),
      activity: activities[i % activities.length],
      timestamp: new Date(1700000000000 + i * 1000).toISOString(),
      inputs: [
        { inputName: "to", type: "address", inputValue: `0xW${(i % 2000).toString(16)}` },
        { inputName: "amount", type: "uint256", inputValue: i * 1000 },
      ],
      events: [
        { eventName: "Transfer", eventValues: { from: `0xW${(i % 2000)}`, value: i } },
      ],
    });
  }
  return records;
}

const config = {
  eventIdColumn: "txHash",
  activityColumn: "activity",
  timestampColumn: "timestamp",
  columnsToNormalize: ["inputs", "events"],
  objectTypes: [
    { name: "wallet", idColumn: "sender", attributes: [] },
    { name: "contract", idColumn: "contractAddress", attributes: [] },
  ],
  eventAttributes: ["gasUsed"],
  e2oRules: [],
  o2oRules: [],
};

// --- Esecuzione e misura ---
const raw = makeRecords(N);

const t0 = performance.now();
const records = normalizeRecords(raw, config.columnsToNormalize);
const mapper = new OcelMapper(config);
const ocel = mapper.map(records);
validateOcel(ocel);
serializeOcel(ocel);
const t1 = performance.now();

const peakRssMB = process.memoryUsage().rss / (1024 * 1024);

console.log(
  `${N},${(t1 - t0).toFixed(1)},${peakRssMB.toFixed(1)},${ocel.events.length},${ocel.objects.length}`,
);
