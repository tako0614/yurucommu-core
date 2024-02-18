import { isMail, isUserDuplication, isMailDuplication, generateSalt, hashPassword, sendMail} from "../../../util/takoFunction.ts";

export const handler = {
  async POST(req) {
      const data = await req.json();
      const UserName = data.username;
      const email = data.email;
      const CsrfToken = data.csrftoken;
      const error = {
        "status": "error"
      }
      if(true) {
        //
      }
      if(!isMail(email)) {
        return new Response(JSON.stringify(error), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if(!isMailDuplication(email)) {
        return new Response(JSON.stringify(error), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if(!isUserDuplication) {
        return new Response(JSON.stringify(error), {
          headers: { "Content-Type": "application/json" },
        });
      }
      try {
        //sha256生成
        const hash = "ううえええええ"
        result = client("くえりいいいいいいいいい")
        sendMail(email,"本登録を完了してください",`https://takos.jp/register?key=${hash}`)
        return new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        return new Response(JSON.stringify({"status": "error"}), {
          headers: { "Content-Type": "application/json" },
        });
      }
  }
};