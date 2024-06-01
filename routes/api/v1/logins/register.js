import {
  isMail,
  isMailDuplication,
  isMailDuplicationTemp,
  isUserDuplication,
  sendMail,
} from "../../../../util/takoFunction.ts"
import tempUsers from "../../../../models/tempUsers.ts"
import users from "../../../../models/users.ts"
import { load } from "$std/dotenv/mod.ts"
import * as mod from "$std/crypto/mod.ts"
import { v4 } from "$std/uuid/mod.ts"
const env = await load()
const secretKey = env["rechapcha_seecret_key"]
export const handler = {
  async POST(req) {
    const data = await req.json()
    const rechapcha = data.rechapchaToken
    const isSecsusRechapcha = await fetch(
      `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${rechapcha}`,
    )
    const score = await isSecsusRechapcha.json()
    const requirments = data.requirments
    if (score.score < 0.5 || score.success == false) {
      console.log(score)
      return new Response(
        JSON.stringify({ "status": false, error: "rechapcha" }),
        {
          headers: { "Content-Type": "application/json" },
          status: 403,
        },
      )
    }
    if (requirments == "register") {
      const email = await data.email
      const ismail = isMail(email)
      if (email === undefined || email === "" || email === null) {
        return new Response(JSON.stringify({ "status": false }), {
          headers: {
            "Content-Type": "application/json",
            error: "input",
          },
          status: 403,
        })
      }
      const ismailduplication = await isMailDuplication(email)
      if (ismail) {
        if (!ismailduplication) {
          try {
            const array = new Uint8Array(64)
            crypto.getRandomValues(array)
            const key = Array.from(
              array,
              (byte) => byte.toString(16).padStart(2, "0"),
            ).join("")
            const array2 = new Uint32Array(1)
            self.crypto.getRandomValues(array2)
            const checkCode = array2[0]
            if (isMailDuplicationTemp(email)) {
              await tempUsers.deleteOne({ mail: email })
            }
            await tempUsers.create({
              mail: email,
              key: key,
              checkCode: checkCode,
            })
            sendMail(
              email,
              "takoserverです次のtokenでメールアドレスを認証してください",
              `token: ${checkCode}`,
            )
            return new Response(
              JSON.stringify({ status: true, mailToken: key }),
              {
                headers: { "Content-Type": "application/json" },
                status: 200,
              },
            )
          } catch (error) {
            console.log(error)
            return new Response(
              JSON.stringify({
                "status": false,
                error: "Unknown",
              }),
              {
                headers: { "Content-Type": "application/json" },
                status: 500,
              },
            )
          }
        } else {
          return new Response(
            JSON.stringify({
              "status": false,
              error: "mailDuplication",
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 403,
            },
          )
        }
      } else {
        return new Response(
          JSON.stringify({ "status": false, error: "mail" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      //めいん登録
    } else if (requirments === "mainRegister") {
      const {
        userName,
        nickName,
        password,
        age,
        mailToken,
        isagreement,
      } = data
      //const { nickName,userName, password, age, isagreement, token } = data;
      const variablesToCheck = [
        userName,
        nickName,
        password,
        age,
        mailToken,
        isagreement,
      ]
      if (
        variablesToCheck.some((variable) =>
          variable == null || variable == undefined
        )
      ) {
        return new Response(
          JSON.stringify({ "status": false, error: "input" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      if (!/^[ぁ-んァ-ンa-zA-Z0-9]{1,18}$/.test(nickName)) {
        return new Response(
          JSON.stringify({ "status": false, error: "nickName" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      //tempUsersからkeyを探して、mailを取得
      const tempUserInfo = await tempUsers.findOne({ key: mailToken })
      if (tempUserInfo === null) {
        return new Response(
          JSON.stringify({ status: false, error: "userNotFound" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      if (!tempUserInfo.checked) {
        return new Response(
          JSON.stringify({ status: false, error: "checked" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      const mail = tempUserInfo.mail
      //Userの重複を確認
      if (await isUserDuplication(userName)) {
        return new Response(
          JSON.stringify({ status: false, error: "userdup" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      //mailの重複を確認
      if (await isMailDuplication(mail)) {
        return new Response(
          JSON.stringify({ status: false, error: "maildup" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      if (!ispassword(password)) {
        return new Response(
          JSON.stringify({ "status": false, error: "password" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      //塩を生成
      const array = new Uint8Array(32)
      crypto.getRandomValues(array)
      const salt = Array.from(
        array,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
      //パスワードをハッシュ化
      const saltPassword = password + salt
      const hash = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(saltPassword),
      )
      const hashArray = new Uint8Array(hash)
      const hashHex = Array.from(
        hashArray,
        (byte) => byte.toString(16).padStart(2, "0"),
      ).join("")
      //ユーザーを登録
      const uuid = crypto.randomUUID() + "@" + env["serverDomain"]
      const result = await users.create({
        uuid: uuid,
        userName,
        nickName,
        mail: mail,
        password: hashHex,
        salt: salt,
        age: age,
      })
      const defaultIcon = await Deno.readFile(
        "./static/people.webp",
      )
      try {
        await Deno.writeFile(
          `./files/userIcons/${result.uuid}.webp`,
          defaultIcon,
        )
      } catch (error) {
        console.log("Icon Folder not found")
        try {
          await Deno.mkdir("./files")
          await Deno.mkdir("./files/userIcons")
          await Deno.mkdir("./files/pictures")
          await Deno.writeFile(
            `./files/userIcons/${result.uuid}.webp`,
            defaultIcon,
          )
        } catch (error) {
          console.log(error)
          await users.deleteOne({ userName: userName })
          return new Response(
            JSON.stringify({ status: false, error: "icon" }),
            {
              headers: { "Content-Type": "application/json" },
              status: 500,
            },
          )
        }
      }
      //tempUsersから削除
      await tempUsers.deleteOne({ mail: mail })
      return new Response(JSON.stringify({ status: true }), {
        headers: { "Content-Type": "application/json", status: 200 },
      })
    } else if (requirments === "checkMail") {
      const mailToken = await data.mailToken
      const checkCode = await data.checkCode
      const missCheck = await tempUsers.findOne({ key: mailToken }, {
        missCheck: 1,
      })
      if (missCheck === null) {
        return new Response(
          JSON.stringify({ "status": false, error: "key" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      if (missCheck.missCheck > 5) {
        await tempUsers.deleteMany({ key: mailToken })
        return new Response(
          JSON.stringify({ "status": false, error: "missCheck" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      if (
        mailToken === undefined || mailToken === "" ||
        mailToken === null ||
        checkCode === undefined || checkCode === "" ||
        checkCode === null
      ) {
        return new Response(
          JSON.stringify({ "status": false, error: "input" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      const tempUserInfo = await tempUsers.findOne({ key: mailToken })
      if (tempUserInfo === null) {
        await tempUsers.updateOne({ key: mailToken }, {
          $inc: { missCheck: 1 },
        })
        return new Response(
          JSON.stringify({ "status": false, error: "key" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      if (tempUserInfo.checkCode != checkCode) {
        await tempUsers.updateOne({ key: mailToken }, {
          $inc: { missCheck: 1 },
        })
        return new Response(
          JSON.stringify({ "status": false, error: "token" }),
          {
            headers: { "Content-Type": "application/json" },
            status: 403,
          },
        )
      }
      await tempUsers.updateOne({ checkCode: checkCode }, {
        $set: { checked: true },
      })
      return new Response(JSON.stringify({ status: true }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      })
    } else {
      return new Response(
        JSON.stringify({ "status": false, error: "input" }),
        {
          headers: { "Content-Type": "application/json" },
          status: 403,
        },
      )
    }
  },
}
function ispassword(password) {
  if (password.length < 8) {
    return false
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return false
  }
  return true
}
