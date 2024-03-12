/// <reference no-default-lib="true" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
/// <reference lib="deno.ns" />
import "$std/dotenv/load.ts";

import { start } from "$fresh/server.ts";
import manifest from "./fresh.gen.ts";
import config from "./fresh.config.ts";
import mongoose from "npm:mongoose@^6.7";
//import users from "./models/users.ts";

await mongoose.connect("mongodb://localhost:27017").then(() => {console.log("mongo DB 接続")});
await start(manifest, config);
