import { createTakosApp } from "./server.ts";

const app = await createTakosApp();
Deno.serve(app.fetch);
