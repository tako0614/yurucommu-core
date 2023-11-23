import { Handlers, PageProps } from "$fresh/server.ts";
import database from "../../util/database.ts";
//登録
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
async function register(request) {
  const username = request.username;
  const email = request.email;
  const password = request.password;
  const passwordConfirm = request.passwordConfirm;
  if(isValueDefined(username) == false || isValueDefined(email) == false || isValueDefined(password) == false || isValueDefined(passwordConfirm) == false) {
    return {
      status: false,
      message: "value is undefined"
    }
  }
  if(isEmail(email) == false) {
    return {
      status: false,
      message: "email is invalid"
    }
  }
  if(password !== passwordConfirm) {
    return {
      status: false,
      message: "password is not match"
    }
  }
  if(isDuplicationUsername(username) == true) {
    return {
      status: false,
      message: "username is duplication"
    }
  }
  if(isDuplicationEmail(email) == true) {
    return {
      status: false,
      message: "email is duplication"
    }
  }
  const uuid = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const password: string = request.password;
  const saltedPassword = password + salt;
  const hashedPassword = crypto.createHash('sha256').update(saltedPassword).digest('hex');
  const result = await database.insert("users", ["username", "email", "password", "salt", "uuid"], [username, email, hashedPassword, salt, uuid]);
  const status = result.affectedRows === 1;
  return {
    status,
    uuid,
    message: status ? "success" : "server error"
  }
}
//AIで生成修正必要　！開始!
function login(request) {
  const req_username = request.username;
  const req_password = request.password;
  if(isValueDefined(req_username) == false || isValueDefined(req_password) == false) {
    return {
      status: false,
      message: "value is undefined"
    }
  }
  const query = `SELECT * FROM users WHERE username = ?`;
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
export const handler: Handlers<Data> = {
  async POST(req, ctx) {
    try {
		    const request = (await req.json());
        let result;
        switch (request) {
          case request.requirements == "register":
            return register(request);
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