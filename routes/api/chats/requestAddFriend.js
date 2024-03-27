import { getCookies } from "https://deno.land/std@0.220.1/http/cookie.ts";
import sessionID from "../../../models/sessionid.js";
import csrfToken from "../../../models/csrftoken.js";
import Friends from "../../../models/friends.js";
import rooms from "../../../models/rooms.js";
import messages from "../../../models/messages.js";
const handler = {
    async post(req, _res) {
        const data = await req.json();
        const cookies = getCookies(req.headers);
        if (cookies.sessionid === undefined) {
            return new Response(JSON.stringify({ "status": "error" }), {
                headers: { "Content-Type": "application/json" },
                status: 403,
            });
        }
        // Check if the CSRF token is valid
        const iscsrfToken = await csrfToken.findOne({ token: data.csrftoken });
        if (iscsrfToken === null || iscsrfToken === undefined) {
            return new Response(JSON.stringify({ "status": "error" }), {
                headers: { "Content-Type": "application/json" },
                status: 403,
            });
        }
        if (iscsrfToken.sessionID !== cookies.sessionid) {
            return new Response(JSON.stringify({ "status": "error" }), {
                headers: { "Content-Type": "application/json" },
                status: 403,
            });
        }
        await csrfToken.deleteOne({ token: data.csrftoken });
        // Check if the session ID is valid
        const sessionidinfo = await sessionID.findOne({
            sessionID: cookies.sessionid,
        });
        if (sessionidinfo === null || sessionidinfo === undefined) {
            return new Response(JSON.stringify({ "status": "error" }), {
                headers: { "Content-Type": "application/json" },
                status: 403,
            });
        }
        // request add friend
        
    }
};
