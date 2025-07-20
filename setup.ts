import { load, stringify } from "jsr:@std/dotenv";
import { ensureFile } from "jsr:@std/fs/ensure-file";
import { join } from "jsr:@std/path";
import { connectDatabase } from "./shared/db.ts";
import {
  createAccount,
  updateAccountById,
} from "./app/api/repositories/account.ts";
import { createDB } from "./app/api/db.ts";

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bufferToPem(buffer: ArrayBuffer, type: "PRIVATE KEY" | "PUBLIC KEY") {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const lines = b64.match(/.{1,64}/g)?.join("\n") ?? b64;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

async function generateKeyPair() {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const priv = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const pub = await crypto.subtle.exportKey("spki", pair.publicKey);
  return {
    privateKey: bufferToPem(priv, "PRIVATE KEY"),
    publicKey: bufferToPem(pub, "PUBLIC KEY"),
  };
}

async function main() {
  const envPath = join("app", "api", ".env");
  await ensureFile(envPath);
  const env = await load({ envPath });

  const pass = prompt("ログイン用パスワードを入力してください:") ?? "";
  if (!pass) {
    console.log("パスワードが入力されませんでした");
    return;
  }
  const salt = crypto.randomUUID().replace(/-/g, "");
  env.hashedPassword = await sha256Hex(pass + salt);
  env.salt = salt;
  await Deno.writeTextFile(envPath, stringify(env));
  console.log("パスワードを保存しました");

  await connectDatabase(env);

  const username = prompt("最初のユーザー名:")?.trim();
  if (!username) {
    console.log("ユーザー名が入力されませんでした");
    return;
  }
  const displayName = prompt("表示名(空欄可):")?.trim() || username;
  const keys = await generateKeyPair();
  const account = await createAccount(env, {
    userName: username,
    displayName,
    avatarInitial: username.charAt(0).toUpperCase().substring(0, 2),
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    followers: [],
    following: [],
  });

  const follow =
    prompt("フォローするユーザー(acct または URL, カンマ区切り):") ?? "";
  const list = follow.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length) {
    const db = createDB(env);
    await updateAccountById(env, String(account._id), {
      following: list,
    });
    for (const actor of list) {
      await db.follow("", actor);
    }
  }

  console.log("初期設定が完了しました");
}

if (import.meta.main) {
  main();
}
