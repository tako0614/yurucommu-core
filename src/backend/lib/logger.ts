/**
 * Structured Logger for Yurucommu
 *
 * Zero-dependency structured logging compatible with all runtimes
 * (Cloudflare Workers, Node.js, Bun, Deno).
 *
 * - JSON output in production for observability pipelines
 * - Human-readable output in development
 * - Uses console.warn/console.error (ESLint-allowed) for warn/error levels
 * - Uses console.log (with eslint-disable) only for debug/info levels
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_NAMES = Object.fromEntries(
  Object.entries(LEVEL_ORDER).map(([k, v]) => [v, k]),
) as Record<number, LogLevel>;

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  service?: string;
  [key: string]: unknown;
}

export interface LoggerOptions {
  /** Service / component name attached to every entry */
  service?: string;
  /** Minimum log level (default: "debug") */
  level?: LogLevel;
  /** Extra fields merged into every entry */
  defaultFields?: Record<string, unknown>;
  /**
   * Output format.
   *  - "json"   : one JSON object per line (default, best for prod)
   *  - "pretty" : human-readable coloured output (best for dev)
   */
  format?: 'json' | 'pretty';
}

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  /** Create a child logger that inherits settings and merges extra fields */
  child(fields: Record<string, unknown>): Logger;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeError(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return { message: String(value) };
}

function formatData(
  data?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = value instanceof Error ? normalizeError(value) : value;
  }
  return result;
}

/** Detect whether we are likely running in a production environment. */
function detectProduction(): boolean {
  // Cloudflare Workers have no Deno/process – treat as production by default
  if (typeof Deno === 'undefined') return true;
  const env = Deno.env.get('NODE_ENV') || '';
  return env === 'production';
}

const PRETTY_LEVEL_TAG: Record<LogLevel, string> = {
  debug: 'DBG',
  info:  'INF',
  warn:  'WRN',
  error: 'ERR',
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** @internal */
interface InternalOptions extends LoggerOptions {
  _fields?: Record<string, unknown>;
}

class LoggerImpl implements Logger {
  private minLevel: number;
  private service?: string;
  private fields: Record<string, unknown>;
  private useJson: boolean;

  constructor(opts?: InternalOptions) {
    this.minLevel = LEVEL_ORDER[opts?.level ?? 'debug'];
    this.service = opts?.service;
    this.fields = { ...opts?.defaultFields, ...opts?._fields };

    if (opts?.format) {
      this.useJson = opts.format === 'json';
    } else {
      this.useJson = detectProduction();
    }
  }

  // ---- core emit ----------------------------------------------------------

  private emit(
    level: LogLevel,
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;

    if (this.useJson) {
      this.emitJson(level, msg, data);
    } else {
      this.emitPretty(level, msg, data);
    }
  }

  // ---- JSON output --------------------------------------------------------

  private emitJson(
    level: LogLevel,
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      level,
      msg,
      ts: new Date().toISOString(),
      ...(this.service ? { service: this.service } : {}),
      ...this.fields,
      ...formatData(data),
    };
    const line = JSON.stringify(entry);
    this.write(level, line);
  }

  // ---- Pretty output ------------------------------------------------------

  private emitPretty(
    level: LogLevel,
    msg: string,
    data?: Record<string, unknown>,
  ): void {
    const ts = new Date().toISOString();
    const tag = PRETTY_LEVEL_TAG[level];
    const svc = this.service ? ` [${this.service}]` : '';

    const merged = { ...this.fields, ...formatData(data) };
    const extra =
      Object.keys(merged).length > 0
        ? ' ' + JSON.stringify(merged)
        : '';

    const line = `${ts} ${tag}${svc} ${msg}${extra}`;
    this.write(level, line);
  }

  // ---- console dispatch ---------------------------------------------------

  private write(level: LogLevel, line: string): void {
    switch (level) {
      case 'debug':
      case 'info':
        // eslint-disable-next-line no-console
        console.log(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'error':
        console.error(line);
        break;
    }
  }

  // ---- public API ---------------------------------------------------------

  debug(msg: string, data?: Record<string, unknown>): void {
    this.emit('debug', msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.emit('info', msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.emit('warn', msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.emit('error', msg, data);
  }

  child(fields: Record<string, unknown>): Logger {
    return new LoggerImpl({
      level: LEVEL_NAMES[this.minLevel],
      service: this.service,
      format: this.useJson ? 'json' : 'pretty',
      _fields: { ...this.fields, ...fields },
    });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new logger instance.
 *
 * @example
 * ```ts
 * const log = createLogger({ service: 'activitypub', level: 'info' });
 * log.info('inbox received', { actorId: '...' });
 *
 * const childLog = log.child({ requestId: crypto.randomUUID() });
 * childLog.warn('signature verification slow', { durationMs: 430 });
 * ```
 */
export function createLogger(opts?: LoggerOptions): Logger {
  return new LoggerImpl(opts);
}

/**
 * Default logger instance for quick usage.
 * Service name defaults to "yurucommu".
 */
export const logger: Logger = createLogger({ service: 'yurucommu' });
