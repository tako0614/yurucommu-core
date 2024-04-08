/// <reference no-default-lib="true" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/// <reference lib="dom.asynciterable" />
/// <reference lib="deno.ns" />
import "$std/dotenv/load.ts"

import { start } from "$fresh/server.ts"
import manifest from "./fresh.gen.ts"
import config from "./fresh.config.ts"
import mongoose from "mongoose"
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts"
/**connect mongoDB */
const env = await load()
const url = env["MONGO_URL"]
await mongoose.connect(url).then(() => {
  console.log("mongo DB 接続")
}).catch((err) => {
  console.log(err)
})
await start(manifest, config)
