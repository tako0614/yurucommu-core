import users from "../../../../../models/users.ts"
import friends from "../../../../../models/friends.ts"
import reqestAddFriend from "../../../../../models/reqestAddFriend.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
export const handler = {
    async GET(req, ctx) {
        const { ID } = ctx.params
        if (!ctx.state.data.loggedIn) {
            return new Response(JSON.stringify({ "status": "Please Login" }), {
                headers: { "Content-Type": "application/json" },
                status: 401,
            })
        }
        const url = new URL(req.url)
        const friendName = ID
        const isuseAddFriendKey = url.searchParams.get("isuseAddFriendKey") ||
            false
        const isRequestList = url.searchParams.get("isRequestList") || false
        if (isRequestList == "true") {
            const FriendInfo = await users.findOne({ userName: friendName })
            const AddfriendInfo = await reqestAddFriend.findOne({
                userID: ctx.state.data.userid,
            })
            if (FriendInfo == null || AddfriendInfo == null) {
                return
            }
            const result = AddfriendInfo.Applicant.find((element) => {
                return FriendInfo.uuid == element.userID
            })
            if (result == undefined) {
                return
            }
            try {
                const result = await Deno.readFile(
                    //"../../../../files/userIcons/" + user.uuid + ".webp"
                    "./files/userIcons/" + mailSpilit(FriendInfo.uuid) +
                        ".webp",
                )
                return new Response(result, {
                    headers: { "Content-Type": "image/webp" },
                    status: 200,
                })
            } catch (error) {
                console.log(error)
                return new Response("./people.png", {
                    headers: { "Content-Type": "application/json" },
                    status: 400,
                })
            }
        }
        if (isuseAddFriendKey == "true") {
            if (friendName == "") {
                return new Response(
                    JSON.stringify({ "status": "No userName" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }
            const addFriendKey = ID
            if (addFriendKey == "") {
                return new Response(
                    JSON.stringify({ "status": "No addFriendKey" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }
            const user = await users.findOne({ addFriendKey: addFriendKey })
            if (user == null) {
                return new Response(
                    JSON.stringify({ "status": "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }
            try {
                const result = await Deno.readFile(
                    //"../../../../files/userIcons/" + user.uuid + ".webp"
                    "./files/userIcons/" + mailSpilit(user.uuid) + ".webp",
                )
                return new Response(result, {
                    headers: { "Content-Type": "image/webp" },
                    status: 200,
                })
            } catch (error) {
                console.log(error)
                return new Response("./people.png", {
                    headers: { "Content-Type": "application/json" },
                    status: 400,
                })
            }
        }
        //フレンドのアイコンを取得
        //未実装
        if (friendName == "") {
            return new Response(JSON.stringify({ "status": "No userName" }), {
                headers: { "Content-Type": "application/json" },
                status: 400,
            })
        }
        const friendDomain = splitUserName(friendName).domain
        const friendUserName = splitUserName(friendName).name
        if (!friendDomain || !friendUserName) {
            return new Response(JSON.stringify({ "status": "No such user" }), {
                headers: { "Content-Type": "application/json" },
                status: 400,
            })
        }
        if (friendDomain === env["serverDomain"]) {
            const friend = await friends.findOne({
                user: ctx.state.data.userid,
            })
            if (friend == null) {
                return new Response(
                    JSON.stringify({ "status": "You are alone" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }
            const friendNameInfo = await users.findOne({ userName: friendName })
            if (friendNameInfo == null) {
                return new Response(
                    JSON.stringify({ "status": "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }
            //友達かどうかの確認
            const friendid = friendNameInfo.uuid
            const result = friend.friends.find((element) => {
                return friendid == element.userid
            })
            if (result == undefined) {
                return new Response(
                    JSON.stringify({ "status": "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }
            try {
                const result = await Deno.readFile(
                    "./files/userIcons/" + mailSpilit(friendid) + ".webp",
                )
                return new Response(result, {
                    headers: { "Content-Type": "image/webp" },
                    status: 200,
                })
            } catch (error) {
                console.log(error)
                return new Response("./people.png", {
                    headers: { "Content-Type": "application/json" },
                    status: 400,
                })
            }
        } else {
            const friend = await friends.findOne({
                user: ctx.state.data.userid,
            })
            if (friend == null) {
                return new Response(
                    JSON.stringify({ "status": "You are alone" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }
            const resUserUUID = await fetch(
                `http://${friendDomain}/api/v1/server/users/${friendName}/uuid`,
                {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            )
            if (resUserUUID.status !== 200) {
                return new Response(
                    JSON.stringify({ "status": "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }
            const userUUID = await resUserUUID.json()
            if(userUUID.status !== true) return new Response(
                JSON.stringify({ "status": "No such user" }),
                {
                    headers: { "Content-Type": "application/json" },
                    status: 400,
                },
            )
            const isFriend = friend.friends.find((element) => {
                return userUUID.uuid == element.userid
            })
            if (isFriend == undefined) {
                return new Response(
                    JSON.stringify({ "status": "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }
            //乱数を生成
            const takosTokenArray = new Uint8Array(16)
            const randomarray = crypto.getRandomValues(takosTokenArray)
            const takosToken = Array.from(
                randomarray,
                (byte) => byte.toString(16).padStart(2, "0"),
            ).join("")
            //リクエストを送信
            const iconRes = await fetch(
                `http://${friendDomain}/api/v1/server/friends/${friendUserName}/icon?token=${takosToken}&reqUser=${ctx.state.data.userid}`,
                {
                    method: "GET",
                    headers: {
                        "Content-Type": "application/json",
                    },
                },
            )
            if (iconRes.status !== 200) {
                return new Response(
                    JSON.stringify({ "status": "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }
            const icon = await iconRes.arrayBuffer()
            return new Response(icon, {
                headers: { "Content-Type": "image/webp" },
                status: 200,
            })
        }
    },
}
function splitUserName(name) {
    const parts = name.split("@")
    if (parts.length === 2) {
        return { name: parts[0], domain: parts[1] }
    } else {
        return null
    }
}
