#!/usr/bin/env -S deno run -A --watch=static/,routes/

import dev from "$fresh/dev.ts";
import config from "./fresh.config.ts";

import "$std/dotenv/load.ts";

import { envRoader } from "./util/takoFunction.ts";
/**connect mongoDB */
import mongoose from "npm:mongoose@8.2.0";
/*
try {
    mongoose.connect(
        `mongodb://192.168.0.30:27017/takos`
      )
} catch (error) {
    console.log(error)
}*/
await dev(import.meta.url, "./main.ts", config);

