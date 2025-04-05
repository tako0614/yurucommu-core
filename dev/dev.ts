import app from "../main.ts";
import { load } from "@std/dotenv";
const env = await load();
console.log("Starting server on port", env["PORT"]);

Deno.serve({
  port: Number(env["PORT"]),
}, app.fetch);
