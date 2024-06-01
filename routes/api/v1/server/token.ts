import takostoken from "../../../../models/takostoken.ts"
export const handler = {
  async GET(req: Request, ctx: any) {
    const requrl = new URL(req.url)
    const token = requrl.searchParams.get("token") || ""
    if (token === "" || token === null || token === undefined) {
      return new Response(JSON.stringify({ "status": false }), { status: 400 })
    }
    const tokenInfo = await takostoken.findOne({ token })
    if (tokenInfo === null || tokenInfo === undefined) {
      return new Response(JSON.stringify({ "status": false }), { status: 400 })
    }
    await takostoken.deleteOne({ token })
    return new Response(JSON.stringify({ "status": true }), { status: 200 })
  },
}
