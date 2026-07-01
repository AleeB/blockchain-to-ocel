import { OcelMapper, ConfigBuilder, serializeOcel } from "./src/index.js";

const records = [
  { orderId: "o1", customerId: "c1", eventId: "e1", activity: "create-order", timestamp: 1700000000, channel: "web" },
];

const config = new ConfigBuilder()
  .setEventId("eventId")
  .setActivity("activity")
  .setTimestamp("timestamp")
  .addObjectType({ name: "order", idColumn: "orderId", attributes: ["channel"] })
  .build();

const mapper = new OcelMapper(config);
const ocel = mapper.map(records);
console.log(serializeOcel(ocel));
