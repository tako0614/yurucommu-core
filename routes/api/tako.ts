import { Handlers } from "$fresh/server.ts";
//import { re } from "$std/semver/_shared.ts";
import { isMail, isUserDuplication, isMailDuplication, generateSalt, /*hashPassword,*/ sendMail,client} from "../../util/takoFunction.ts";

interface Data {
  userName: string;
}
interface takojson  {
  status: string;
  requirements: string;
  mail: string;
  password: string;
  userName: string;
  message?: string;
}
interface takoresponse {
    method: string,
    headers: {
        "Content-Type": string,
        "Access-Control-Allow-Origin": string,
    },
    body: {
      status: string;
      requirements: string;
      mail: string;
      password: string;
      userName: string;
      message?: string;
    }
}
export const handler: Handlers = {
  async POST(req) {
    const request = (await req.json());
    console.log(request.requirements);
    const requirements = request.requirements;
    let result = {};
    switch (requirements) {
      case "temp_register":
        //return new Response(JSON.stringify(temp_register(request)))
        result = await temp_register(request);
        break;
      case "login":
        result = login(request);
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
  /*
  const salt = generateSalt(32);
  const password = hashPassword(request.password, salt);*/
  const token = generateSalt(32);
  const result = await client.execute(`INSERT INTO temp_users (name, mail, kye) VALUES ("${request.userName}", "${request.mail}", "${token}");`);
  if (result.affectedRows === 0) {
    return { "status": "error", "message": "登録に失敗しました" };
  }
  sendMail(request.mail, "仮登録完了", `以下のURLから本登録を完了してください\nhttps://tako.freshlive.tv/api/tako?requirements=register&token=${token}`);
  console.log(request)
  const response: takojson = {
    status: "success",
    requirements: "temp_register",
    mail: "",
    password: "",
    userName: "",
    "message": "仮登録が完了しました"
  }
  return response;
}
function login(request: takojson) {
return { "status": "success",request }
}
function register(request: object) {
return { "status": "success",request }
}