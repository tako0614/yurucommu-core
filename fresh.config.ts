import { defineConfig } from "$fresh/server.ts";
//import twindPlugin from "$fresh/plugins/twind.ts"
//import twindConfig from "./twind.config.ts";
import tailwind from "$fresh/plugins/tailwind.ts";
export default defineConfig({
  plugins: [tailwind()],
});
