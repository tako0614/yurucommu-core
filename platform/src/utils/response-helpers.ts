// Unified response helpers

import type { Context } from "hono";

export const ok = <T = any>(c: Context, data: T, status: number = 200) =>
  c.json({ ok: true, data }, status as any);

export const fail = (c: Context, message: string, status: number = 400) =>
  c.json({ ok: false, error: message }, status as any);

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

// Helper functions
export const nowISO = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export const addHours = (date: Date, h: number) =>
  new Date(date.getTime() + h * 3600 * 1000);
