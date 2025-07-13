import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { serveStatic } from "hono/deno";
import HostUser from "./models/user.ts";
import HostSession from "./models/session.ts";

export async function hash(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

export const authApp = new Hono();

const isDev = Deno.env.get("DEV") === "1";

if (isDev) {
  authApp.get("/", async (_c) => {
    const res = await fetch("http://localhost:1421");
    const body = await res.arrayBuffer();
    return new Response(body, { status: res.status, headers: res.headers });
  });
} else {
  authApp.get("/", serveStatic({ root: "./client/dist", path: "/auth" }));
}

authApp.post("/register", async (c) => {
  const { userName, password } = await c.req.json();
  if (typeof userName !== "string" || typeof password !== "string") {
    return c.json({ error: "invalid" }, 400);
  }
  const exists = await HostUser.findOne({ userName });
  if (exists) return c.json({ error: "exists" }, 400);
  const salt = crypto.randomUUID();
  const hashedPassword = await hash(password + salt);
  const user = new HostUser({ userName, hashedPassword, salt });
  await user.save();
  return c.json({ success: true });
});

authApp.post("/login", async (c) => {
  const { userName, password } = await c.req.json();
  const user = await HostUser.findOne({ userName });
  if (!user) return c.json({ error: "invalid" }, 401);
  const hashed = await hash(password + user.salt);
  if (hashed !== user.hashedPassword) return c.json({ error: "invalid" }, 401);
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const session = new HostSession({ sessionId, user: user._id, expiresAt });
  await session.save();
  setCookie(c, "hostSessionId", sessionId, {
    httpOnly: true,
    secure: c.req.url.startsWith("https://"),
    expires: expiresAt,
    sameSite: "Lax",
    path: "/",
  });
  return c.json({ success: true });
});

authApp.get("/status", async (c) => {
  const sid = getCookie(c, "hostSessionId");
  if (!sid) return c.json({ login: false });
  const session = await HostSession.findOne({ sessionId: sid });
  if (session && session.expiresAt > new Date()) {
    return c.json({ login: true, user: session.user });
  }
  if (session) await HostSession.deleteOne({ sessionId: sid });
  return c.json({ login: false });
});

authApp.delete("/logout", async (c) => {
  const sid = getCookie(c, "hostSessionId");
  if (sid) {
    await HostSession.deleteOne({ sessionId: sid });
    deleteCookie(c, "hostSessionId", { path: "/" });
  }
  return c.json({ success: true });
});

export const authRequired: MiddlewareHandler = async (c, next) => {
  const sid = getCookie(c, "hostSessionId");
  if (!sid) return c.json({ error: "unauthorized" }, 401);
  const session = await HostSession.findOne({ sessionId: sid });
  if (!session || session.expiresAt <= new Date()) {
    if (session) await HostSession.deleteOne({ sessionId: sid });
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
};
