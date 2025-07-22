import { loadConfig } from "../shared/config.ts";
import { connectDatabase } from "../shared/db.ts";
import Session from "../app/api/models/takos/session.ts";
import HostSession from "../app/api/models/takos_host/session.ts";

const env = await loadConfig();
await connectDatabase(env);

await Session.collection.createIndex({ expiresAt: 1 }, {
  expireAfterSeconds: 0,
});
await HostSession.collection.createIndex({ expiresAt: 1 }, {
  expireAfterSeconds: 0,
});

console.log("TTL indexes created");
