// deno-lint-ignore-file
import { isMail, isUserDuplication, isMailDuplication, isMailDuplicationTemp, sendMail} from "../../../util/takoFunction.ts";
import tempUsers from "../../../models/tempUsers.js";
import users from "../../../models/users.js";
import * as mod from "https://deno.land/std@0.220.1/crypto/mod.ts";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
const env = await load();
const secretKey = env["rechapcha_seecret_key"]
export const handler = {
    async POST(req, ctx) {
        /*--------------reCAPCHA------------------*/
        const data = await req.json();
        const { userName, password, age, isagreement, token, rechapchaToken } = data;
        const isSecsusRechapcha = await fetch(`https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${rechapchaToken}`)
        const score = await isSecsusRechapcha.json()
        if(score.score < 0.7 || score.success == false) {
          return new Response(JSON.stringify({"status": "rechapchaerror"}), {
            headers: { "Content-Type": "application/json",status : 403},
          });
        }
        /*---------------reCAPCHA---------------*/
        //tempUsersからkeyを探して、mailを取得
        const tempUserInfo = await tempUsers.findOne({key: token});
        if(tempUserInfo === null) {
            return new Response(JSON.stringify({"status": "key is not found"}), {
                headers: { "Content-Type": "application/json",status : 403},
            });
        }
        const mail = tempUserInfo.mail;
        //Userの重複を確認
        if(await isUserDuplication(userName)) {
            return new Response(JSON.stringify({"status": "usererror"}), {
                headers: { "Content-Type": "application/json",status : 403},
            });
        }
        //mailの重複を確認
        if(await isMailDuplication(mail)) {
            return new Response(JSON.stringify({"status": "mailerror"}), {
                headers: { "Content-Type": "application/json",status : 403},
            });
        }
        if(!ispassword(password)) {
            return new Response(JSON.stringify({"status": "passworderror"}), {
                headers: { "Content-Type": "application/json",status : 403},
            });
        }
        //塩を生成
        const array = new Uint8Array(32);
        crypto.getRandomValues(array);
        const salt = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
        //パスワードをハッシュ化
        const saltPassword = password + salt;
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(saltPassword));
        const hashArray = new Uint8Array(hash);
        const hashHex = Array.from(hashArray, byte => byte.toString(16).padStart(2, '0')).join('');
        //ユーザーを登録
        const result = await users.create({userName: userName, mail: mail, password: hashHex, salt: salt, age: age});
        //tempUsersから削除
        await tempUsers.deleteOne({mail: mail});
        return new Response(JSON.stringify({status: true}), {
            headers: { "Content-Type": "application/json",
                        status : 200 },
        });
    }
}
function ispassword(password) {
    if(password.length < 8){
        return false;
    }
    if(!/[a-zA-Z]/.test(password) || !/\d/.test(password)){
        return false;
    }
    return true;
}