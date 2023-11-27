import { Handlers } from "$fresh/server.ts";
//import database from "../../util/database.ts";
//import { testMail } from "../../util/denomail.ts";
//import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import { isMail, isUserDuplication, isMailDuplication, generateSalt, hashPassword, sendMail,client} from "../../util/takoFunction.ts";

interface Data {
  userName: string;
}
interface takojson  {
  status: string;
  requirements: string;
  mail: string;
  password: string;
  userName: string;
}
export const handler: Handlers = {
  async POST(req) {
    const request = (await req.json());
    let result = {};
    switch (request) {
      case request.requirements == "temp_register":
        result = temp_register(request);
        break;
      case request.requirements == "login":
        result = login(request);
        break;
    }
    return new Response(JSON.stringify(result));
  },
  async GET(req) {
    let result = {};
    const url = new URL(req.url);
    const requirments = url.searchParams.get("requirments") || "";
    switch(requirments) {
      case "register":
        result = register(url);
        break;
    }
    return new Response(JSON.stringify(result));
  },
};
async function temp_register(request: takojson) {
  if (!isMail(request.mail)) {
    return { "status": "error", "message": "メールアドレスが不正です" };
  }
  if (await isMailDuplication(request.mail)) {
    return { "status": "error", "message": "すでにそのメールアドレスは使われています" };
  }
  if (await isUserDuplication(request.userName)) {
    return { "status": "error", "message": "すでにそのユーザー名は使われています" };
  }
  const salt = generateSalt(32);
  const password = hashPassword(request.password, salt);
  const token = generateSalt(32);
  const result = await client.execute(`INSERT INTO users (userid, mail, password, salt, token) VALUES ("${request.userName}", "${request.mail}", "${password}", "${salt}", "${token}");`);
  if (result.affectedRows === 0) {
    return { "status": "error", "message": "登録に失敗しました" };
  }
  sendMail(request.mail, "仮登録完了", `以下のURLから本登録を完了してください\nhttps://tako.freshlive.tv/api/tako?requirements=register&token=${token}`);
  return { "status": "success", "message": "仮登録が完了しました" };
}
function login(request: takojson) {
return { "status": "success",request }
}
function register(request: object) {
return { "status": "success",request }
}