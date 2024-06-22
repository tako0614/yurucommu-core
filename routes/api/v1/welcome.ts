import users from "../../../models/users.ts"
import remoteServers from "../../../models/remoteServers.ts"
import serverInfo from "../../../models/serverInfo.ts"
import { load } from "$std/dotenv/mod.ts"
const env = await load()
const serverDomain = env["serverDomain"]
// Denoの標準ライブラリから必要な関数をインポート

async function loadDenoConfig() {
  try {
    // deno.jsonファイルの内容を読み込む
    const content = await Deno.readTextFile("./deno.json");
    // 読み込んだ内容をJSONとしてパース
    const config = JSON.parse(content);
    return config.version;
  } catch (error) {
    console.error("deno.jsonファイルの読み込みに失敗しました:", error);
  }
}
const version = await loadDenoConfig();
//deno.jsonの中身を取得
export const handler = {
    async GET() {
        const CacheServerData = await serverInfo.findOne({ serverDomain })
        if(!CacheServerData) {
            //ユーザーの数を取得
            const usersCount = await users.countDocuments()
            //リモートサーバーの数を取得
            const remoteServersCount = await remoteServers.countDocuments()
            await serverInfo.create({
                serverDomain,
                users: usersCount,
                remoteServers: remoteServersCount,
                lastUpdate: new Date()
            })
            const result = {
                users: usersCount,
                remoteServers: remoteServersCount,
                version: version,
                status: true
            }
            return new Response(JSON.stringify(result), {
                headers: { "Content-Type": "application/json" },
                status: 200,
            })
        } else {
            const lastUpdate = new Date(CacheServerData.lastUpdate)
            const now = new Date()
            //一日以上経っていたら更新
            if(now.getTime() - lastUpdate.getTime() > 86400000) {
        //ユーザーの数を取得
            const usersCount = await users.countDocuments()
            //リモートサーバーの数を取得
            const remoteServersCount = await remoteServers.countDocuments()
            await serverInfo.updateOne({
                serverDomain
            }, {
                $set: {
                    users: usersCount,
                    remoteServers: remoteServersCount,
                    lastUpdate: new Date()
                }
            })
            const result = {
                users: usersCount,
                remoteServers: remoteServersCount,
                version: version,
                status: true
            }
            return new Response(JSON.stringify(result), {
                headers: { "Content-Type": "application/json" },
                status: 200,
            })
            } else {
                const result = {
                    users: CacheServerData.users,
                    remoteServers: CacheServerData.remoteServers,
                    version: version,
                    status: true
                }
                return new Response(JSON.stringify(result), {
                    headers: { "Content-Type": "application/json" },
                    status: 200,
                })
            }
        }
    }
}