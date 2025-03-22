import PubSub from "pubsub-js";
import redis from "redis";
import { load } from "@std/dotenv";
const env = await load();
const redisURL = env["REDIS_URL"];
const redisch = env["REDIS_CH"];
const subClient = redis.createClient({
    url: redisURL,
});
await subClient.connect();
async function subscribeMessage(channel: string | string[]) {
    await subClient.subscribe(channel, async (message: string) => {
        const type = JSON.parse(message).subPubType;
        if (type === "client") {
            PubSub.publish("client", message);
        }
        if (type === "webRTC") {
            PubSub.publish("webRTC", message);
        }
    });
}
await subscribeMessage(redisch);
