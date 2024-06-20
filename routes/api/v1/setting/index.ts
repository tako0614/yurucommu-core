import * as imagescript from "https://deno.land/x/imagescript@1.3.0/mod.ts"
import Users from "../../../../models/users.ts"
import csrfToken from "../../../../models/csrftoken.ts"
//this api is for setting user icon
export const handler = {
    async POST(req: Request, ctx: any) {
        const data = await req.formData()
        const icon = data.get("icon") as File
        const requirement = data.get("requirement") as string
        const nickName = data.get("nickName") as string
        const csrftoken = data.get("csrftoken") as string
        if (!requirement) {
            return new Response(JSON.stringify({ status: false }), {
                headers: { "Content-Type": "application/json" },
                status: 400,
            })
        }
        const requirement2 = () => {
            const requirementjson = JSON.parse(requirement)
            let result: {
                status: boolean
                nickName: string | null
                icon: File | null
            } = {
                status: false,
                nickName: null,
                icon: null,
            }
            if (!requirementjson || !requirementjson.icon) {
                return result
            }
            if (requirementjson.nickName) {
                //nickNameが日本語英語数字で10文字以内か確認
                const isNickNameValid =
                    /^[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Latin}\d]{1,10}$/u
                        .test(nickName)
                if (!isNickNameValid) {
                    return result
                }
                result = {
                    status: true,
                    nickName: nickName,
                    icon: null,
                }
            }
            if (requirementjson.icon) {
                //iconが画像ファイルか確認
                if (icon === null) {
                    return result
                }
                result = {
                    status: true,
                    nickName: result.nickName,
                    icon: icon,
                }
            }
            return result
        }
        const result = requirement2()
        if (!result.status) {
            return new Response(JSON.stringify({ status: false }), {
                headers: { "Content-Type": "application/json" },
                status: 400,
            })
        }
        //check csrf token
        const isTrueToken = await csrfToken.findOne({
            token: csrftoken,
            sessionID: ctx.state.data.sessionid,
        })
        if (!isTrueToken) {
            return new Response(JSON.stringify({ status: false }), {
                headers: { "Content-Type": "application/json" },
                status: 400,
            })
        }
        if (result.icon) {
            //decode image
            if (icon === null) {
                return new Response(JSON.stringify({ status: false }), {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                })
            }
            //画像がサポートされている形式か確認
            if (!icon.type.includes("image")) {
                return new Response(JSON.stringify({ status: false }), {
                    headers: { "Content-Type": "application/json" },
                    status: 400,
                })
            }
            //画像のサイズが大きすぎるか確認
            if (icon.size > 1048576) {
                return new Response(JSON.stringify({ status: false }), {
                    headers: { "Content-Type": "application/json" },
                    status: 400,
                })
            }
            const image = await imagescript.Image.decode(
                await icon.arrayBuffer(),
            )
            //resize image
            const resized = image.resize(512, 512)
            //encode image to jpeg
            const encoded = await resized.encodeJPEG(100) // 100 is the quality of the JPEG image
            //save image
            const user = await Users.findOne({ uuid: ctx.state.data.userid })
            if (!user) {
                return new Response(JSON.stringify({ status: false }), {
                    headers: { "Content-Type": "application/json" },
                    status: 400,
                })
            }
            await Deno.writeFile(
                "./files/userIcons/" + usersplitUserName(user.uuid).userName +
                    ".jpeg",
                encoded,
            )
        }
        if (result.nickName) {
            const user = await Users.findOne({ uuid: ctx.state.data.userid })
            if (!user) {
                return new Response(JSON.stringify({ status: false }), {
                    headers: { "Content-Type": "application/json" },
                    status: 400,
                })
            }
            await Users.updateOne(
                { uuid: ctx.state.data.userid },
                { $set: { nickName: result.nickName } },
            )
        }
        return new Response(JSON.stringify({ status: true }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
        })
    },
}
function usersplitUserName(userName: string) {
    const result = {
        userName: userName.split("@")[0],
        domain: userName.split("@")[1],
    }
    return result
}
