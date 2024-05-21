import { getCookies } from "$std/http/cookie.ts"
import csrftoken from "../../../../models/csrftoken.ts"
import Users from "../../../../models/users.ts"
import { ensureDir } from "$std/fs/ensure_dir.ts";
import sharp from "sharp";
export const handler = {
  async POST(req: Request, ctx: any) {
    try {
        const data = await req.json()
        const cookies = getCookies(req.headers)
        if (typeof data.csrftoken !== "string") {
          return new Response(JSON.stringify({ status: "error" }), {
            headers: { "Content-Type": "application/json" },
            status: 403,
          })
        }
        const iscsrfToken = await csrftoken.findOne({ token: data.csrftoken })
        if (iscsrfToken === null || iscsrfToken === undefined) {
          return new Response(JSON.stringify({ status: "error" }), {
            headers: { "Content-Type": "application/json" },
            status: 403,
          })
        }
        if (iscsrfToken.sessionID !== cookies.sessionid) {
          return new Response(JSON.stringify({ status: "error" }), {
            headers: { "Content-Type": "application/json" },
            status: 403,
          })
        }
        await csrftoken.deleteOne({ token: data.csrftoken })
        const userid = ctx.state.data.userid.toString()
        const icon = data.icon
        const result = await processImage(icon)
        if(result === null) {
            return
        }
        console.log(result)
    } catch (error) {
        console.log(error)
    }
  },
}
async function processImage(inputBuffer: Uint8Array): Promise<Uint8Array | null> {
    try {
      const image = sharp(inputBuffer);
      const metadata = await image.metadata();
      if (metadata.format && ["jpeg", "png", "gif", "webp", "tiff", "avif", "heif"].includes(metadata.format)) {
        // 画像ファイルであると判断
        const outputBuffer = await image.resize(512, 512).toFormat("webp").toBuffer();
        return outputBuffer;
      } else {
        console.log(`The provided data is not a recognized image format.`);
        return null;
      }
    } catch (error) {
      console.error(`Failed to process the image: ${error.message}`);
      return null;
    }
}
/*
  // 使用例
  const inputImagePath = "./path/to/your/input/image.jpg";  // ここに入力画像のパスを指定
  const outputImagePath = "./path/to/output/image.webp";    // ここに出力画像のパスを指定

  // 入力画像をバイナリデータとして読み込み
  const inputFileBuffer = await Deno.readFile(inputImagePath);

  // 画像を処理
  const outputFileBuffer = await processImage(inputFileBuffer);

  if (outputFileBuffer) {
    // 出力画像をバイナリデータとして保存
    await Deno.writeFile(outputImagePath, outputFileBuffer);
    console.log(`Image processed and saved to ${outputImagePath}`);
  } else {
    console.log("Failed to process the image.");
  }
  */