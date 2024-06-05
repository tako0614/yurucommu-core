import csrfToken from "../../../models/csrftoken.ts"
import { envRoader } from "../../../util/takoFunction.ts"
import { crypto } from "$std/crypto/crypto.ts"
import { getCookies } from "$std/http/cookie.ts"
import sessionID from "../../../models/sessionid.ts"
export const handler = {
  async GET(req: Request) {
    const cookies = getCookies(req.headers)
    if (cookies.sessionid === undefined) {
      return new Response(
        JSON.stringify({ "csrftoken": "No sessionid" }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      )
    }
    const sessionid = cookies.sessionid
    const result = await sessionID.findOne({ sessionID: sessionid })
    if (result === null || result === undefined) {
      return new Response(
        JSON.stringify({ "csrftoken": "Invalid sessionid" }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      )
    }
    const url = new URL(req.url)
    const origin = url.searchParams.get("origin") || ""
    const allows = envRoader("origin")
    const allow = allows.split(",")
    if (allow.includes(origin)) {
      const array = new Uint8Array(64)
      crypto.getRandomValues(array)
      const csrftoken = Array.from(
        array,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
      await csrfToken.create({ token: csrftoken, sessionID: sessionid })
      return new Response(JSON.stringify({ "csrftoken": csrftoken }), {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": origin,
        },
      })
    } else {
      return new Response(
        JSON.stringify({ "csrftoken": "This origin is not allowed" }),
        {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": origin,
          },
        },
      )
    }
  },
}
