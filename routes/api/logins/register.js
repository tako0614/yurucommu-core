// deno-lint-ignore-file
import { Client } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import { isMail, isUserDuplication, isMailDuplication, isMailDuplicationTemp, hashPassword, sendMail,client} from "../../../util/takoFunction.ts";

export const handler = {
  async POST(req) {
      const data = await req.json();
      const email = await data.mail;
      const CsrfToken = await data.csrftoken;
      const error = {
        "status": "error"
      }
      const ismail = isMail(email)
      const ismailduplication = await isMailDuplication(email)
      if(ismail) {
        if(!ismailduplication) {
            try {
            await isMailDuplicationTemp(email)
            const key = generateRandomString(255);
            await client.query(`INSERT INTO temp_users (id,created_at,mail, kye) VALUES (default,default,"${email}",'${key}');`)
            sendMail(email,"本登録を完了してください",`https://takos.jp/register?key=${key}`)
            return new Response(JSON.stringify({status: true}), {
              headers: { "Content-Type": "application/json" },
            });
            } catch (error) {
              return new Response(JSON.stringify({"status": "error"}), {
                headers: { "Content-Type": "application/json" },
              });
            }
        }else {
          return new Response(JSON.stringify({"status": "error"}), {
            headers: { "Content-Type": "application/json" },
          });
        }
      }else {
        return new Response(JSON.stringify({"status": "error"}), {
          headers: { "Content-Type": "application/json" },
        });
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