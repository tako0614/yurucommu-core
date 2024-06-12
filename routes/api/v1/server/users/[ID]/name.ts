import { FreshContext } from "$fresh/server.ts"
import users from "../../../../../../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
export const handler = {
    async GET(_req: Request,ctx: FreshContext) {
        const { ID } = ctx.params
        if(ID === undefined) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        if (splitUserName(ID).domain !== env["serverDomain"]) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        const user = await users.findOne({ userName: splitUserName(ID).userName })
        if (user === null) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        return new Response(JSON.stringify({ "status": true, "uuid": user.uuid }), {
            status: 200,
        })
    }
}
function splitUserName(userName: string) {
    const split = userName.split("@")
    if(split.length !== 2) return {
        userName: "",
        domain: "",
    }
    return {
        userName: split[0],
        domain: split[1],
    }
}
