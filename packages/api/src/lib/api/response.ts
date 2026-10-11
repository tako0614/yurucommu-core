import { throwIfResponseAborted } from "../fetch-with-timeout.ts";

/** A successful HTTP response did not contain the required SDK read contract. */
export class InvalidApiResponseError extends Error {
  constructor(public readonly field: string) {
    super(`Invalid API response: ${field}`);
    this.name = "InvalidApiResponseError";
  }
}

export function responseObject(
  value: unknown,
  field = "body",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidApiResponseError(field);
  }
  return value as Record<string, unknown>;
}

export async function readResponseJson(
  res: Response,
): Promise<Record<string, unknown>> {
  const value = await parseResponseJson(res, () => {
    throw new InvalidApiResponseError("JSON body");
  });
  return responseObject(value);
}

/** Separate body I/O from JSON decoding so stream failures never become parse fallbacks. */
export async function parseResponseJson(
  res: Response,
  malformed: () => unknown,
): Promise<unknown> {
  let body: string;
  try {
    body = await res.text();
  } catch (error) {
    throwIfResponseAborted(res);
    throw error;
  }
  throwIfResponseAborted(res);
  try {
    return JSON.parse(body);
  } catch (error) {
    if (error instanceof SyntaxError) return malformed();
    throw error;
  }
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new InvalidApiResponseError(field);
  return value;
}

function identity(value: unknown, field: string): void {
  if (!requiredString(value, field).trim())
    throw new InvalidApiResponseError(field);
}

export function requiredCount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidApiResponseError(field);
  }
  return value;
}

export function optionalBoolean(
  data: Record<string, unknown>,
  field: string,
): boolean {
  if (data[field] === undefined) return false;
  if (typeof data[field] !== "boolean")
    throw new InvalidApiResponseError(field);
  return data[field];
}

export function optionalString(
  data: Record<string, unknown>,
  field: string,
): string | null {
  const value = data[field];
  if (value === undefined || value === null) return null;
  return requiredString(value, field);
}

/** Validate primary collections and the minimum fields consumed by readers. */
export function requiredArray<T>(
  data: Record<string, unknown>,
  field: string,
  validate: (value: unknown) => void,
): T[] {
  const value = data[field];
  if (!Array.isArray(value)) throw new InvalidApiResponseError(field);
  for (const item of value) validate(item);
  return value as T[];
}

export function validateActor(value: unknown): void {
  const actor = responseObject(value, "actor");
  identity(actor.ap_id, "actor.ap_id");
  if (actor.username !== undefined)
    requiredString(actor.username, "actor.username");
  for (const key of ["preferred_username", "name", "icon_url"])
    optionalString(actor, key);
  if (
    actor.outgoing_follow_status !== undefined &&
    actor.outgoing_follow_status !== "none" &&
    actor.outgoing_follow_status !== "pending" &&
    actor.outgoing_follow_status !== "accepted"
  ) {
    throw new InvalidApiResponseError("actor.outgoing_follow_status");
  }
}

export function validatePost(value: unknown): void {
  const post = responseObject(value, "post");
  identity(post.ap_id, "post.ap_id");
  validateActor(post.author);
  requiredString(post.content, "post.content");
  // Historical object rows can have NULL published; owning read routes still
  // forward those values. Missing/wrong types remain invalid.
  if (post.published !== null) requiredString(post.published, "post.published");
}

export function validateMessage(value: unknown): void {
  const message = responseObject(value, "message");
  identity(message.id, "message.id");
  validateActor(message.sender);
  requiredString(message.content, "message.content");
  // DM/group messages and requests also project legacy objects.published.
  if (message.created_at !== null)
    requiredString(message.created_at, "message.created_at");
}
