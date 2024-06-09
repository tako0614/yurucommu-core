import { getCookies } from "$std/http/cookie.ts"
import csrftoken from "../../../../models/csrftoken.ts"
import Users from "../../../../models/users.ts"
export const handler = {
    async POST(req: Request, ctx: any) {
        try {
            if (!ctx.state.data.loggedIn) {
                return new Response(
                    JSON.stringify({ "status": "Please Login" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 401,
                    },
                )
            }
            const cookies = getCookies(req.headers)
            const data = await req.formData()
            const icon = data.get("icon")
            const nickName = data.get("nickName")
            const token = data.get("csrftoken")

            if (typeof token !== "string") {
                return new Response(
                    JSON.stringify({ status: "csrftoken error" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }

            const iscsrfToken = await csrftoken.findOne({ token: token })
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
                console.log("sessionid error")
                return new Response(
                    JSON.stringify({ "status": "sessionid error" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }

            await csrftoken.deleteOne({ token: token })

            if (icon == null && nickName == null) {
                return new Response(JSON.stringify({ status: false }), {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                })
            }
            const userid = ctx.state.data.userid
            if (nickName) {
                await Users.updateOne({ uuid: userid }, {
                    $set: { nickName: nickName },
                })
            }
            if (icon !== null) {
                return
                /*
        const result = await resizeImageToWebP(icon, 512, 512)
        if (result === null) {
          return new Response(JSON.stringify({ status: false }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          })
        }
        await Deno.writeFile(`./files/userIcons/${userid}.webp`, result)
        */
            }

            return new Response(JSON.stringify({ status: true }), {
                headers: { "Content-Type": "application/json" },
                status: 200,
            })
        } catch (error) {
            console.log(error)
        }
    },
}
/*
async function resizeImageToWebP(
  imageData: Uint8Array,
): Promise<Uint8Array> {
  // 画像をデコード
  const image = await decode(imageData)

  // 画像をリサイズ
  const resizedImage = image.resize(512, 512)

  // WebP形式でエンコード
  //const webpImageData = await image.encode
}
*/
