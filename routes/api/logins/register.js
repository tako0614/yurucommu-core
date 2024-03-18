import { isMail, isMailDuplication, isMailDuplicationTemp, sendMail} from "../../../util/takoFunction.ts";
import tempUsers from "../../../models/tempUsers.js";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
const env = await load();
const secretKey = env["rechapcha_seecret_key"]
const mailDomain = env["mailDomain"]
export const handler = {
  async POST(req) {
      const data = await req.json();
      const email = await data.mail;
      const ismail = isMail(email)
      const rechapcha = await data.token
      if(email === undefined || rechapcha === undefined || rechapcha === "" || email === "" || rechapcha === null || email === null) {
        return new Response(JSON.stringify({"status": "error"}), {
          headers: { "Content-Type": "application/json",status : 403},
        });
      }
      const isSecsusRechapcha = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${rechapcha}`)
      const score = await isSecsusRechapcha.json()
      console.log(score)
      if(score.score < 0.7 || score.success == false) {
        return new Response(JSON.stringify({"status": "rechapchaerror"}), {
          headers: { "Content-Type": "application/json",status : 403},
        });
      }
      const ismailduplication = await isMailDuplication(email)
      if(ismail) {
        if(!ismailduplication) {
            try {
              const array = new Uint8Array(64);
              crypto.getRandomValues(array);
              const key = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
            if(isMailDuplicationTemp(email)) {
              await tempUsers.deleteOne({mail: email})
            }
            await tempUsers.create({mail: email, key: key})
            sendMail(email,"本登録を完了してください",`${mailDomain}/register?key=${key}`)
            return new Response(JSON.stringify({status: true}), {
              headers: { "Content-Type": "application/json",
                          status : 200 },
            });
            } catch (error) {
              console.log(error)
              return new Response(JSON.stringify({"status": "500error"}), {
                headers: { "Content-Type": "application/json",
                            status : 403},
              });
            }
        }else {
          return new Response(JSON.stringify({"status": "mailerror"}), {
            headers: { "Content-Type": "application/json",
                        status : 403},
          });
        }
      }else {
        return new Response(JSON.stringify({"status": "error"}), {
          headers: { "Content-Type": "application/json",status : 403},
        });
      }
  }
};