import { loadConfig } from "../../shared/config.ts";
import * as nodemailer from "nodemailer";
const env = await loadConfig();
const smtp_host = env["SMTP_HOST"];
const smtp_port = env["SMTP_PORT"];
const smtp_auth_user = env["SMTP_USER"];
const smtp_auth_pass = env["SMTP_PASS"];
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

export const sendEmail = async (
  to: string,
  subject: string,
  body: string,
): Promise<boolean> => {
  try {
    await transporter.sendMail(
      buildMessage(
        to,
        subject,
        body,
      ),
    );
    return true;
  } catch (error) {
    console.error("メール送信に失敗しました:", error);
    return false;
  }
};

export const sendVerifyMail = async (
  to: string,
  code: string,
): Promise<boolean> => {
  const subject = "Takos Host メールアドレス確認";
  const body =
    `以下のコードを入力してメールアドレスを確認してください。\n\n${code}`;
  return await sendEmail(to, subject, body);
};
