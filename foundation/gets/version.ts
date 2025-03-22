import { createBaseApp } from "./base.ts";

const app = createBaseApp();

app.get("/version", (c) => {
    return c.json({ version: "0.2.0", name: "takos" });
});

export default app;
