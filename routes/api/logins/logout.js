import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import sessionID from "../../../models/sessionid.js";
export const handler = {
    async POST(req) {
        const data = await req.json();
        const cookies = getCookies(req.headers);
        if(cookies.sessionid === undefined) {
            return new Response(JSON.stringify({"status": "error"}), {
                headers: { "Content-Type": "application/json"},
                status: 403,
              });
        }
        if(data.reqirments !== "logout") {
            return new Response(JSON.stringify({"status": "error"}), {
                headers: { "Content-Type": "application/json"},
                status: 403,
              });
        }
        const sessionid = cookies.sessionid;
        const result = await sessionID.deleteOne({sessionID: sessionid});
        if(result.acknowledged) {
            return new Response(JSON.stringify({"status": true}), {
                headers: { "Content-Type": "application/json",status : 200, "Set-Cookie": `sessionid=; Path=/; Max-Age=0;`},
            });
        } else {
            return new Response(JSON.stringify({"status": false}), {
                headers: { "Content-Type": "application/json",status : 500, "Set-Cookie": `sessionid=; Path=/; Max-Age=0;`},
            });
        }

    }
}