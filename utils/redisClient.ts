import redis from "redis";
import { load } from "@std/dotenv";
const env = await load();
const redisURL = env["REDIS_URL"];
const redisChannel = env["REDIS_CH"];
const pubClient = redis.createClient({
  url: redisURL,
});
await pubClient.connect();

function publish(data: {
  type: string;
  users: string[];
  data: string;
}) {
  pubClient.publish(redisChannel, JSON.stringify(data));
}

export default publish;
