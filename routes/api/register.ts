import { Handlers, PageProps } from "$fresh/server.ts";
import database from "../../util/database.ts";
import { testMail } from "../../util/denomail.ts";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
interface Data {
    userName: string;
  }
  
export const handler: Handlers<Data> = {
    async GET(req, ctx) {
      const url = new URL(req.url);
      //console.log(url);
      const key = url.searchParams.get("userName") || "";
      //const result = await database.execute(`SELECT * FROM temp_users WHERE key = "${key}"`);
      return new Response(JSON.stringify({userName}));
    },
};
