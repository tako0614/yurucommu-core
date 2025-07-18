import { load } from "jsr:@std/dotenv";
import { connectDatabase } from "../shared/db.ts";
import Session from "../app/api/models/session.ts";
import HostSession from "../app/takos_host/models/session.ts";

const env = await load();
await connectDatabase(env);

await Session.collection.createIndex({ expiresAt: 1 }, {
  expireAfterSeconds: 0,
});
await HostSession.collection.createIndex({ expiresAt: 1 }, {
  expireAfterSeconds: 0,
});

console.log("TTL indexes created");
