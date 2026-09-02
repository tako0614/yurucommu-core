/**
 * Which runtime the Worker was published onto, and the bindings that follow.
 *
 * The same bundle runs on two backends that look identical from inside:
 *
 *   `cloudflare`  — RAW Cloudflare bindings. `env.DB` is a `D1Database`,
 *                   `env.KV` a `KVNamespace`, `env.MEDIA` an `R2Bucket`,
 *                   `env.DELIVERY_QUEUE` a `Queue`. This is a Worker deployed
 *                   straight to Cloudflare, and equally an ordinary-Workers
 *                   Takoserver backend, which projects those same raw bindings.
 *   `portable`    — the PORTABLE FACADES. A wrapper host — a self-hosted
 *                   Takoserver, or a managed Workers-for-Platforms backend —
 *                   replaces `env` before the module sees it, and each binding
 *                   is the facade its Interface names: `edge.sql`, `edge.kv`,
 *                   `edge.objects`, `edge.queue`.
 *
 * THE LANE NAMES THE BINDING SHAPE, not the tool that published the Worker. A
 * deployment authored in Takoform lands on either one depending on the host it
 * targets, so the lane cannot be inferred from the IaC that produced it.
 *
 * THE LANE IS DECLARED, NOT SNIFFED. Two of the bindings cannot be told apart
 * by shape at all — `edge.kv` and `KVNamespace` expose the same five method
 * names, and both queue producers are `send`/`sendBatch`. A Worker that guessed
 * would call `kv.get(key, {type:"json"})` on a facade that ignores the second
 * argument and returns bytes, and the failure would surface much later as a
 * corrupt session or a rate-limit that never trips.
 *
 * So the lane comes from `YURUCOMMU_RUNTIME_LANE`, which a self-host or managed
 * Workers-for-Platforms deployment sets to `portable` and every raw-binding
 * deployment leaves unset (or `cloudflare`). The declaration is then
 * cross-checked against the bindings that ARE decisive — `DB` always, `MEDIA`
 * when it is bound. A disagreement refuses to start.
 */

import type {
  D1Database,
  Fetcher,
  KVNamespace,
  MessageBatch,
  Queue,
  R2Bucket,
} from "@cloudflare/workers-types";

import type { Database } from "../../db/index.ts";
import {
  isEdgeObjectsBinding,
  isEdgeQueueBatch,
  isEdgeSqlBinding,
  isNativeD1Database,
  isNativeR2Bucket,
  type EdgeKvBinding,
  type EdgeObjectsBinding,
  type EdgeQueueBatch,
  type EdgeQueueBinding,
  type EdgeSqlBinding,
} from "./edge-facades.ts";
import { createEdgeSqlDatabase } from "./edge-sql.ts";
import { wrapEdgeKv } from "./edge-kv.ts";
import { wrapEdgeMessageBatch, wrapEdgeQueue } from "./edge-queue.ts";
import { wrapEdgeObjects } from "./edge-objects.ts";
import {
  wrapCloudflareBindings,
  wrapCloudflareMessageBatch,
} from "./cloudflare.ts";
import type { IKeyValueStore, IObjectStorage, IStaticAssets } from "./types.ts";
import type { IQueueBatch, IQueueProducer } from "./queue.ts";

/** The variable that names the lane. Set it in the deployment's plain vars. */
export const RUNTIME_LANE_VAR = "YURUCOMMU_RUNTIME_LANE";

/** Every lane this build knows how to run on. */
export const RUNTIME_LANES = ["cloudflare", "portable"] as const;

export type RuntimeLane = (typeof RUNTIME_LANES)[number];

/** The lane when the variable is absent: a plain Cloudflare Worker. */
export const DEFAULT_RUNTIME_LANE: RuntimeLane = "cloudflare";

/** The declared lane is unknown, or disagrees with the bindings that arrived. */
export class RuntimeLaneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeLaneError";
  }
}

/**
 * Read the declared lane.
 *
 * An unset variable is the Cloudflare lane, because that is what a Worker
 * deployed without Takoform is. An UNRECOGNISED value is refused rather than
 * defaulted: a future Host that names a lane this build has never heard of must
 * not be served by guessing that its bindings are Cloudflare's.
 */
export function resolveRuntimeLane(declared: unknown): RuntimeLane {
  if (declared === undefined || declared === null || declared === "") {
    return DEFAULT_RUNTIME_LANE;
  }
  if (typeof declared !== "string") {
    throw new RuntimeLaneError(
      `${RUNTIME_LANE_VAR} must be a string; received ${typeof declared}`,
    );
  }
  const lane = declared.trim();
  if ((RUNTIME_LANES as readonly string[]).includes(lane)) {
    return lane as RuntimeLane;
  }
  throw new RuntimeLaneError(
    `${RUNTIME_LANE_VAR}="${declared}" is not a runtime lane this build ` +
      `supports (${RUNTIME_LANES.join(", ")}). Refusing to start rather than ` +
      `assume a binding shape.`,
  );
}

interface LaneBindings {
  readonly DB?: unknown;
  readonly MEDIA?: unknown;
}

/**
 * Prove the declared lane against the bindings that can actually be identified.
 *
 * `DB` is always decisive: `execute`/`query`/`transaction` and
 * `prepare`/`batch` are disjoint. `MEDIA` is decisive only in one direction —
 * an `R2Bucket` is recognisable by its multipart helpers, whereas a plain
 * five-method object could be the facade or an adapter a host repository
 * supplied — so only the direction that can be proven is checked.
 */
export function assertRuntimeLaneBindings(
  lane: RuntimeLane,
  bindings: LaneBindings,
): void {
  const { DB, MEDIA } = bindings;
  if (lane === "portable") {
    if (isNativeD1Database(DB)) {
      throw new RuntimeLaneError(
        `${RUNTIME_LANE_VAR}="portable" declares the portable-facade lane, ` +
          `but env.DB is a native D1Database (prepare/batch). A host that ` +
          `projects raw Cloudflare bindings — including an ordinary-Workers ` +
          `Takoserver backend — is the cloudflare lane; leave the variable ` +
          `unset there.`,
      );
    }
    if (!isEdgeSqlBinding(DB)) {
      throw new RuntimeLaneError(
        `${RUNTIME_LANE_VAR}="portable" requires env.DB to be the ` +
          `edge.sql@1.0.0 facade (execute/query/transaction); it exposes ` +
          `neither that nor D1's prepare/batch.`,
      );
    }
    if (MEDIA !== undefined && isNativeR2Bucket(MEDIA)) {
      throw new RuntimeLaneError(
        `${RUNTIME_LANE_VAR}="portable" declares the portable-facade lane, ` +
          `but env.MEDIA is a native R2Bucket. A portable bucket binding ` +
          `arrives as the edge.objects@1.0.0 facade.`,
      );
    }
    return;
  }
  if (isEdgeSqlBinding(DB)) {
    throw new RuntimeLaneError(
      `env.DB is the edge.sql@1.0.0 facade (execute/query/transaction), but ` +
        `${RUNTIME_LANE_VAR} does not declare the portable lane. A Worker on a ` +
        `wrapper host must declare it; without that this build would hand the ` +
        `facade to drizzle-orm/d1 and every query would fail at the first ` +
        `prepare().`,
    );
  }
  if (!isNativeD1Database(DB)) {
    throw new RuntimeLaneError(
      `env.DB is neither a D1Database nor the edge.sql@1.0.0 facade; the ` +
        `Cloudflare lane cannot build a database client from it.`,
    );
  }
}

/** Bindings a Worker receives from a host that projects portable facades. */
export interface PortableWorkerBindings {
  DB: EdgeSqlBinding;
  KV: EdgeKvBinding;
  MEDIA?: EdgeObjectsBinding;
  ASSETS?: IStaticAssets;
  DELIVERY_QUEUE?: EdgeQueueBinding;
  DELIVERY_DLQ?: EdgeQueueBinding;
}

/** Bindings a Worker deployed straight to Cloudflare receives. */
export interface CloudflareWorkerBindings {
  DB: D1Database;
  KV: KVNamespace;
  MEDIA?: R2Bucket;
  ASSETS?: Fetcher;
  DELIVERY_QUEUE?: Queue<unknown>;
  DELIVERY_DLQ?: Queue<unknown>;
}

type WrappedRuntime<T> = Omit<
  T,
  "DB" | "MEDIA" | "KV" | "ASSETS" | "DELIVERY_QUEUE" | "DELIVERY_DLQ"
> & {
  DB_INSTANCE: Database;
  MEDIA?: IObjectStorage;
  KV: IKeyValueStore;
  ASSETS?: IStaticAssets;
  DELIVERY_QUEUE?: IQueueProducer<unknown>;
  DELIVERY_DLQ?: IQueueProducer<unknown>;
};

/**
 * Wrap the portable facades into the runtime ports the app speaks.
 *
 * `ASSETS` passes through: a Takoform `external_services` entry is projected as
 * a `{fetch}` adapter, which is already the port's whole surface.
 */
export function wrapPortableBindings<T extends PortableWorkerBindings>(
  bindings: T,
): WrappedRuntime<T> {
  const { DB, MEDIA, KV, ASSETS, DELIVERY_QUEUE, DELIVERY_DLQ, ...rest } =
    bindings;
  return {
    ...rest,
    DB_INSTANCE: createEdgeSqlDatabase(DB),
    MEDIA: MEDIA ? wrapEdgeObjects(MEDIA) : undefined,
    KV: wrapEdgeKv(KV),
    ASSETS,
    DELIVERY_QUEUE: DELIVERY_QUEUE ? wrapEdgeQueue(DELIVERY_QUEUE) : undefined,
    DELIVERY_DLQ: DELIVERY_DLQ ? wrapEdgeQueue(DELIVERY_DLQ) : undefined,
  } as unknown as WrappedRuntime<T>;
}

/**
 * The single entry point a Worker should call.
 *
 * Reads {@link RUNTIME_LANE_VAR} off the bindings themselves — on both lanes it
 * is an ordinary plain-text variable that arrives alongside them — proves the
 * lane against the decisive bindings, and then wraps.
 */
export function wrapRuntimeBindings<
  // Deliberately structural. Which of the two binding sets this actually is,
  // is the runtime question this function answers; a static union here would
  // only force every caller to assert the answer before asking it.
  T extends { DB: unknown; KV: unknown },
>(bindings: T): WrappedRuntime<T> {
  const lane = resolveRuntimeLane(
    (bindings as Record<string, unknown>)[RUNTIME_LANE_VAR],
  );
  assertRuntimeLaneBindings(lane, bindings as LaneBindings);
  return lane === "portable"
    ? (wrapPortableBindings(
        bindings as unknown as PortableWorkerBindings,
      ) as unknown as WrappedRuntime<T>)
    : (wrapCloudflareBindings(
        bindings as unknown as CloudflareWorkerBindings & {
          DB: D1Database;
          KV: KVNamespace;
        },
      ) as unknown as WrappedRuntime<T>);
}

/**
 * Adapt one consumer batch for whichever lane produced it.
 *
 * A queue batch IS decisive — the facade settles with `acknowledgeAll`, the
 * Cloudflare `MessageBatch` with `ackAll` — so the shape is checked against the
 * declared lane rather than trusted on its own.
 */
export function wrapRuntimeMessageBatch<T>(
  batch: MessageBatch<T> | EdgeQueueBatch,
  lane: RuntimeLane = DEFAULT_RUNTIME_LANE,
): IQueueBatch<T> {
  const isFacade = isEdgeQueueBatch(batch);
  if (lane === "portable") {
    if (!isFacade) {
      throw new RuntimeLaneError(
        `${RUNTIME_LANE_VAR}="portable" declares the portable-facade lane, ` +
          `but the queue event is a Cloudflare MessageBatch (ackAll).`,
      );
    }
    return wrapEdgeMessageBatch<T>(batch);
  }
  if (isFacade) {
    throw new RuntimeLaneError(
      `The queue event is a portable-facade batch (acknowledgeAll), but ` +
        `${RUNTIME_LANE_VAR} does not declare the portable lane.`,
    );
  }
  return wrapCloudflareMessageBatch(batch as MessageBatch<T>);
}

/** Re-exported so a Worker entry can probe MEDIA without importing internals. */
export { isEdgeObjectsBinding };
