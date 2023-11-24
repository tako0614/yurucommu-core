import { testMail } from "../../util/denomail.ts";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
const env = await load();
const smtp_auth_user: string = env["smtp_username"];
export default function sendmail() {
  testMail(smtp_auth_user, "test", "test");
    return new Response("ok");
}