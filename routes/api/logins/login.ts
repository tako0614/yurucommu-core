import users from "../../../models/users.ts"
import sessionID from "../../../models/sessionid.ts"
import { crypto } from "https://deno.land/std@0.220.1/crypto/mod.ts"

export const handler = {
  async POST(req: Request): Promise<any> {
    try {
      const data = await req.json()
      const { userName, password } = data
      if (userName == undefined || password == undefined) {
        return new Response(
          JSON.stringify({ "status": false, error: "input" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      const user = await users.findOne({ userName: userName }, {
        password: 1,
        salt: 1,
      })
      if (user == null) {
        return new Response(
          JSON.stringify({ "status": false, error: "userNotFound" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      const salt = user.salt
      const hash = user.password
      const saltPassword = password + salt
      const reqHash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(saltPassword),
      )
      const hashArray = new Uint8Array(reqHash)
      const hashHex = Array.from(
        hashArray,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
      if (hash !== hashHex) {
        return new Response(
          JSON.stringify({ "status": false, error: "password" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      const toDay = new Date()
      const sessionIDarray = new Uint8Array(64)
      const randomarray = crypto.getRandomValues(sessionIDarray)
      const sessionid = Array.from(
        randomarray,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
      const result = await sessionID.create({
        user: user._id,
        sessionID: sessionid,
      })
      if (result !== null) {
        return new Response(JSON.stringify({ "status": true }), {
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": `sessionid=${sessionid}; Path=/; Max-Age=2592000;`,
          },
          status: 200,
        })
      }
    } catch (error) {
      console.error(error)
      return new Response(
        JSON.stringify({ "status": false, error: "server error" }),
        {
          headers: { "Content-Type": "application/json" },
          status: 500,
        },
      )
    }
  },
}
