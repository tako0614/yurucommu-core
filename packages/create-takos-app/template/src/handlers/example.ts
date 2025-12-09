import { defineHandler } from "@takos/app-sdk/server";

export const exampleHandler = defineHandler({
  id: "example",
  method: "GET",
  path: "/example",
  auth: "required",
  handler: async () => {
    return Response.json({ message: "Hello from handler!" });
  }
});
