import { FreshContext } from "$fresh/server.ts"
import users from "../../../../../../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
export const handler = {
    async GET(_req: Request,ctx: FreshContext) {
        const { ID } = ctx.params
        const user = await users.findOne({ uuid: ID })
        if (user === null) {
            return new Response(JSON.stringify({ "status": false }), {
                status: 400,
            })
        }
        return new Response(JSON.stringify({ "status": true, "userName": user.userName + "@" + env["serverDomain"] }), {
            status: 200,
        })
    }
}