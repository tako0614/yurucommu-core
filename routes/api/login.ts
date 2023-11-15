import { HandlerContext } from "$fresh/server.ts";

// Jokes courtesy of https://punsandoneliners.com/randomness/programmer-jokes/
const JOKES = {}
export const signup = async (req: Request, ctx: HandlerContext): Promise<Response> => {
  const body = await req.json();
  const { username, password } = body;

  const result = await database.insert("users", ["username", "password"], [username, password]);

  if (result === "error") {
    return new Response("error");
  }

  return new Response("success");
}
export const handler = (_req: Request, _ctx: HandlerContext): Response => {
  const data = {
    message: "Hello, world!"
  };
  
  return {
    status: 200,
    body: JSON.stringify(data),
    headers: {
      "content-type": "application/json"
    }
  };
}
