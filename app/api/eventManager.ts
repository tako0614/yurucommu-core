// deno-lint-ignore-file
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
    identifier: string,
    eventId: string,
    schema: z.ZodSchema<T>,
    // deno-lint-ignore no-explicit-any
    handler: (c: Context, payload: T) => Promise<any>,
  ) {
    const key = `${identifier}:${eventId}`;
    this.events.set(key, { schema, handler });
  }

  async dispatch(c: Context) {
    // JSON ボディを直接取得
    // deno-lint-ignore no-explicit-any
    const body = await c.req.json();
    // deno-lint-ignore no-explicit-any
    const events = (body as any).events as {
      eventId: string;
      identifier: string;
      payload: any;
    }[];

    const results: unknown[] = [];
    for (const e of events) {
      const key = `${e.identifier}:${e.eventId}`;
      const eventDef = this.events.get(key);
      if (!eventDef) {
        results.push({ error: "Invalid event", event: e });
        continue;
      }
      const parsed = eventDef.schema.safeParse(e.payload);
      if (!parsed.success) {
        results.push({ error: "Invalid payload", event: e });
        continue;
      }
      try {
        const result = await eventDef.handler(c, parsed.data);
        results.push({ success: true, result });
      } catch (error) {
        console.error("Event handler error:", error);
        results.push({
          success: false,
          error: error instanceof Error
            ? error.message
            : "処理中にエラーが発生しました",
        });
      }
    }
    return c.json(results);
  }
}

export const eventManager = new EventManager();
