import users from "../../../../../models/users.ts"
import requestAddFriend from "../../../../../models/reqestAddFriend.ts"
import friends from "../../../../../models/friends.ts"
import rooms from "../../../../../models/rooms.ts"
import remoteservers from "../../../../../models/remoteServers.ts"
import { crypto } from "$std/crypto/crypto.ts"
import { takosfetch } from "../../../../../util/takosfetch.ts"
/*
リクエスト元のユーザー名：requesterUsername
リクエスト先のユーザー名：recipientUsername
*/
import { load } from "$std/dotenv/mod.ts"
import User from "../../../../../components/Chats/ChatUserList.jsx"
const env = await load()
export const handler = {
    async POST(req: Request, ctx: any) {
        const data = await req.json()
        const { requirement, token } = data
        if (requirement === "reqFriend") {
            const { requesterUserUUID, recipientUserName, requesterUserName } =
                data
            if (
                requesterUserUUID === undefined ||
                recipientUserName === undefined ||
                requesterUserName === undefined
            ) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            if (
                !isUserID(recipientUserName) || !isUserID(requesterUserName) ||
                !isUserID(requesterUserUUID)
            ) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            const friendDomain = splitUserName(recipientUserName).domain
            const userDomain = splitUserName(requesterUserName).domain
            if (
                userDomain == env["serverDomain"] || friendDomain == userDomain
            ) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            const isTrueToken = await takosfetch(
                `${userDomain}/api/v1/server/token?token=` + token,
            )
            if(!isTrueToken) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            const isTrueTokenJson = await isTrueToken.json()
            if (isTrueTokenJson.status !== true) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            const isAlreadyCreateRemoteServerTable = await remoteservers
                .findOne({
                    serverDomain: userDomain,
                })
            if (isAlreadyCreateRemoteServerTable === null) {
                await remoteservers.create({
                    serverDomain: userDomain,
                    friends: [
                        {
                            userid: requesterUserUUID,
                            userName: splitUserName(requesterUserName).userName,
                            timestamp: Date.now(),
                        },
                    ],
                })
            } else {
                const isAlreadyRegisterServer = isAlreadyCreateRemoteServerTable
                    .friends
                    .find(
                        (obj) => {
                            return obj.userid === requesterUserUUID
                        },
                    )
                if (isAlreadyRegisterServer !== undefined) {
                    //
                } else {
                    await remoteservers.updateOne(
                        { serverDomain: userDomain },
                        {
                            $push: {
                                friends: {
                                    userid: requesterUserUUID,
                                    timestamp: Date.now(),
                                },
                            },
                        },
                    )
                }
            }
            const friendInfo = await users.findOne({
                userName: splitUserName(recipientUserName).userName,
            })
            if (friendInfo === null) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            //すでに友達か
            const userFriends = await friends.findOne({
                userid: requesterUserUUID,
            })
            if (userFriends !== null) {
                const isFriend = userFriends.friends.find((obj) =>
                    obj.userid === friendInfo.uuid
                )
                if (isFriend !== undefined) {
                    return new Response(JSON.stringify({ status: false, message: "Already friends" }), {
                        status: 400,
                    })
                }
            }
            //すでにリクエストを送っているか
            const userFriendInfo = await requestAddFriend.findOne({
                userID: requesterUserUUID,
            })
            if (userFriendInfo !== null) {
                const isFriend = userFriendInfo.Applicant.find((obj) =>
                    obj.userID === friendInfo.uuid
                )
                if (isFriend !== undefined) {
                    return new Response(JSON.stringify({ status: false }), {
                        status: 400,
                    })
                }
            }
            //申請先のリクエストリストに追加
            const friendRequestInfo = await requestAddFriend.findOne({
                userID: friendInfo.uuid,
            })
            if (friendRequestInfo === null) {
                await requestAddFriend.create({
                    userID: friendInfo.uuid,
                })
            }
            const result = await requestAddFriend.updateOne(
                { userID: friendInfo.uuid },
                {
                    $push: {
                        Applicant: {
                            userID: requesterUserUUID,
                            type: "other",
                            timestamp: Date.now(),
                            host: userDomain,
                            userName: splitUserName(requesterUserName).userName,
                        },
                    },
                },
            )
            if (result === null) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            return new Response(JSON.stringify({ status: true }), {
                status: 200,
            })
        } else if (requirement === "acceptReqFriend") {
            /*
        リクエスト元のユーザー名：requesterUserUUID
        リクエスト先のユーザー名：recipientUsername
        */
            const { requesterUserUUID, recipientUserName, requesterUserName } =
                data
            if (
                requesterUserUUID === undefined ||
                recipientUserName === undefined
            ) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            console.log("1")
            if (
                !isUserID(recipientUserName) ||
                !isUserID(requesterUserUUID)
            ) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            console.log("2")
            const friendDomain = splitUserName(recipientUserName).domain
            const userDomain = splitUserName(requesterUserUUID).domain
            if (
                userDomain == env["serverDomain"] || friendDomain == userDomain
            ) {
                console.log(userDomain, env["serverDomain"], friendDomain)
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            console.log("reci"  + recipientUserName,"uuid" + requesterUserUUID)
            console.log(userDomain, env["serverDomain"], friendDomain)
            console.log("3")
            const isTrueToken = await takosfetch(
                `${userDomain}/api/v1/server/token?token=` + token,
            )
            if(!isTrueToken) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            console.log("4")
            const isTrueTokenJson = await isTrueToken.json()
            if (isTrueTokenJson.status !== true) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            console.log("5")
            const isAlreadyCreateRemoteServerTable = await remoteservers
                .findOne({
                    serverDomain: userDomain,
                })
            if (isAlreadyCreateRemoteServerTable === null) {
                await remoteservers.create({
                    serverDomain: userDomain,
                    friends: [
                        {
                            userid: requesterUserUUID,
                            timestamp: Date.now(),
                        },
                    ],
                })
            } else {
                const isAlreadyRegisterServer = isAlreadyCreateRemoteServerTable
                    .friends
                    .find(
                        (obj) => {
                            return obj.userid === requesterUserUUID
                        },
                    )
                if (isAlreadyRegisterServer !== undefined) {
                    //
                } else {
                    await remoteservers.updateOne(
                        { serverDomain: userDomain },
                        {
                            $push: {
                                friends: {
                                    userid: requesterUserUUID,
                                    timestamp: Date.now(),
                                },
                            },
                        },
                    )
                }
            }
            //リクエストを送っていたか↓↓ここより下でエラー
            const friendInfo = await users.findOne({
                userName: splitUserName(recipientUserName).userName,
            })
            if (friendInfo === null) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            console.log("6")
            const userFriendInfo = await requestAddFriend.findOne({
                userID: friendInfo.uuid,
            })
            if (userFriendInfo === null) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            const isFriend = userFriendInfo.AppliedUser.find((obj) => {
                return obj.userName ===
                        splitUserName(requesterUserName).userName &&
                    obj.host === splitUserName(requesterUserUUID).domain
            })
            if (isFriend === undefined) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            console.log("7")
                        //すでに友達か
                        const userFriends = await friends.findOne({
                            userid: requesterUserUUID,
                        })
                        if (userFriends !== null) {
                            const isFriend = userFriends.friends.find((obj) =>
                                obj.userid === friendInfo.uuid
                            )
                            if (isFriend !== undefined) {
                                return new Response(JSON.stringify({ status: false, message: "Already friends" }), {
                                    status: 400,
                                })
                            }
                        }
                        console.log("8")
            //リクエストリストから削除
            const result = await requestAddFriend.updateOne(
                { userID: friendInfo.uuid },
                {
                    $pull: {
                        AppliedUser: {
                            userID: requesterUserUUID,
                        },
                    },
                },
            )
            if (result === null) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            console.log("9")
            //roomを作成
            const roomIDarray = new Uint8Array(16)
            const randomarray = crypto.getRandomValues(roomIDarray)
            const roomid = Array.from(
                randomarray,
                (byte) => byte.toString(16).padStart(2, "0"),
            ).join("")
            await rooms.create({
                uuid: roomid,
                types: "remotefriend",
                users: [{
                    userid: requesterUserUUID,
                    type: "other",
                }, {
                    userid: friendInfo.uuid,
                    type: "local",
                }],
                timestamp: Date.now(),
            })
            //友達リストに追加
            const result2 = await friends.findOneAndUpdate(
                { user: friendInfo.uuid },
                {
                    $push: {
                        friends: {
                            userid: requesterUserUUID,
                            room: roomid,
                            type: "other",
                            timestamp: Date.now(),
                        },
                    },
                },
            )
            if (result2 === null) {
                return new Response(JSON.stringify({ status: false }), {
                    status: 400,
                })
            }
            //roomidと友達のuuidを返す
            return new Response(
                JSON.stringify({
                    status: true,
                    roomID: roomid,
                    friendUUID: friendInfo.uuid,
                }),
                { status: 200 },
            )
        }
    },
}
function splitUserName(mail: string) {
    const mailArray = mail.split("@")
    return {
        userName: mailArray[0],
        domain: mailArray[1],
    }
}
//メールアドレスの形式かどうか
function isUserID(mail: string) {
    const mailArray = mail.split("@")
    if (mailArray.length !== 2) {
        return false
    }
    return true
}
