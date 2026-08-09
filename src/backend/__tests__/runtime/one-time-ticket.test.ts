import { expect, test } from "bun:test";

import {
  consumeOneTimeTicket,
  mintOneTimeTicket,
} from "../../runtime/one-time-ticket.ts";

class MemoryTicketStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    return new Map(
      [...this.values.entries()]
        .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
        .map(([key, value]) => [key, value as T]),
    );
  }
}

test("one-time tickets store only a hash, expire, and consume on failure", async () => {
  const storage = new MemoryTicketStorage();
  let now = 1_000;
  const options = { prefix: "ticket:", ttlMs: 100, now: () => now };
  const ticket = await mintOneTimeTicket(storage, options);

  expect(JSON.stringify([...storage.values])).not.toContain(ticket);
  now = 1_101;
  expect(await consumeOneTimeTicket(storage, ticket, options)).toBe(false);
  expect(storage.values.size).toBe(0);
});

test("one-time ticket minting bounds outstanding credentials per user", async () => {
  const storage = new MemoryTicketStorage();
  let now = 1_000;
  const options = {
    prefix: "ticket:",
    ttlMs: 10_000,
    maxOutstanding: 2,
    now: () => now,
  };
  const first = await mintOneTimeTicket(storage, options);
  now += 1;
  const second = await mintOneTimeTicket(storage, options);
  now += 1;
  const third = await mintOneTimeTicket(storage, options);

  expect(storage.values.size).toBe(2);
  expect(await consumeOneTimeTicket(storage, first, options)).toBe(false);
  expect(await consumeOneTimeTicket(storage, second, options)).toBe(true);
  expect(await consumeOneTimeTicket(storage, third, options)).toBe(true);
});
