import redis from "redis"
const client = redis.createClient({
    url: "redis://192.168.0.4:6379",
})
await client.connect()
