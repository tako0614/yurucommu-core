import { isMail, isUserDuplication, isMailDuplication, isMailDuplicationTemp, isCsrftoken, sendMail} from "../../../util/takoFunction.ts";
import tempUsers from "../../../models/tempUsers.js";
export const handler = {
  async POST(req,res, ctx) {
      const data = await req.json();
      const email = await data.mail;
      const ismail = isMail(email)
      const ismailduplication = await isMailDuplication(email)
      if(ismail) {
        if(!ismailduplication) {
            try {
            const key = generateRandomString(255);
            if(isMailDuplicationTemp(email)) {
              tempUsers.deleteOne({mail: email})
            }
            await tempUsers.create({mail: email, key: key})
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
        res.status(403).send({"status": "error"})
        /*return new Response(JSON.stringify({"status": "error"}), {
          headers: { "Content-Type": "application/json" },
        });*/
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