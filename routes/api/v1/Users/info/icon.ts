import { getCookies } from "$std/http/cookie.ts"
import csrftoken from "../../../../../models/csrftoken.ts"
export const handler = {
  async GET(req: Request, ctx: any) {
    try {
      if (!ctx.state.data.loggedIn) {
        return new Response(JSON.stringify({ "status": "Please Login" }), {
          headers: { "Content-Type": "application/json" },
          status: 401,
        })
      }
      const userid = ctx.state.data.userid.toString()
      const result = await Deno.readFile(`./files/userIcons/${userid}.webp`)
      return new Response(result, {
        headers: { "Content-Type": "image/webp" },
        status: 200,
      })
    } catch (error) {
      console.log(error)
    }
  },
}
