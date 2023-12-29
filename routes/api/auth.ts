import { Handlers } from "$fresh/server.ts";
//import { re } from "$std/semver/_shared.ts";
import { sql,isMail, isUserDuplication, isMailDuplication, generateSalt, /*hashPassword,*/ sendMail} from "../../util/takoFunction.ts";
import * as types from "../../util/types.ts";
//リクエスト振り分け
export const handler: Handlers = {
  async POST(req) {

    const request = (await req.json());
    console.log(request.requirements);
    const requirements = request.requirements;
    let result;

    switch (requirements) {
      case "temp_register":
        //return new Response(JSON.stringify(temp_register(request)))
        result = await temp_register(request);
        break;

      case "login":
        //result = login(request);
        break;

    }
    console.log(result);
    return new Response(JSON.stringify(result))//new Response(JSON.stringify(result));
  },

  async GET(req) {
    let result = {};
    const url = new URL(req.url);
    const requirments = url.searchParams.get("requirments") || "";
    switch(requirments) {
      case "register":
        //result = register(url);
        break;
    }
    return new Response(JSON.stringify(result));
  },
};
// deno-lint-ignore no-explicit-any
async function temp_register(request: any) {
    if (!isMail(request.mail)) {
    return { "status": "error", "message": "メールアドレスが不正です" };
    }
    
    if (await isMailDuplication(request.mail)) {
    return { "status": "error", "message": "すでにそのメールアドレスは使われています" };
    }
    
    if (await isUserDuplication(request.userName)) {
    return { "status": "error", "message": "すでにそのユーザー名は使われています" };
    }
    const token = generateSalt(32);
    const result = await sql(`INSERT INTO temp_users (name, mail, kye) VALUES ("${request.userName}", "${request.mail}", "${token}");`);
    if (result.affectedRows === 0) {
        return { "status": "error", "message": "登録に失敗しました" };
    }
    sendMail(request.mail, "仮登録完了", `以下のURLから本登録を完了してください\nhttps://tako.freshlive.tv/api/tako?requirements=register&token=${token}`);
    console.log(request)
    const response = {
        status: "success",
        mail: "",
        password: "",
        userName: "",
        "message": "仮登録が完了しました"
    }
    return response;
}