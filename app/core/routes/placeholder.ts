import { Hono } from "hono";

const app = new Hono();

app.get("/placeholder/:width/:height", (c) => {
  const w = parseInt(c.req.param("width"), 10) || 400;
  const h = parseInt(c.req.param("height"), 10) || 225;
  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n  <rect width="100%" height="100%" fill="#444"/>\n  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#ccc" font-size="${
      Math.min(w, h) / 6
    }">${w}x${h}</text>\n</svg>`;
  return c.text(svg, 200, { "Content-Type": "image/svg+xml" });
});

export default app;
