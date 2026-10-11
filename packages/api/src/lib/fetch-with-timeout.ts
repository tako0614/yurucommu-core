export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
export const UPLOAD_REQUEST_TIMEOUT_MS = 60_000;

export interface FetchWithTimeoutInit extends RequestInit {
  timeoutMs?: number;
}

const responseSignals = new WeakMap<Response, AbortSignal>();

/** Preserve a caller's abort reason even when a native body reader reports AbortError. */
export function throwIfResponseAborted(res: Response): void {
  responseSignals.get(res)?.throwIfAborted();
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: FetchWithTimeoutInit = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    signal: initSignal,
    ...rest
  } = init;
  const signal =
    initSignal === undefined && input instanceof Request
      ? input.signal
      : initSignal;
  signal?.throwIfAborted();

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    // Some native fetch implementations inherit Request.signal even when
    // init.signal is null. An explicit detached signal preserves the override.
    const fetchSignal = signal === null ? new AbortController().signal : signal;
    const res = await fetch(input, { ...rest, signal: fetchSignal });
    if (fetchSignal) responseSignals.set(res, fetchSignal);
    return res;
  }

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined;
  const cleanup = () => {
    if (timeoutId !== undefined) globalThis.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromSignal);
  };
  const abortFromSignal = () => {
    controller.abort(signal?.reason);
    cleanup();
  };
  signal?.addEventListener("abort", abortFromSignal, { once: true });
  timeoutId = globalThis.setTimeout(() => {
    controller.abort();
    cleanup();
  }, timeoutMs);
  // Browser timers are numbers. Node/Bun timers should not keep a completed
  // command alive solely to retire this bounded transport state.
  (timeoutId as unknown as { unref?: () => void }).unref?.();

  try {
    const res = await fetch(input, {
      ...rest,
      signal: controller.signal,
    });
    responseSignals.set(res, controller.signal);
    if (res.body === null) cleanup();
    // Keep the native Response (metadata, clone, opaque/null semantics). Native
    // Fetch aborts its body with this signal. Without owning every clone/reader,
    // we cannot infer completion: retain the timer/listener up to the deadline,
    // even when a caller consumes or cancels the body earlier.
    return res;
  } catch (error) {
    cleanup();
    throw error;
  }
}
