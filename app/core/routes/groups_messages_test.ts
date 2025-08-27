import { Hono } from "hono";
import { assertEquals } from "@std/assert/mod.ts";

Deno.test("グループルームメッセージ取得", async () => {
  const app = new Hono();
  app.get("/api/groups/:name/messages", (c) => {
    return c.json([
      {
        _id: "m1",
        from: "alice@example.com",
        content: "hello",
        createdAt: "2024-01-01T00:00:00Z",
      },
    ]);
  });

  const res = await app.request(
    "http://example.com/api/groups/test/messages",
  );
  assertEquals(res.status, 200);
  const data = await res.json();
  assertEquals(Array.isArray(data), true);
  assertEquals(data[0].content, "hello");
});
