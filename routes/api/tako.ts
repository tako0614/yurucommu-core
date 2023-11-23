import { Handlers, PageProps } from "$fresh/server.ts";
import database from "../../util/database.ts";
//登録
function isEmail(email: string) {
  if(email.match(/.+@.+\..+/) == null) {
    return false;
  }
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
  if(isDuplicationUsername(username) == true && isDuplicationEmail(email) == true) {
    const uuid = crypto.randomUUID();
    const isDuplicationUsername = await database.execute("")
    return {
      status,

    }
  }
}
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