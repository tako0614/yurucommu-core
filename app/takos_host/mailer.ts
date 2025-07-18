import nodemailer from "nodemailer";

export async function sendVerifyMail(
  to: string,
  code: string,
) {
  const env = Deno.env.toObject();
  const host = env["SMTP_HOST"];
  const from = env["MAIL_FROM"] ?? env["SMTP_USER"];
  if (!host || !from) {
    console.log("[mail] verify code:", code);
    return;
  }
  const transporter = nodemailer.createTransport({
    host,
    port: Number(env["SMTP_PORT"] ?? "587"),
    secure: false,
    auth: env["SMTP_USER"]
      ? { user: env["SMTP_USER"], pass: env["SMTP_PASS"] }
      : undefined,
  });
  await transporter.sendMail({
    from,
    to,
    subject: "メールアドレス確認",
    text: `以下の確認コードを入力してください: ${code}`,
  });
}
