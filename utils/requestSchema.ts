import { z } from "zod";
import { Context } from "hono";
// deno-lint-ignore no-explicit-any
export async function isTrueRequestSchema(
  zod: z.ZodType<any>,
  c: Context,
): Promise<false | object> {
  try {
    const data = await c.req.json();
    zod.parse(data);
    return data;
  } catch {
    return false;
  }
}
