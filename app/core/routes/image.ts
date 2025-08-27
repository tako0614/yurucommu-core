import { Hono } from "hono";

const DEFAULT_AVATAR = await Deno.readFile(
  new URL("../image/people.png", import.meta.url),
);

const app = new Hono();

app.get("/image/people.png", (c) => {
  return c.body(DEFAULT_AVATAR, 200, { "content-type": "image/png" });
});

export default app;
