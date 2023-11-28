import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import { Client } from "https://deno.land/x/mysql@v2.12.1/mod.ts";
import * as nodemailer from "npm:nodemailer@6.9.5";
import { encode } from "https://deno.land/std@0.107.0/encoding/base64.ts";
const env = await load();
const hostname = env["hostname"];
const username = env["username"];
const db = env["db"];
const password = env["password"];
const smtp_host = env["smtp_host"];
const smtp_port = env["smtp_port"];
const smtp_auth_user = env["smtp_username"];
const smtp_auth_pass = env["smtp_password"];
//const smtp_ssl = env["tls"];
const MAIL_SETTINGS = {
  smtp_host,
  smtp_port,
  smtp_auth_user,
  smtp_auth_pass,
  smtp_ssl: `TLS`,
  smtp_from: smtp_auth_user,
};

function buildMessage(to: string, subject: string, text: string) {
  return {
    from: MAIL_SETTINGS.smtp_from,
    to,
    subject,
    text,
  };
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
});

const client = await new Client().connect({
  hostname,
  username,
  db,
  password,
});
function isMail(mail: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(mail);
}
async function isUserDuplication(userid: string): Promise<boolean> {
    const result = await client.query(`SELECT * FROM users WHERE name = "${userid}"`);
    return result.length > 0;
}
async function isMailDuplication(mail: string): Promise<boolean> {
    const result = await client.query(`SELECT * FROM users WHERE mail = "${mail}"`);
    return result.length > 0;
}
function isSavePassword(password: string): boolean {
    const passwordRegex = /^[a-zA-Z0-9]{8,16}$/;
    return passwordRegex.test(password);
}
const sendMail = (to: string, subject: string, body: string) => {
    
    transporter.sendMail(
      buildMessage(
        /* to address */ to,
        /* Subject    */ subject,
        /* Body       */ body
      )
    );
};
function generateSalt(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return encode(array);
}
async function hashPassword(password: string, salt: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + salt);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return encode(new Uint8Array(hash));
  }
  export type takojson = {
    status: string;
    requirements: string;
    mail: string;
    password: string;
    userName: string;
  }
export { client, isMail, isUserDuplication, isMailDuplication, isSavePassword, sendMail, generateSalt, hashPassword};  