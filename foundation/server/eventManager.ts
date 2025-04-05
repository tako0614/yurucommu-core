import { type Context } from "hono";
import z from "zod";
class EventManager {
  private events = new Map<
    string,
    {
      // deno-lint-ignore no-explicit-any
      schema: z.ZodSchema<any>;
      // deno-lint-ignore no-explicit-any
      handler: (c: Context, payload: any) => Promise<any>;
    }
  >();

  add<T>(
    eventName: string,
    schema: z.ZodSchema<T>,
    // deno-lint-ignore no-explicit-any
    handler: (c: Context, payload: T) => Promise<any>,
  ) {
    this.events.set(eventName, { schema, handler });
  }

  async dispatch(c: Context) {
    // deno-lint-ignore ban-ts-comment
    //@ts-ignore
    const { event, payload } = c.req.valid("json");
    const eventDef = this.events.get(event);
    if (!eventDef) {
      console.log(this.events);
      return c.json({ error: "Invalid event" }, 400);
    }
    const parsed = eventDef.schema.safeParse(payload);
    if (!parsed.success) {
      console.log(payload, event);
      return c.json({ error: "Invalid payload" }, 400);
    }
    return await eventDef.handler(c, parsed.data);
  }
}

export const eventManager = new EventManager();
