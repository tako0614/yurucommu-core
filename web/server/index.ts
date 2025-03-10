import app from "../../_factory.ts";

const icon = await Deno.readFile("../icon.jpg");
const background = await Deno.readFile("../backgroundImages/nya.jpg");

app.get("/icon", (c) => {
  return c.body(icon);
});

app.get("/background", (c) => {
  return c.body(background);
});

export default app;
