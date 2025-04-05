import { Image } from "imagescript";
import Message from "../../models/message.ts";

export async function getLatestGroupMessageId(
  roomId: string,
): Promise<string | null> {
  const projection = { messageid: 1, timestamp: 1, userName: 1, _id: 0 };

  const groupIds = roomId.split("@");

  const groupCondition = {
    roomId: "g{" + groupIds[0] + "}@" + groupIds[1],
    isLarge: false,
  };

  const latestMessage = await Message.findOne(groupCondition, projection)
    .sort({ timestamp: -1 });
  return latestMessage ? latestMessage.messageid : null;
}

export function generateRandom8DigitNumber() {
  // Web Crypto API を使用してランダムなバイトを生成
  const randomBytes = new Uint8Array(4); // 4バイトで十分な範囲
  crypto.getRandomValues(randomBytes);

  // 32ビットの整数を作成
  const randomNumber = new DataView(randomBytes.buffer).getUint32(0, false); // ビッグエンディアン

  // 8桁の数字に変換
  const eightDigitNumber = (randomNumber % 100000000).toString().padStart(
    8,
    "0",
  );
  return eightDigitNumber;
}

export function generateSessionId() {
  const uuid = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(uuid).map((b) => b.toString(16).padStart(2, "0"))
    .join(
      "",
    );
  return hex;
}

export async function resizeImageTo256x256(
  imageBuffer: Uint8Array,
): Promise<Uint8Array> {
  // 画像を読み込む
  const image = await Image.decode(imageBuffer);

  // 画像をリサイズ
  const resizedImage = image.resize(256, 256);

  // バイナリとしてエンコード
  const outputBuffer = await resizedImage.encode();

  return outputBuffer;
}
export async function getLatestFriendMessageId(
  userName: string,
  domain: string,
  friendUserName: string,
  friendDomain: string,
  roomId: string,
): Promise<string | null> {
  const projection = { messageid: 1, timestamp: 1, userName: 1, _id: 0 };

  const myRoomCondition = {
    roomId: `m{${roomId.split("@")[0]}}@${roomId.split("@")[1]}`,
    userName: `${userName}@${domain}`,
    isLarge: false,
  };

  const friendRoomCondition = {
    roomId: `m{${userName}}@${domain}`,
    userName: `${friendUserName}@${friendDomain}`,
    isLarge: false,
  };

  // 並列に最新のメッセージをそれぞれ取得
  const [myMessage, friendMessage] = await Promise.all([
    Message.findOne(myRoomCondition, projection).sort({ timestamp: -1 }),
    Message.findOne(friendRoomCondition, projection).sort({
      timestamp: -1,
    }),
  ]);

  let latestMessage = null;
  if (myMessage && friendMessage) {
    latestMessage =
      myMessage.timestamp.getTime() >= friendMessage.timestamp.getTime()
        ? myMessage
        : friendMessage;
  } else {
    latestMessage = myMessage || friendMessage;
  }
  return latestMessage ? latestMessage.messageid : null;
}
