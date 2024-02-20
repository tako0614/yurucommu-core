import { envRoader} from "../../util/takoFunction.ts";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import { Client } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
const env = await load();
const hostname = env["hostname"];
const username = env["username"];
const db = env["db"];
const password = env["password"];
const client = await new Client().connect({
  hostname,
  username,
  db,
  password,
});

export const handler = {
  async GET(req) {
    const url = new URL(req.url);
    const origin = url.searchParams.get("origin") || "";
    const allows = envRoader("origin")
    const allow = allows.split(',')
    if(allow.includes(origin)){
      const csrftoken = generateRandomString(128)
      await client.execute(`INSERT INTO csrftoken VALUES (default,default,"${csrftoken}");`)
      return new Response(JSON.stringify({"csrftoken": csrftoken}), {
        headers: { "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": origin
        },
      }
      );
    }else {
      console.log(a)
      return new Response(JSON.stringify({"csrftoken": "This origin is not allowed"}), {
        headers: { "Content-Type": "application/json",
                    "Access-Control-Allow-Origin": origin
        },
      }
      );
    }
  }
};
function generateRandomString(length) {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * characters.length);
    result += characters.charAt(randomIndex);
  }
  return result;
}