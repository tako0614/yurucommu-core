import { createBaseApp, env } from "./base.ts";

const app = createBaseApp();

app.get("/server/:item", (c) => {
    const item = c.req.param("item");
    switch (item) {
        case "name": {
            return c.json({ name: env["name"] });
        }
        case "description": {
            return c.json({ description: env["description"] });
        }
        case "icon": {
            return c.json({ icon: env["icon"] });
        }
    }
    return c.json({ error: "Invalid request" }, 400);
});

app.get("/key/server/:origin", async (c) => {
    const origin = c.req.param("origin");
    const expire = c.req.query("expire");
    const server = await fetch(
        "https://" + origin + "/key/server?expire=" + expire,
    );
    const res = await server.json();
    return c.json({
        "key": res.key,
    });
});

export default app;
