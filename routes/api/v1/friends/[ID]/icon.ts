import users from "../../../../../models/users.ts"
import friends from "../../../../../models/friends.ts"
import reqestAddFriend from "../../../../../models/reqestAddFriend.ts"
import pubClient from "../../../../../util/redisClient.ts"
import { load } from "$std/dotenv/mod.ts"
import { takosfetch } from "../../../../../util/takosfetch.ts"
const env = await load()

interface User {
    uuid: string
    userName: string
    addFriendKey?: string
}

interface Friend {
    user: string
    friends: { userid: string }[]
}

interface RequestAddFriend {
    Applicant: { userID: string }[]
}

interface Context {
    params: { ID: string }
    state: { data: { loggedIn: boolean; userid: string } }
}
const PRIORITY_PROTOCOL = env["PRIORITY_PROTOCOL"]
export const handler = {
    async GET(req: Request, ctx: Context): Promise<Response> {
        const { ID } = ctx.params
        if (!ctx.state.data.loggedIn) {
            return new Response(JSON.stringify({ status: "Please Login" }), {
                headers: { "Content-Type": "application/json" },
                status: 401,
            })
        }

        const url = new URL(req.url)
        const friendName = ID
        const isuseAddFriendKey = url.searchParams.get("isuseAddFriendKey") ||
            false
        const isRequestList = url.searchParams.get("isRequestList") || false

        if (isRequestList === "true") {
            const FriendInfo: User | null = await users.findOne({
                userName: friendName,
            })
            const AddfriendInfo: RequestAddFriend | null = await reqestAddFriend
                .findOne({
                    userID: ctx.state.data.userid,
                })

            if (FriendInfo == null || AddfriendInfo == null) {
                return new Response(null, {
                    status: 400,
                })
            }

            const result = AddfriendInfo.Applicant.find((element) => {
                return FriendInfo.uuid === element.userID
            })

            if (result === undefined) {
                return new Response(null, {
                    status: 400,
                })
            }

            try {
                const filePath = `./files/userIcons/${
                    mailSpilit(FriendInfo.uuid)
                }.webp`
                const result = await Deno.readFile(filePath)
                return new Response(result, {
                    headers: { "Content-Type": "image/webp" },
                    status: 200,
                })
            } catch (error) {
                console.error(error)
                return new Response("./people.png", {
                    headers: { "Content-Type": "image/webp" },
                    status: 400,
                })
            }
        }

        if (isuseAddFriendKey === "true") {
            if (!friendName) {
                return new Response(JSON.stringify({ status: "No userName" }), {
                    headers: { "Content-Type": "application/json" },
                    status: 400,
                })
            }

            const addFriendKey = ID
            if (!addFriendKey) {
                return new Response(
                    JSON.stringify({ status: "No addFriendKey" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }

            const user: User | null = await users.findOne({
                addFriendKey: addFriendKey,
            })
            if (user == null) {
                return new Response(
                    JSON.stringify({ status: "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }

            try {
                const filePath = `./files/userIcons/${
                    mailSpilit(user.uuid)
                }.webp`
                const result = await Deno.readFile(filePath)
                return new Response(result, {
                    headers: { "Content-Type": "image/webp" },
                    status: 200,
                })
            } catch (error) {
                console.error(error)
                return new Response("./people.png", {
                    headers: { "Content-Type": "image/webp" },
                    status: 400,
                })
            }
        }

        if (!friendName) {
            return new Response(JSON.stringify({ status: "No userName" }), {
                headers: { "Content-Type": "application/json" },
                status: 400,
            })
        }

        const { domain: friendDomain, name: friendUserName } =
            splitUserName(friendName) || {}
        if (!friendDomain || !friendUserName) {
            return new Response(JSON.stringify({ status: "No such user" }), {
                headers: { "Content-Type": "application/json" },
                status: 400,
            })
        }

        if (friendDomain === env["SERVER_DOMAIN"]) {
            const friend: Friend | null = await friends.findOne({
                user: ctx.state.data.userid,
            })
            if (friend == null) {
                return new Response(
                    JSON.stringify({ status: "You are alone" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 200,
                    },
                )
            }

            const friendNameInfo: User | null = await users.findOne({
                userName: friendUserName,
            })
            if (friendNameInfo == null) {
                console.error("No such user")
                return new Response(
                    JSON.stringify({ status: "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }

            const friendid = friendNameInfo.uuid
            const isFriend = friend.friends.find((element) => {
                return friendid === element.userid
            })

            if (isFriend === undefined) {
                return new Response(
                    JSON.stringify({ status: "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }

            try {
                const filePath = `./files/userIcons/${
                    splitUserName(friendid)?.name
                }.webp`
                const result = await Deno.readFile(filePath)
                return new Response(result, {
                    headers: { "Content-Type": "image/webp" },
                    status: 200,
                })
            } catch (error) {
                console.error(error)
                return new Response("./people.png", {
                    headers: { "Content-Type": "image/webp" },
                    status: 400,
                })
            }
        } else {
            const friend: Friend | null = await friends.findOne({
                user: ctx.state.data.userid,
            })
            if (friend == null) {
                return new Response(
                    JSON.stringify({ status: "You are alone" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }

            const resUserUUID = await takosfetch(
                `${friendDomain}/api/v1/server/users/${friendName}/uuid`,
                {
                    method: "GET",
                    headers: { "Content-Type": "application/json" },
                },
            )
            if (resUserUUID === null) {
                return new Response(null, {
                    status: 400,
                })
            }
            if (resUserUUID.status !== 200) {
                return new Response(
                    JSON.stringify({ status: "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }

            const userUUID = await resUserUUID.json()
            if (userUUID.status !== true) {
                return new Response(
                    JSON.stringify({ status: "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }

            const isFriend = friend.friends.find((element) => {
                return userUUID.uuid === element.userid
            })

            if (isFriend === undefined) {
                return new Response(
                    JSON.stringify({ status: "No such user" }),
                    {
                        headers: { "Content-Type": "application/json" },
                        status: 400,
                    },
                )
            }

            const takosTokenArray = new Uint8Array(16)
            const randomarray = crypto.getRandomValues(takosTokenArray)
            const takosToken = Array.from(
                randomarray,
                (byte) => byte.toString(16).padStart(2, "0"),
            ).join("")

            const iconRes = await fetchWithSizeLimit(
                `${friendDomain}/api/v1/server/friends/${ID}/icon?token=${takosToken}&reqUser=${ctx.state.data.userid}`,
                1024 * 1024 * 10,
            )

            if (iconRes.status !== 200) {
                return new Response(
                    JSON.stringify({ status: "No such user" }),
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

function splitUserName(name: string): { name: string; domain: string } | null {
    const parts = name.split("@")
    if (parts.length === 2) {
        return { name: parts[0], domain: parts[1] }
    } else {
        return null
    }
}

async function fetchWithSizeLimit(
    input: RequestInfo,
    limit: number,
): Promise<Response> {
    let res
    try {
        if (PRIORITY_PROTOCOL === "http") {
            res = await fetch("http://" + input)
        } else if (PRIORITY_PROTOCOL === "https") {
            res = await fetch("https://" + input)
        }
    } catch (_error) {
        try {
            if (PRIORITY_PROTOCOL === "http") {
                res = await fetch("https://" + input)
            } else if (PRIORITY_PROTOCOL === "https") {
                res = await fetch("http://" + input)
            }
        } catch (error) {
            return new Response(null, {
                status: 400,
            })
        }
    }
    if (res === undefined) {
        return new Response(null, {
            status: 400,
        })
    }
    const reader = res.body!.getReader()
    let total = 0
    const chunks: Uint8Array[] = []

    while (true) {
        const { done, value } = await reader.read()
        if (done) {
            break
        }

        total += value.length
        chunks.push(value)

        if (total > limit) {
            reader.cancel()
            return new Response(null, {
                status: 413,
                statusText: "Payload Too Large",
            })
        }
    }

    const combined = new Uint8Array(total)
    let position = 0
    for (let chunk of chunks) {
        combined.set(chunk, position)
        position += chunk.length
    }

    return new Response(combined, {
        status: res.status,
        statusText: res.statusText,
    })
}

function mailSpilit(uuid: string): string {
    // Implement this function based on your logic
    return uuid
}
