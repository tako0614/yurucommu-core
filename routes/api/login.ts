import { Handler } from "$fresh/server.ts";

export const handler: Handler = () => {
  const res = {
    "tako" : "tako",
    "age" : 20
  }
  return Response.json({ 
    res
  });
};