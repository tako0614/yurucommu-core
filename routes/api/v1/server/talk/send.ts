export const handler = {
  async POST(req: Request, ctx: any) {
    const data = await req.json()
    const { roomid, sender, message, token } = data
    const { name, domain } = splitUserName(sender)
    const isTrueToken = await fetch(
      `https://${domain}/api/v1/server/token?token=${token}`,
    )
    if (isTrueToken.status !== 200) {
      return new Response("token is not found", { status: 400 })
    }
  },
}
//メールアドレスのドメインと名前を分離
function splitUserName(email: string) {
  const [name, domain] = email.split("@")
  return { name, domain }
}
