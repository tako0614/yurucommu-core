import users from "../../../models/users.js";
import sessionID from "../../../models/sessionid.js";
export const handler = {
  async POST(req) {
    const data = await req.json();
    const { userName, password } = data;
    if(userName == undefined || password == undefined) {
      return new Response(JSON.stringify({"status": " 全て入力してください"}), {
        headers: { "Content-Type": "application/json",status : 403},
      });
    }
    const user = await users.findOne({ userName: userName });
    if(user == null) {
      return new Response(JSON.stringify({"status": " 登録されていません"}), {
        headers: { "Content-Type": "application/json",status : 403},
      });
    }
    const salt = user.salt;
    const hash = user.password;
    const saltPassword = password + salt;
    const reqHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(saltPassword));
    const hashArray = new Uint8Array(reqHash);
    const hashHex = Array.from(hashArray, byte => byte.toString(16).padStart(2, '0')).join('');
    if(hash !== hashHex) {
      return new Response(JSON.stringify({"status": "error"}), {
        headers: { "Content-Type": "application/json",status : 403},
      });
    }
    const toDay = new Date();
    const tll = toDay.setMonth(toDay.getMonth() + 1);
    const sessionIDarray = new Uint8Array(64);
    const randomarray = crypto.getRandomValues(sessionIDarray);
    const sessionid = Array.from(randomarray, byte => byte.toString(16).padStart(2, '0')).join('');
    const result = await sessionID.create({userName, sessionID: sessionid, tll});
    if(result !== null) {
      return new Response(JSON.stringify({"status": true}), {
        headers: { "Content-Type": "application/json",status : 200, "Set-Cookie": `sessionid=${sessionid}; Path=/; Max-Age=2592000;`},
      });
    }
  }
}