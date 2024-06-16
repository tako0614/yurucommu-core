import { MiddlewareHandlerContext } from "$fresh/server.ts"
import { getCookies } from "$std/http/cookie.ts"
import csrfToken from "../models/csrftoken.ts"
import users from "../models/users.ts"
import sessionID from "../models/sessionid.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()

export async function handler(req: Request, ctx: MiddlewareHandlerContext) {
    const cookies = getCookies(req.headers)
    const sessionid = cookies.sessionid
    ctx.state.settings = {
        maxMessageLength: env["MAX_MESSAGE_LENGTH"],
    }
    if (sessionid === undefined) {
        ctx.state.data = { loggedIn: false }
        const resp = await ctx.next()
        return resp
    }
    const sessions = await sessionID.findOne({ sessionID: sessionid })
    if (sessions === null) {
        ctx.state.data = { loggedIn: false }
        const resp = await ctx.next()
        return resp
    }
    const today = new Date()
    const sessionCreatedat = sessions.createdAt
    const sessionExpiryDate = new Date(sessionCreatedat.getTime())
    sessionExpiryDate.setMonth(sessionExpiryDate.getMonth() + 3)
    if (today < sessionExpiryDate) {
        // セッションIDが作成されてから3ヶ月未満の場合に行う処理
        const result = await sessionID.updateOne({ sessionID: sessionid }, {
            $set: { lastLogin: today },
        })
        if (result === null) {
            ctx.state.data = { loggedIn: false }
            const resp = await ctx.next()
            return resp
        }
    }
    const userid = sessions.userid
    const user = await users.findOne({ uuid: userid })
    if (user === null) {
        ctx.state.data = { loggedIn: false }
        const resp = await ctx.next()
        return resp
    }
    const mail = user.mail
    ctx.state.data = {
        userid,
        mail,
        loggedIn: true,
        sessionid,
        userNickName: user.nickName,
        userName: user.userName,
    }
    const resp = await ctx.next()
    return resp
}
