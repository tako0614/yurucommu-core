import users from "../../../models/users.js";
export const handler = {
  async POST(req) {
    const data = await req.json();
    const { userName, password } = data;
    if(userName == undefined || password == undefined) {
      return new Response(JSON.stringify({"status": "ぜんぶいれろ"}), {
        headers: { "Content-Type": "application/json",status : 403},
      });
    }
    const user = await users.findOne({ userName: userName });
    if(user == null) {
      return new Response(JSON.stringify({"status": "おまえおらん"}), {
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
    const sessionIDHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(saltPassword));
    const sessionIDArray = new Uint8Array(sessionIDHash);
    const sessionID = Array.from(sessionIDArray, byte => byte.toString(16).padStart(2, '0')).join('');
    await users.findOneAndUpdate({ userName: userName }, {$set :{ sessionID: sessionID }});
    return new Response(JSON.stringify({"status": true}), {
      headers: { "Content-Type": "application/json",status : 200, "Set-Cookie": `sessionid=${sessionID};`},
    });
  }
}