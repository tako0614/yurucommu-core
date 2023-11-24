import * as nodemailer from "npm:nodemailer@6.9.5";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import envRoader from "./envRoader.ts";

const env = await load();
const smtp_host = env["smtp_host"];
const smtp_port = env["smtp_port"];
const smtp_auth_user = env["smtp_username"];
const smtp_auth_pass = env["smtp_password"];
const smtp_ssl = env["tls"];
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

export const testMail = (to: string, subject: string, body: string) => {
  transporter.sendMail(
    buildMessage(
      /* to address */ to,
      /* Subject    */ subject,
      /* Body       */ body
    )
  );
};
