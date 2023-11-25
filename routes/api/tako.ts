import { Handlers, PageProps } from "$fresh/server.ts";
import database from "../../util/database.ts";
import { testMail } from "../../util/denomail.ts";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
export const handler: Handlers<Data> = {
  async POST(req, ctx) {
    try {
		    const request = (await req.json());
        console.log(request);
        let result;
        switch (request) {
          case request.requirements == "temp_register":
            return temp_register(request);
            break;
          case request.requirements == "login":
            result = login(request);
            if(result.status === true) {
              return new Response({status: true, message: "success" , uuid: result.uuid});
            }
            break;
          default:
            return new Response({status: false, message: "json is invalid"});
            break;
        }
        //return new Response(JSON.stringify(user));
	} catch (error) {
		return new Response({status: false, message: "server error"});
	}
  },
};
//リクエスト処理
//処理
//登録
async function temp_register(request) {
  const req_username = request.username;
  const req_email = request.email;
  if(isValueDefined(req_username) == false || isValueDefined(req_email) == false) {
    return {
      status: false,
      message: "value is undefined"
    }
  }
  if(isEmail(req_email) == false) {
    return {
      status: false,
      message: "email is invalid"
    }
  }
  if(isDuplicationUsername(req_username) == true) {
    return {
      status: false,
      message: "username is duplication"
    }
  }
  if(isDuplicationEmail(req_email) == true) {
    return {
      status: false,
      message: "email is duplication"
    }
  }
  const result = await database.insert("temp_users", ["username", "email", "password","key"], [username, email, hashedPassword, salt, uuid]);
  console.log(result);
  const status = result.affectedRows === 1;
  if(status === true) {
    testMail(req_mail,"メールアドレス認証",`こちらのリンクをクリックして認証してくださいhttps://takos.jp/api/register?userName=${req_username}&key=${uuid}`)
  return {
    status: true,
    message: "success"
  }
}
}
async function register(request) {

}
//AIで生成修正必要　！開始!
async function login(request) {
  const req_username = request.username;
  const req_password = request.password;
  if(isValueDefined(req_username) == false || isValueDefined(req_password) == false) {
    return {
      status: false,
      message: "value is undefined"
    }
  }
  const query = `SELECT COUNT(*) FROM customer WHERE customer_id = ${req_username}`;
  const result = await database.execute(query);
  const user = result[0];
  if(user == undefined) {
    return {
      status: false,
      message: "username is not found"
    }
  }
  const salt = user.salt;
  const password: string = request.password;
  const saltedPassword = password + salt;
  const hashedPassword = crypto.createHash('sha256').update(saltedPassword).digest('hex');
  const uuid = crypto.randomUUID();
  if(hashedPassword !== user.password) {
    return {
      status: false,
      message: "password is not match"
    }
  }
  return {
    status: true,
    uuid,
    message: "success"
  }
}
//AIで生成修正必要　！終了!

//関数
function isEmail(email: string) {
  if(email.match(/.+@.+\..+/) == null) {
    return false;
  }
}
function isValueDefined(value: any): boolean {
  return value !== undefined && value !== null;
}
async function isDuplicationUsername(username: string) {
  const query = `SELECT COUNT(*) as count FROM users WHERE username = ?`;
  const result = await database.execute(query, [username]);
  const count = result[0].count;
  return count > 0;
}
async function isDuplicationEmail(email: string) {
  const query = `SELECT COUNT(*) as count FROM users WHERE email = ?`;
  const result = await database.execute(query, [username]);
  const count = result[0].count;
  return count > 0;
}