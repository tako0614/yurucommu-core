import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import tempUsers from "../../models/users/tempUsers.ts";
import users from "../../models/users/users.ts";
import { sendEmail } from "../../utils/sendEmail.ts";
import app from "../../_factory.ts";
import { generateRandom8DigitNumber } from "./utils.ts";

app.post(
  "/register/temp",
  zValidator(
    "json",
    z.object({
      email: z.string().email(),
    }).strict(),
  ),
  async (c) => {
    const { email } = c.req.valid("json");
    if (await users.findOne({ email })) {
      return c.json({
        status: "error",
        message: "This email is already in use",
      }, 400);
    }
    const checkCode = generateRandom8DigitNumber();
    const token = crypto.randomUUID();
    if (await tempUsers.findOne({ email })) {
      await tempUsers.updateOne({
        email,
      }, {
        checkCode,
        token,
      });
    } else {
      await tempUsers.create({ email, checkCode, token });
    }
    sendEmail(
      email,
      "Takos Registration",
      `Your registration code is ${checkCode}`,
    );
    return c.json({ token });
  },
);

export default app;
