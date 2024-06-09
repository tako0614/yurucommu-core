import { load } from "$std/dotenv/mod.ts";
import remoteservers from "../../../../../../models/remoteservers.ts";
const env = await load();
export const handler = {
    async GET(req: Request, ctx: any) {
        const { ID } = ctx.params
        const requrl = new URL(req.url)
        const token = requrl.searchParams.get("token") || false
        const reqUser = requrl.searchParams.get("reqUser") || false
        if (ID === undefined || token === false || reqUser === false) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        const userServerDomain = splitUserName(reqUser).domain
        const userName = splitUserName(reqUser).userName
        if(!userServerDomain || !userName) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        if(userServerDomain !== env["serverDomain"]) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        const serverInfo = await remoteservers.findOne({ serverDomain: userServerDomain })
    },
}
function splitUserName(userName: string) {
    const result = {
        userName: userName.split("@")[0],
        domain: userName.split("@")[1],
    }
    return result
}
