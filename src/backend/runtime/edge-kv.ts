/**
 * `edge.kv@1.0.0` → {@link IKeyValueStore}.
 *
 * The app's port and the facade disagree in three places, and each disagreement
 * is resolved here rather than at the call sites:
 *
 *  - READS. `IKeyValueStore.get` selects `text` / `json` / `arrayBuffer`; the
 *    facade always returns bytes. The decode happens here.
 *  - EXPIRY. The port carries Cloudflare's pair (`expirationTtl` relative,
 *    `expiration` absolute); the facade accepts only `expirationTtlSeconds`. An
 *    absolute instant is converted against the current clock.
 *  - LISTING. The facade returns `{name}` only and calls the flag
 *    `listComplete`; the port expects `list_complete` and optional
 *    `expiration` / `metadata`. Those two fields are ABSENT on this lane — the
 *    Host does not return them — so nothing may be inferred from their absence.
 */

import type { IKeyValueStore } from "./types.ts";
import {
  EDGE_KV_MAX_EXPIRATION_TTL_SECONDS,
  EDGE_KV_MIN_EXPIRATION_TTL_SECONDS,
  type EdgeKvBinding,
  type EdgeKvPutOptions,
} from "./edge-facades.ts";
import { nowSeconds, readStream } from "./shared.ts";

/** A put option the facade cannot express. */
export class EdgeKeyValueOptionError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = "EdgeKeyValueOptionError";
  }
}

/**
 * Resolve the port's expiry pair into the single value `edge.kv` takes.
 *
 * `expiration` is an absolute UNIX second; the facade has no equivalent, so it
 * becomes the remaining seconds from now. Both backends reject a TTL under 60
 * seconds (as does Cloudflare KV itself), so a shorter one is refused here with
 * a message that names the caller's own value instead of surfacing the Host's
 * bare `invalid_value`.
 */
export function resolveEdgeKvExpirationTtl(
  options?: { readonly expirationTtl?: number; readonly expiration?: number },
  now: () => number = nowSeconds,
): number | undefined {
  const ttl =
    options?.expirationTtl !== undefined
      ? options.expirationTtl
      : options?.expiration !== undefined
        ? Math.ceil(options.expiration - now())
        : undefined;
  if (ttl === undefined) return undefined;
  const seconds = Math.ceil(ttl);
  if (!Number.isSafeInteger(seconds)) {
    throw new EdgeKeyValueOptionError(
      `edge.kv: expiration resolves to ${ttl}, which is not a whole number of seconds`,
    );
  }
  if (seconds < EDGE_KV_MIN_EXPIRATION_TTL_SECONDS) {
    throw new EdgeKeyValueOptionError(
      `edge.kv: expiration resolves to ${seconds}s, under the ` +
        `${EDGE_KV_MIN_EXPIRATION_TTL_SECONDS}s floor both Takoserver and ` +
        `Cloudflare KV enforce; store a longer-lived entry or carry the ` +
        `deadline inside the value`,
    );
  }
  if (seconds > EDGE_KV_MAX_EXPIRATION_TTL_SECONDS) {
    throw new EdgeKeyValueOptionError(
      `edge.kv: expiration resolves to ${seconds}s, over the ` +
        `${EDGE_KV_MAX_EXPIRATION_TTL_SECONDS}s ceiling`,
    );
  }
  return seconds;
}

/**
 * The facade stores a record of STRINGS. The port's `Record<string, unknown>`
 * is therefore only usable when every value already is one; anything else is
 * refused rather than stringified, because a silent `String(value)` would round
 * -trip differently on the two lanes.
 */
function projectMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  if (metadata === undefined) return undefined;
  const projected: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value !== "string") {
      throw new EdgeKeyValueOptionError(
        `edge.kv: metadata."${key}" is ${typeof value}; the facade stores ` +
          `string values only`,
      );
    }
    projected[key] = value;
  }
  return projected;
}

async function toBytes(
  value: string | ArrayBuffer | ReadableStream,
): Promise<string | ArrayBuffer | Uint8Array> {
  if (typeof value === "string" || value instanceof ArrayBuffer) return value;
  return await readStream(value as ReadableStream<Uint8Array>);
}

export class EdgeKeyValueStore implements IKeyValueStore {
  constructor(
    private readonly kv: EdgeKvBinding,
    private readonly now: () => number = nowSeconds,
  ) {}

  get(key: string, options?: { type?: "text" }): Promise<string | null>;
  get<T = unknown>(key: string, options: { type: "json" }): Promise<T | null>;
  get(
    key: string,
    options: { type: "arrayBuffer" },
  ): Promise<ArrayBuffer | null>;
  async get(
    key: string,
    options?: { type?: "text" | "json" | "arrayBuffer" },
  ): Promise<string | ArrayBuffer | unknown | null> {
    const value = await this.kv.get(key);
    if (value === null) return null;
    const type = options?.type ?? "text";
    if (type === "arrayBuffer") return value;
    const text = new TextDecoder().decode(value);
    if (type === "json") {
      // Cloudflare KV returns null for a stored value that is not JSON; the
      // facade has no typed read, so the same tolerance is reproduced here
      // rather than turning a poisoned entry into a request failure.
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return null;
      }
    }
    return text;
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ReadableStream,
    options?: {
      expirationTtl?: number;
      expiration?: number;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const expirationTtlSeconds = resolveEdgeKvExpirationTtl(options, this.now);
    const metadata = projectMetadata(options?.metadata);
    const put: EdgeKvPutOptions = {
      ...(expirationTtlSeconds === undefined ? {} : { expirationTtlSeconds }),
      ...(metadata === undefined ? {} : { metadata }),
    };
    await this.kv.put(key, await toBytes(value), put);
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key);
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    keys: Array<{ name: string; expiration?: number; metadata?: unknown }>;
    list_complete: boolean;
    cursor?: string;
  }> {
    const result = await this.kv.list({
      ...(options?.prefix === undefined ? {} : { prefix: options.prefix }),
      ...(options?.cursor === undefined ? {} : { cursor: options.cursor }),
      ...(options?.limit === undefined ? {} : { limit: options.limit }),
    });
    return {
      keys: result.keys.map((entry) => ({ name: entry.name })),
      list_complete: result.listComplete,
      // The facade omits the cursor once the listing is complete; the port
      // says the same thing with `undefined`.
      cursor: result.listComplete ? undefined : result.cursor,
    };
  }
}

export function wrapEdgeKv(
  kv: EdgeKvBinding,
  now?: () => number,
): IKeyValueStore {
  return new EdgeKeyValueStore(kv, now);
}
