// Server-side functions

import { z } from "npm:zod";
import {
  ServerExtension,
} from "@takopack/builder/src/classes.ts";
import { getTakosServerAPI } from "@takopack/builder/src/api-helpers.ts";
import { SerializableObject } from "@takopack/builder";

const HelloServer = new ServerExtension();

HelloServer.hello = (name: string): string => {
  return `Hello, ${name} from server!`;
};

HelloServer.calculateSum = (a: number, b: number): number => {
  return a + b;
};

/** @event("userLogin", { source: "client", target: "server" }) */
HelloServer.onUserLogin = async (
  userData: { username: string; timestamp: number },
): Promise<[number, SerializableObject]> => {
  console.log("User logged in:", userData);

  z.object({
    username: z.string().min(1, "Username is required"),
    timestamp: z.number().int().positive(
      "Timestamp must be a positive integer",
    ),
  }).parse(userData);
  // Save to KV store
  const takosAPI = getTakosServerAPI();
  await takosAPI?.kv.write(
    `last_login:${userData.username}`,
    userData.timestamp,
  );

  return [200, { success: true, message: "Login recorded" }];
};

export { HelloServer };
