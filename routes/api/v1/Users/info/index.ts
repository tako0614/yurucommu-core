import { getCookies } from "$std/http/cookie.ts"
import csrftoken from "../../../../../models/csrftoken.ts"
import Users from "../../../../../models/users.ts"
import sharp from "sharp"
export const handler = {
  async POST(req: Request, ctx: any) {
      if (!ctx.state.data.loggedIn) {
        return new Response(JSON.stringify({ "status": "Please Login" }), {
          headers: { "Content-Type": "application/json" },
          status: 401,
        })
      }
      const cookies = getCookies(req.headers)
      const data = await req.json()
      if (typeof data.csrftoken !== "string") {
        return { status: false }
      }
      const iscsrfToken = await csrftoken.findOne({ token: data.csrftoken })
      if (iscsrfToken === null || iscsrfToken === undefined) {
        console.log("csrftoken error")
        return new Response(
          JSON.stringify({ "status": "csrftoken error" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          },
        )
      }
      if (iscsrfToken.sessionID !== cookies.sessionid) {
        return { status: false }
      }
      await csrftoken.deleteOne({ token: data.csrftoken })
      const userid = ctx.state.data.userid.toString()
        const icon = data.icon
        const nickName = data.nickName
        const updateItem = data.updateItem
        console.log(data)
        if(updateItem.icon){
            console.log(updateItem.icon)
            const result = await processImage(icon)
            if (result === null) {
              return new Response(
                JSON.stringify({ "status": "error" }),
                {
                  headers: { "Content-Type": "application/json" },
                  status: 403,
                },
              )
            }
            await Deno.writeFile(
              `./files/userIcons/${ctx.state.data.userid.toString}.webp`,
              result,
            )
        }
        if(updateItem.nickName){
          await Users.updateOne({ _id: userid }, { $set: { nickName: nickName } })
        }
        return new Response(JSON.stringify({ status: true }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
        })
  },
}
async function processImage(
    inputBuffer: Uint8Array,
  ): Promise<Uint8Array | null> {
    try {
      const image = sharp(inputBuffer)
      const metadata = await image.metadata()
      if (
        metadata.format &&
        ["jpeg", "png", "gif", "webp", "tiff", "avif", "heif", "jpg"].includes(
          metadata.format,
        )
      ) {
        // 画像ファイルであると判断
        const outputBuffer = await image.resize(512, 512).toFormat("webp")
          .toBuffer()
        return outputBuffer
      } else {
        console.log(`The provided data is not a recognized image format.`)
        return null
      }
    } catch (error) {
      console.error(`Failed to process the image: ${error.message}`)
      return null
    }
  }