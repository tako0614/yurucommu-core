import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts"
import { encode } from "https://deno.land/std@0.107.0/encoding/base64.ts"
import { escapeSql } from "https://deno.land/x/escape@1.4.2/mod.ts"
import mongoose from "mongoose"
import users from "../models/users.ts"
import csrfToken from "../models/csrftoken.ts"
import tempUsers from "../models/tempUsers.ts"
import * as nodemailer from "npm:nodemailer@6.9.5"
const env = await load()
const smtp_host = env["smtp_host"]
const smtp_port = env["smtp_port"]
const smtp_auth_user = env["smtp_username"]
const smtp_auth_pass = env["smtp_password"]
function envRoader(value: string) {
  const result = env[value]
  return result
}
//const smtp_ssl = env["tls"];
const MAIL_SETTINGS = {
  smtp_host,
  smtp_port,
  smtp_auth_user,
  smtp_auth_pass,
  smtp_ssl: `TLS`,
  smtp_from: smtp_auth_user,
}
function buildMessage(to: string, subject: string, text: string) {
  return {
    from: MAIL_SETTINGS.smtp_from,
    to,
    subject,
    text,
  }
}
const transporter = nodemailer.createTransport({
  pool: false,
  host: MAIL_SETTINGS.smtp_host,
  port: MAIL_SETTINGS.smtp_port,
  secure: MAIL_SETTINGS.smtp_ssl === `SSL`,
  auth: {
    user: MAIL_SETTINGS.smtp_auth_user,
    pass: MAIL_SETTINGS.smtp_auth_pass,
  },
})
const sendMail = (to: string, subject: string, body: string) => {
  transporter.sendMail(
    buildMessage(
      /* to address */ to,
      /* Subject    */ subject,
      /* Body       */ body,
    ),
  )
}
//@ts-ignore: origin
function isMail(mail: string): boolean {
  const emailPattern = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/
  return emailPattern.test(mail)
}
async function isUserDuplication(userid: string): Promise<boolean> {
  const result = await users.findOne({ userName: userid }, { userName: 1 })
  return result !== null
}
async function isMailDuplication(mail: string): Promise<boolean> {
  const result = await users.findOne({ mail: mail }, { mail: 1 })
  console.log(result)
  return result !== null
}
async function isCsrftoken(token: string): Promise<any> {
  const result = await csrfToken.findOne({ csrftoken: token }, {
    sessionID: 1,
  })
  return result !== null
}
async function isMailDuplicationTemp(mail: string): Promise<boolean> {
  const result = await tempUsers.findOne({ mail: mail }, { mail: 1 })
  return result !== null
}
function isSavePassword(password: string): boolean {
  const passwordRegex = /^[a-zA-Z0-9]{8,16}$/
  return passwordRegex.test(password)
}
function generateSalt(length: number): string {
  const array = new Uint8Array(length)
  crypto.getRandomValues(array)
  return encode(array)
}
async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + salt)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return encode(new Uint8Array(hash))
}
export type takojson = {
  status: string
  requirements: string
  mail: string
  password: string
  userName: string
}
export {
  envRoader,
  generateSalt,
  hashPassword,
  isCsrftoken,
  isMail,
  isMailDuplication,
  isMailDuplicationTemp,
  isSavePassword,
  isUserDuplication,
  sendMail,
}
