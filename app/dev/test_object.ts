import { loadConfig } from "@takos/config";
import {
  connectDatabase,
  createDB,
  createMongoDataStore,
  setStoreFactory,
} from "../takos_host/db/mod.ts";
import { createObjectId } from "../takos/utils/activitypub.ts";

// Takos Host 用のテストオブジェクトを複数追加するスクリプト
// app/takos_host/.env を読み込み、ホスト用 MongoDB に接続します

const env = await loadConfig({
  // dotenv の load はファイルパス(ローカルのパス文字列)を期待するため、URL からパスへ変換
  envPath: new URL("./.hostsEnv", import.meta.url).pathname,
});
const domain = env["OAUTH_HOST"] ?? "localhost";
env["ACTIVITYPUB_DOMAIN"] = domain;

await connectDatabase(env);
// ホスト用（マルチテナント）Store を注入
setStoreFactory((e) => createMongoDataStore(e, { multiTenant: true }));
const db = createDB(env);

const objects = [
  { type: "Note", content: "テストノート1" },
  { type: "Note", content: "テストノート2" },
  { type: "Note", content: "テストノート3" },
];

for (const obj of objects) {
  const id = createObjectId(domain);
  const note = {
    _id: id,
    attributedTo: `https://${domain}/users/system`,
    content: obj.content,
    type: obj.type,
    aud: {
      to: ["https://www.w3.org/ns/activitystreams#Public"],
    },
    to: ["https://www.w3.org/ns/activitystreams#Public"],
  };
  await db.posts.saveObject(note);
  console.log(`追加しました: ${id}`);
}

console.log("完了しました");
