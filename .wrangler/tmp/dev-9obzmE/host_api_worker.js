var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/_internal/utils.mjs
// @__NO_SIDE_EFFECTS__
function createNotImplementedError(name) {
  return new Error(`[unenv] ${name} is not implemented yet!`);
}
__name(createNotImplementedError, "createNotImplementedError");
// @__NO_SIDE_EFFECTS__
function notImplemented(name) {
  const fn = /* @__PURE__ */ __name(() => {
    throw /* @__PURE__ */ createNotImplementedError(name);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
__name(notImplemented, "notImplemented");
// @__NO_SIDE_EFFECTS__
function notImplementedClass(name) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name} is not implemented yet!`);
    }
  };
}
__name(notImplementedClass, "notImplementedClass");

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
var _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
var nodeTiming = {
  name: "node",
  entryType: "node",
  startTime: 0,
  duration: 0,
  nodeStart: 0,
  v8Start: 0,
  bootstrapComplete: 0,
  environment: 0,
  loopStart: 0,
  loopExit: 0,
  idleTime: 0,
  uvMetricsInfo: {
    loopCount: 0,
    events: 0,
    eventsWaiting: 0
  },
  detail: void 0,
  toJSON() {
    return this;
  }
};
var PerformanceEntry = class {
  static {
    __name(this, "PerformanceEntry");
  }
  __unenv__ = true;
  detail;
  entryType = "event";
  name;
  startTime;
  constructor(name, options) {
    this.name = name;
    this.startTime = options?.startTime || _performanceNow();
    this.detail = options?.detail;
  }
  get duration() {
    return _performanceNow() - this.startTime;
  }
  toJSON() {
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail
    };
  }
};
var PerformanceMark = class PerformanceMark2 extends PerformanceEntry {
  static {
    __name(this, "PerformanceMark");
  }
  entryType = "mark";
  constructor() {
    super(...arguments);
  }
  get duration() {
    return 0;
  }
};
var PerformanceMeasure = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceMeasure");
  }
  entryType = "measure";
};
var PerformanceResourceTiming = class extends PerformanceEntry {
  static {
    __name(this, "PerformanceResourceTiming");
  }
  entryType = "resource";
  serverTiming = [];
  connectEnd = 0;
  connectStart = 0;
  decodedBodySize = 0;
  domainLookupEnd = 0;
  domainLookupStart = 0;
  encodedBodySize = 0;
  fetchStart = 0;
  initiatorType = "";
  name = "";
  nextHopProtocol = "";
  redirectEnd = 0;
  redirectStart = 0;
  requestStart = 0;
  responseEnd = 0;
  responseStart = 0;
  secureConnectionStart = 0;
  startTime = 0;
  transferSize = 0;
  workerStart = 0;
  responseStatus = 0;
};
var PerformanceObserverEntryList = class {
  static {
    __name(this, "PerformanceObserverEntryList");
  }
  __unenv__ = true;
  getEntries() {
    return [];
  }
  getEntriesByName(_name, _type) {
    return [];
  }
  getEntriesByType(type) {
    return [];
  }
};
var Performance = class {
  static {
    __name(this, "Performance");
  }
  __unenv__ = true;
  timeOrigin = _timeOrigin;
  eventCounts = /* @__PURE__ */ new Map();
  _entries = [];
  _resourceTimingBufferSize = 0;
  navigation = void 0;
  timing = void 0;
  timerify(_fn, _options) {
    throw createNotImplementedError("Performance.timerify");
  }
  get nodeTiming() {
    return nodeTiming;
  }
  eventLoopUtilization() {
    return {};
  }
  markResourceTiming() {
    return new PerformanceResourceTiming("");
  }
  onresourcetimingbufferfull = null;
  now() {
    if (this.timeOrigin === _timeOrigin) {
      return _performanceNow();
    }
    return Date.now() - this.timeOrigin;
  }
  clearMarks(markName) {
    this._entries = markName ? this._entries.filter((e) => e.name !== markName) : this._entries.filter((e) => e.entryType !== "mark");
  }
  clearMeasures(measureName) {
    this._entries = measureName ? this._entries.filter((e) => e.name !== measureName) : this._entries.filter((e) => e.entryType !== "measure");
  }
  clearResourceTimings() {
    this._entries = this._entries.filter((e) => e.entryType !== "resource" || e.entryType !== "navigation");
  }
  getEntries() {
    return this._entries;
  }
  getEntriesByName(name, type) {
    return this._entries.filter((e) => e.name === name && (!type || e.entryType === type));
  }
  getEntriesByType(type) {
    return this._entries.filter((e) => e.entryType === type);
  }
  mark(name, options) {
    const entry = new PerformanceMark(name, options);
    this._entries.push(entry);
    return entry;
  }
  measure(measureName, startOrMeasureOptions, endMark) {
    let start;
    let end;
    if (typeof startOrMeasureOptions === "string") {
      start = this.getEntriesByName(startOrMeasureOptions, "mark")[0]?.startTime;
      end = this.getEntriesByName(endMark, "mark")[0]?.startTime;
    } else {
      start = Number.parseFloat(startOrMeasureOptions?.start) || this.now();
      end = Number.parseFloat(startOrMeasureOptions?.end) || this.now();
    }
    const entry = new PerformanceMeasure(measureName, {
      startTime: start,
      detail: {
        start,
        end
      }
    });
    this._entries.push(entry);
    return entry;
  }
  setResourceTimingBufferSize(maxSize) {
    this._resourceTimingBufferSize = maxSize;
  }
  addEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.addEventListener");
  }
  removeEventListener(type, listener, options) {
    throw createNotImplementedError("Performance.removeEventListener");
  }
  dispatchEvent(event) {
    throw createNotImplementedError("Performance.dispatchEvent");
  }
  toJSON() {
    return this;
  }
};
var PerformanceObserver = class {
  static {
    __name(this, "PerformanceObserver");
  }
  __unenv__ = true;
  static supportedEntryTypes = [];
  _callback = null;
  constructor(callback) {
    this._callback = callback;
  }
  takeRecords() {
    return [];
  }
  disconnect() {
    throw createNotImplementedError("PerformanceObserver.disconnect");
  }
  observe(options) {
    throw createNotImplementedError("PerformanceObserver.observe");
  }
  bind(fn) {
    return fn;
  }
  runInAsyncScope(fn, thisArg, ...args) {
    return fn.call(thisArg, ...args);
  }
  asyncId() {
    return 0;
  }
  triggerAsyncId() {
    return 0;
  }
  emitDestroy() {
    return this;
  }
};
var performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
globalThis.performance = performance;
globalThis.Performance = Performance;
globalThis.PerformanceEntry = PerformanceEntry;
globalThis.PerformanceMark = PerformanceMark;
globalThis.PerformanceMeasure = PerformanceMeasure;
globalThis.PerformanceObserver = PerformanceObserver;
globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
globalThis.PerformanceResourceTiming = PerformanceResourceTiming;

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default = Object.assign(() => {
}, { __unenv__: true });

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/console.mjs
var _console = globalThis.console;
var _ignoreErrors = true;
var _stderr = new Writable();
var _stdout = new Writable();
var log = _console?.log ?? noop_default;
var info = _console?.info ?? log;
var trace = _console?.trace ?? info;
var debug = _console?.debug ?? log;
var table = _console?.table ?? log;
var error = _console?.error ?? log;
var warn = _console?.warn ?? error;
var createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
var clear = _console?.clear ?? noop_default;
var count = _console?.count ?? noop_default;
var countReset = _console?.countReset ?? noop_default;
var dir = _console?.dir ?? noop_default;
var dirxml = _console?.dirxml ?? noop_default;
var group = _console?.group ?? noop_default;
var groupEnd = _console?.groupEnd ?? noop_default;
var groupCollapsed = _console?.groupCollapsed ?? noop_default;
var profile = _console?.profile ?? noop_default;
var profileEnd = _console?.profileEnd ?? noop_default;
var time = _console?.time ?? noop_default;
var timeEnd = _console?.timeEnd ?? noop_default;
var timeLog = _console?.timeLog ?? noop_default;
var timeStamp = _console?.timeStamp ?? noop_default;
var Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
var _times = /* @__PURE__ */ new Map();
var _stdoutErrorHandler = noop_default;
var _stderrErrorHandler = noop_default;

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole = globalThis["console"];
var {
  assert,
  clear: clear2,
  // @ts-expect-error undocumented public API
  context,
  count: count2,
  countReset: countReset2,
  // @ts-expect-error undocumented public API
  createTask: createTask2,
  debug: debug2,
  dir: dir2,
  dirxml: dirxml2,
  error: error2,
  group: group2,
  groupCollapsed: groupCollapsed2,
  groupEnd: groupEnd2,
  info: info2,
  log: log2,
  profile: profile2,
  profileEnd: profileEnd2,
  table: table2,
  time: time2,
  timeEnd: timeEnd2,
  timeLog: timeLog2,
  timeStamp: timeStamp2,
  trace: trace2,
  warn: warn2
} = workerdConsole;
Object.assign(workerdConsole, {
  Console,
  _ignoreErrors,
  _stderr,
  _stderrErrorHandler,
  _stdout,
  _stdoutErrorHandler,
  _times
});
var console_default = workerdConsole;

// ../../../AppData/Roaming/npm/node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
globalThis.console = console_default;

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
  const now2 = Date.now();
  const seconds = Math.trunc(now2 / 1e3);
  const nanos = now2 % 1e3 * 1e6;
  if (startTime) {
    let diffSeconds = seconds - startTime[0];
    let diffNanos = nanos - startTime[0];
    if (diffNanos < 0) {
      diffSeconds = diffSeconds - 1;
      diffNanos = 1e9 + diffNanos;
    }
    return [diffSeconds, diffNanos];
  }
  return [seconds, nanos];
}, "hrtime"), { bigint: /* @__PURE__ */ __name(function bigint() {
  return BigInt(Date.now() * 1e6);
}, "bigint") });

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
var WriteStream = class {
  static {
    __name(this, "WriteStream");
  }
  fd;
  columns = 80;
  rows = 24;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  clearLine(dir3, callback) {
    callback && callback();
    return false;
  }
  clearScreenDown(callback) {
    callback && callback();
    return false;
  }
  cursorTo(x, y, callback) {
    callback && typeof callback === "function" && callback();
    return false;
  }
  moveCursor(dx, dy, callback) {
    callback && callback();
    return false;
  }
  getColorDepth(env2) {
    return 1;
  }
  hasColors(count3, env2) {
    return false;
  }
  getWindowSize() {
    return [this.columns, this.rows];
  }
  write(str, encoding, cb) {
    if (str instanceof Uint8Array) {
      str = new TextDecoder().decode(str);
    }
    try {
      console.log(str);
    } catch {
    }
    cb && typeof cb === "function" && cb();
    return false;
  }
};

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
var ReadStream = class {
  static {
    __name(this, "ReadStream");
  }
  fd;
  isRaw = false;
  isTTY = false;
  constructor(fd) {
    this.fd = fd;
  }
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  }
};

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/node-version.mjs
var NODE_VERSION = "22.14.0";

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/unenv/dist/runtime/node/internal/process/process.mjs
var Process = class _Process extends EventEmitter {
  static {
    __name(this, "Process");
  }
  env;
  hrtime;
  nextTick;
  constructor(impl) {
    super();
    this.env = impl.env;
    this.hrtime = impl.hrtime;
    this.nextTick = impl.nextTick;
    for (const prop of [...Object.getOwnPropertyNames(_Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
      const value = this[prop];
      if (typeof value === "function") {
        this[prop] = value.bind(this);
      }
    }
  }
  // --- event emitter ---
  emitWarning(warning, type, code) {
    console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
  }
  emit(...args) {
    return super.emit(...args);
  }
  listeners(eventName) {
    return super.listeners(eventName);
  }
  // --- stdio (lazy initializers) ---
  #stdin;
  #stdout;
  #stderr;
  get stdin() {
    return this.#stdin ??= new ReadStream(0);
  }
  get stdout() {
    return this.#stdout ??= new WriteStream(1);
  }
  get stderr() {
    return this.#stderr ??= new WriteStream(2);
  }
  // --- cwd ---
  #cwd = "/";
  chdir(cwd2) {
    this.#cwd = cwd2;
  }
  cwd() {
    return this.#cwd;
  }
  // --- dummy props and getters ---
  arch = "";
  platform = "";
  argv = [];
  argv0 = "";
  execArgv = [];
  execPath = "";
  title = "";
  pid = 200;
  ppid = 100;
  get version() {
    return `v${NODE_VERSION}`;
  }
  get versions() {
    return { node: NODE_VERSION };
  }
  get allowedNodeEnvironmentFlags() {
    return /* @__PURE__ */ new Set();
  }
  get sourceMapsEnabled() {
    return false;
  }
  get debugPort() {
    return 0;
  }
  get throwDeprecation() {
    return false;
  }
  get traceDeprecation() {
    return false;
  }
  get features() {
    return {};
  }
  get release() {
    return {};
  }
  get connected() {
    return false;
  }
  get config() {
    return {};
  }
  get moduleLoadList() {
    return [];
  }
  constrainedMemory() {
    return 0;
  }
  availableMemory() {
    return 0;
  }
  uptime() {
    return 0;
  }
  resourceUsage() {
    return {};
  }
  // --- noop methods ---
  ref() {
  }
  unref() {
  }
  // --- unimplemented methods ---
  umask() {
    throw createNotImplementedError("process.umask");
  }
  getBuiltinModule() {
    return void 0;
  }
  getActiveResourcesInfo() {
    throw createNotImplementedError("process.getActiveResourcesInfo");
  }
  exit() {
    throw createNotImplementedError("process.exit");
  }
  reallyExit() {
    throw createNotImplementedError("process.reallyExit");
  }
  kill() {
    throw createNotImplementedError("process.kill");
  }
  abort() {
    throw createNotImplementedError("process.abort");
  }
  dlopen() {
    throw createNotImplementedError("process.dlopen");
  }
  setSourceMapsEnabled() {
    throw createNotImplementedError("process.setSourceMapsEnabled");
  }
  loadEnvFile() {
    throw createNotImplementedError("process.loadEnvFile");
  }
  disconnect() {
    throw createNotImplementedError("process.disconnect");
  }
  cpuUsage() {
    throw createNotImplementedError("process.cpuUsage");
  }
  setUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.setUncaughtExceptionCaptureCallback");
  }
  hasUncaughtExceptionCaptureCallback() {
    throw createNotImplementedError("process.hasUncaughtExceptionCaptureCallback");
  }
  initgroups() {
    throw createNotImplementedError("process.initgroups");
  }
  openStdin() {
    throw createNotImplementedError("process.openStdin");
  }
  assert() {
    throw createNotImplementedError("process.assert");
  }
  binding() {
    throw createNotImplementedError("process.binding");
  }
  // --- attached interfaces ---
  permission = { has: /* @__PURE__ */ notImplemented("process.permission.has") };
  report = {
    directory: "",
    filename: "",
    signal: "SIGUSR2",
    compact: false,
    reportOnFatalError: false,
    reportOnSignal: false,
    reportOnUncaughtException: false,
    getReport: /* @__PURE__ */ notImplemented("process.report.getReport"),
    writeReport: /* @__PURE__ */ notImplemented("process.report.writeReport")
  };
  finalization = {
    register: /* @__PURE__ */ notImplemented("process.finalization.register"),
    unregister: /* @__PURE__ */ notImplemented("process.finalization.unregister"),
    registerBeforeExit: /* @__PURE__ */ notImplemented("process.finalization.registerBeforeExit")
  };
  memoryUsage = Object.assign(() => ({
    arrayBuffers: 0,
    rss: 0,
    external: 0,
    heapTotal: 0,
    heapUsed: 0
  }), { rss: /* @__PURE__ */ __name(() => 0, "rss") });
  // --- undefined props ---
  mainModule = void 0;
  domain = void 0;
  // optional
  send = void 0;
  exitCode = void 0;
  channel = void 0;
  getegid = void 0;
  geteuid = void 0;
  getgid = void 0;
  getgroups = void 0;
  getuid = void 0;
  setegid = void 0;
  seteuid = void 0;
  setgid = void 0;
  setgroups = void 0;
  setuid = void 0;
  // internals
  _events = void 0;
  _eventsCount = void 0;
  _exiting = void 0;
  _maxListeners = void 0;
  _debugEnd = void 0;
  _debugProcess = void 0;
  _fatalException = void 0;
  _getActiveHandles = void 0;
  _getActiveRequests = void 0;
  _kill = void 0;
  _preload_modules = void 0;
  _rawDebug = void 0;
  _startProfilerIdleNotifier = void 0;
  _stopProfilerIdleNotifier = void 0;
  _tickCallback = void 0;
  _disconnect = void 0;
  _handleQueue = void 0;
  _pendingMessage = void 0;
  _channel = void 0;
  _send = void 0;
  _linkedBinding = void 0;
};

// ../../../AppData/Roaming/npm/node_modules/wrangler/node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess = globalThis["process"];
var getBuiltinModule = globalProcess.getBuiltinModule;
var { exit, platform, nextTick } = getBuiltinModule(
  "node:process"
);
var unenvProcess = new Process({
  env: globalProcess.env,
  hrtime,
  nextTick
});
var {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  finalization,
  features,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  on,
  off,
  once,
  pid,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
} = unenvProcess;
var _process = {
  abort,
  addListener,
  allowedNodeEnvironmentFlags,
  hasUncaughtExceptionCaptureCallback,
  setUncaughtExceptionCaptureCallback,
  loadEnvFile,
  sourceMapsEnabled,
  arch,
  argv,
  argv0,
  chdir,
  config,
  connected,
  constrainedMemory,
  availableMemory,
  cpuUsage,
  cwd,
  debugPort,
  dlopen,
  disconnect,
  emit,
  emitWarning,
  env,
  eventNames,
  execArgv,
  execPath,
  exit,
  finalization,
  features,
  getBuiltinModule,
  getActiveResourcesInfo,
  getMaxListeners,
  hrtime: hrtime3,
  kill,
  listeners,
  listenerCount,
  memoryUsage,
  nextTick,
  on,
  off,
  once,
  pid,
  platform,
  ppid,
  prependListener,
  prependOnceListener,
  rawListeners,
  release,
  removeAllListeners,
  removeListener,
  report,
  resourceUsage,
  setMaxListeners,
  setSourceMapsEnabled,
  stderr,
  stdin,
  stdout,
  title,
  throwDeprecation,
  traceDeprecation,
  umask,
  uptime,
  version,
  versions,
  // @ts-expect-error old API
  domain,
  initgroups,
  moduleLoadList,
  reallyExit,
  openStdin,
  assert: assert2,
  binding,
  send,
  exitCode,
  channel,
  getegid,
  geteuid,
  getgid,
  getgroups,
  getuid,
  setegid,
  seteuid,
  setgid,
  setgroups,
  setuid,
  permission,
  mainModule,
  _events,
  _eventsCount,
  _exiting,
  _maxListeners,
  _debugEnd,
  _debugProcess,
  _fatalException,
  _getActiveHandles,
  _getActiveRequests,
  _kill,
  _preload_modules,
  _rawDebug,
  _startProfilerIdleNotifier,
  _stopProfilerIdleNotifier,
  _tickCallback,
  _disconnect,
  _handleQueue,
  _pendingMessage,
  _channel,
  _send,
  _linkedBinding
};
var process_default = _process;

// ../../../AppData/Roaming/npm/node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
globalThis.process = process_default;

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context2, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context2.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context2, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context2.error = err;
            res = await onError(err, context2);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context2.finalized === false && onNotFound) {
          res = await onNotFound(context2);
        }
      }
      if (res && (context2.finalized === false || isError)) {
        context2.res = res;
      }
      return context2;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = Symbol();

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/utils/body.js
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value) => {
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match, index) => {
    const mark = `@${index}`;
    groups.push([mark, match]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match[1], new RegExp(`^${match[2]}(?=/${next})`)] : [label, match[1], new RegExp(`^${match[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
      try {
        return decoder(match);
      } catch {
        return match;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf(
    "/",
    url.charCodeAt(9) === 58 ? 13 : 8
  );
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const path = url.slice(start, queryIndex === -1 ? void 0 : queryIndex);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63) {
      break;
    }
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf(`?${key}`, 8);
    if (keyIndex2 === -1) {
      keyIndex2 = url.indexOf(`&${key}`, 8);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  raw;
  #validatedData;
  #matchResult;
  routeIndex = 0;
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param ? /\%/.test(param) ? tryDecodeURIComponent(param) : param : void 0;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value && typeof value === "string") {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return this.bodyCache.parsedBody ??= await parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  text() {
    return this.#cachedBody("text");
  }
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  blob() {
    return this.#cachedBody("blob");
  }
  formData() {
    return this.#cachedBody("formData");
  }
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  get url() {
    return this.raw.url;
  }
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context2, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context: context2 }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context2, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  env = {};
  #var;
  finalized = false;
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  get res() {
    return this.#res ||= new Response(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  set res(_res) {
    if (this.#res && _res) {
      _res = new Response(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized) {
      this.#res = new Response(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return new Response(data, { status, headers: responseHeaders });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  }, "text");
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => new Response();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class {
  static {
    __name(this, "Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  router;
  getPath;
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  errorHandler = errorHandler;
  route(path, app) {
    const subApp = this.basePath(path);
    app.routes.map((r) => {
      let handler;
      if (app.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env2, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env2, "GET")))();
    }
    const path = this.getPath(request, { env: env2 });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env: env2,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context2 = await composed(c);
        if (!context2.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context2.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  }, "request");
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class {
  static {
    __name(this, "Node");
  }
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context2, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new Node();
        if (name !== "") {
          node.#varIndex = context2.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new Node();
      }
    }
    node.insert(restTokens, index, paramMap, context2, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/router/reg-exp-router/router.js
var emptyParam = [];
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
__name(clearWildcardRegExpCache, "clearWildcardRegExpCache");
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
__name(buildMatcherFromPreprocessedRoutes, "buildMatcherFromPreprocessedRoutes");
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match(method, path) {
    clearWildcardRegExpCache();
    const matchers = this.#buildAllMatchers();
    this.match = (method2, path2) => {
      const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
      const staticMatch = matcher[2][path2];
      if (staticMatch) {
        return staticMatch;
      }
      const match = path2.match(matcher[0]);
      if (!match) {
        return [[], emptyParam];
      }
      const index = match.indexOf("", 1);
      return [matcher[1][index], match];
    };
    return this.match(method, path);
  }
  #buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var Node2 = class {
  static {
    __name(this, "Node");
  }
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #getHandlerSets(node, method, nodeParams, params) {
    const handlerSets = [];
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
    return handlerSets;
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              handlerSets.push(
                ...this.#getHandlerSets(nextNode.#children["*"], method, node.#params)
              );
            }
            handlerSets.push(...this.#getHandlerSets(nextNode, method, node.#params));
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              handlerSets.push(...this.#getHandlerSets(astNode, method, node.#params));
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          const restPathString = parts.slice(i).join("/");
          if (matcher instanceof RegExp) {
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              handlerSets.push(...this.#getHandlerSets(child, method, node.#params, params));
              if (Object.keys(child.#children).length) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              handlerSets.push(...this.#getHandlerSets(child, method, params, node.#params));
              if (child.#children["*"]) {
                handlerSets.push(
                  ...this.#getHandlerSets(child.#children["*"], method, params, node.#params)
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      curNodes = tempNodes.concat(curNodesQueue.shift() ?? []);
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// app/takos_host/node_modules/.deno/hono@4.9.1/node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// app/core/db/mod.ts
var storeFactory;
function setStoreFactory(f) {
  storeFactory = f;
}
__name(setStoreFactory, "setStoreFactory");

// app/takos_host/db/d1_store.ts
function notImplemented2(name) {
  throw new Error(`D1 store does not implement: ${name}`);
}
__name(notImplemented2, "notImplemented");
function now() {
  return Date.now();
}
__name(now, "now");
function toBool(v) {
  return v === 1 || v === true || v === "1";
}
__name(toBool, "toBool");
function json(v) {
  if (v == null) return void 0;
  try {
    return JSON.parse(String(v));
  } catch {
    return void 0;
  }
}
__name(json, "json");
function createR2Storage(env2) {
  const bucketName = env2["R2_BUCKET"];
  const binding2 = bucketName ? globalThis[bucketName] : void 0;
  const bucket = binding2;
  if (!bucket) {
    return {
      async put(_key, _data) {
        return "";
      },
      async get(_key) {
        return null;
      },
      async delete(_key) {
      }
    };
  }
  return {
    async put(key, data) {
      await bucket.put(key, data);
      return key;
    },
    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;
      const buf = await obj.arrayBuffer();
      return new Uint8Array(buf);
    },
    async delete(key) {
      await bucket.delete(key);
    }
  };
}
__name(createR2Storage, "createR2Storage");
function createD1DataStore(env2, d1, options) {
  const tenantId = options?.tenantId ?? env2["ACTIVITYPUB_DOMAIN"] ?? "";
  const storage = env2["OBJECT_STORAGE_PROVIDER"]?.toLowerCase() === "r2" ? createR2Storage(env2) : {
    async put() {
      return "";
    },
    async get() {
      return null;
    },
    async delete() {
    }
  };
  return {
    storage,
    multiTenant: options?.multiTenant === true,
    tenantId,
    // -------------- コア側は未実装（使用禁止） --------------
    accounts: {
      list: /* @__PURE__ */ __name(() => notImplemented2("accounts.list"), "list"),
      create: /* @__PURE__ */ __name(() => notImplemented2("accounts.create"), "create"),
      findById: /* @__PURE__ */ __name(() => notImplemented2("accounts.findById"), "findById"),
      findByUserName: /* @__PURE__ */ __name(() => notImplemented2("accounts.findByUserName"), "findByUserName"),
      updateById: /* @__PURE__ */ __name(() => notImplemented2("accounts.updateById"), "updateById"),
      deleteById: /* @__PURE__ */ __name(() => notImplemented2("accounts.deleteById"), "deleteById"),
      addFollower: /* @__PURE__ */ __name(() => notImplemented2("accounts.addFollower"), "addFollower"),
      removeFollower: /* @__PURE__ */ __name(() => notImplemented2("accounts.removeFollower"), "removeFollower"),
      addFollowing: /* @__PURE__ */ __name(() => notImplemented2("accounts.addFollowing"), "addFollowing"),
      removeFollowing: /* @__PURE__ */ __name(() => notImplemented2("accounts.removeFollowing"), "removeFollowing"),
      addFollowerByName: /* @__PURE__ */ __name(() => notImplemented2("accounts.addFollowerByName"), "addFollowerByName"),
      removeFollowerByName: /* @__PURE__ */ __name(() => notImplemented2("accounts.removeFollowerByName"), "removeFollowerByName"),
      search: /* @__PURE__ */ __name(() => notImplemented2("accounts.search"), "search"),
      updateByUserName: /* @__PURE__ */ __name(() => notImplemented2("accounts.updateByUserName"), "updateByUserName"),
      findByUserNames: /* @__PURE__ */ __name(() => notImplemented2("accounts.findByUserNames"), "findByUserNames"),
      count: /* @__PURE__ */ __name(() => notImplemented2("accounts.count"), "count")
    },
    posts: {
      findNoteById: /* @__PURE__ */ __name(() => notImplemented2("posts.findNoteById"), "findNoteById"),
      findMessageById: /* @__PURE__ */ __name(() => notImplemented2("posts.findMessageById"), "findMessageById"),
      findAttachmentById: /* @__PURE__ */ __name(() => notImplemented2("posts.findAttachmentById"), "findAttachmentById"),
      saveObject: /* @__PURE__ */ __name(() => notImplemented2("posts.saveObject"), "saveObject"),
      listTimeline: /* @__PURE__ */ __name(() => notImplemented2("posts.listTimeline"), "listTimeline"),
      follow: /* @__PURE__ */ __name(() => notImplemented2("posts.follow"), "follow"),
      unfollow: /* @__PURE__ */ __name(() => notImplemented2("posts.unfollow"), "unfollow"),
      saveNote: /* @__PURE__ */ __name(() => notImplemented2("posts.saveNote"), "saveNote"),
      updateNote: /* @__PURE__ */ __name(() => notImplemented2("posts.updateNote"), "updateNote"),
      deleteNote: /* @__PURE__ */ __name(() => notImplemented2("posts.deleteNote"), "deleteNote"),
      findNotes: /* @__PURE__ */ __name(() => notImplemented2("posts.findNotes"), "findNotes"),
      getPublicNotes: /* @__PURE__ */ __name(() => notImplemented2("posts.getPublicNotes"), "getPublicNotes"),
      saveMessage: /* @__PURE__ */ __name(() => notImplemented2("posts.saveMessage"), "saveMessage"),
      updateMessage: /* @__PURE__ */ __name(() => notImplemented2("posts.updateMessage"), "updateMessage"),
      deleteMessage: /* @__PURE__ */ __name(() => notImplemented2("posts.deleteMessage"), "deleteMessage"),
      findMessages: /* @__PURE__ */ __name(() => notImplemented2("posts.findMessages"), "findMessages"),
      updateObject: /* @__PURE__ */ __name(() => notImplemented2("posts.updateObject"), "updateObject"),
      deleteObject: /* @__PURE__ */ __name(() => notImplemented2("posts.deleteObject"), "deleteObject"),
      deleteManyObjects: /* @__PURE__ */ __name(() => notImplemented2("posts.deleteManyObjects"), "deleteManyObjects")
    },
    dms: {
      save: /* @__PURE__ */ __name(() => notImplemented2("dms.save"), "save"),
      listBetween: /* @__PURE__ */ __name(() => notImplemented2("dms.listBetween"), "listBetween"),
      list: /* @__PURE__ */ __name(() => notImplemented2("dms.list"), "list"),
      create: /* @__PURE__ */ __name(() => notImplemented2("dms.create"), "create"),
      update: /* @__PURE__ */ __name(() => notImplemented2("dms.update"), "update"),
      delete: /* @__PURE__ */ __name(() => notImplemented2("dms.delete"), "delete")
    },
    groups: {
      list: /* @__PURE__ */ __name(() => notImplemented2("groups.list"), "list"),
      findByName: /* @__PURE__ */ __name(() => notImplemented2("groups.findByName"), "findByName"),
      create: /* @__PURE__ */ __name(() => notImplemented2("groups.create"), "create"),
      updateByName: /* @__PURE__ */ __name(() => notImplemented2("groups.updateByName"), "updateByName"),
      addFollower: /* @__PURE__ */ __name(() => notImplemented2("groups.addFollower"), "addFollower"),
      removeFollower: /* @__PURE__ */ __name(() => notImplemented2("groups.removeFollower"), "removeFollower"),
      pushOutbox: /* @__PURE__ */ __name(() => notImplemented2("groups.pushOutbox"), "pushOutbox")
    },
    invites: {
      findOne: /* @__PURE__ */ __name(() => notImplemented2("invites.findOne"), "findOne"),
      findOneAndUpdate: /* @__PURE__ */ __name(() => notImplemented2("invites.findOneAndUpdate"), "findOneAndUpdate"),
      save: /* @__PURE__ */ __name(() => notImplemented2("invites.save"), "save"),
      deleteOne: /* @__PURE__ */ __name(() => notImplemented2("invites.deleteOne"), "deleteOne")
    },
    approvals: {
      findOne: /* @__PURE__ */ __name(() => notImplemented2("approvals.findOne"), "findOne"),
      findOneAndUpdate: /* @__PURE__ */ __name(() => notImplemented2("approvals.findOneAndUpdate"), "findOneAndUpdate"),
      deleteOne: /* @__PURE__ */ __name(() => notImplemented2("approvals.deleteOne"), "deleteOne")
    },
    notifications: {
      list: /* @__PURE__ */ __name(() => notImplemented2("notifications.list"), "list"),
      create: /* @__PURE__ */ __name(() => notImplemented2("notifications.create"), "create"),
      markRead: /* @__PURE__ */ __name(() => notImplemented2("notifications.markRead"), "markRead"),
      delete: /* @__PURE__ */ __name(() => notImplemented2("notifications.delete"), "delete")
    },
    system: {
      findKey: /* @__PURE__ */ __name(() => notImplemented2("system.findKey"), "findKey"),
      saveKey: /* @__PURE__ */ __name(() => notImplemented2("system.saveKey"), "saveKey"),
      findRemoteActorByUrl: /* @__PURE__ */ __name(() => notImplemented2("system.findRemoteActorByUrl"), "findRemoteActorByUrl"),
      findRemoteActorsByUrls: /* @__PURE__ */ __name(() => notImplemented2("system.findRemoteActorsByUrls"), "findRemoteActorsByUrls"),
      upsertRemoteActor: /* @__PURE__ */ __name(() => notImplemented2("system.upsertRemoteActor"), "upsertRemoteActor")
    },
    sessions: {
      create: /* @__PURE__ */ __name(() => notImplemented2("sessions.create"), "create"),
      findById: /* @__PURE__ */ __name(() => notImplemented2("sessions.findById"), "findById"),
      deleteById: /* @__PURE__ */ __name(() => notImplemented2("sessions.deleteById"), "deleteById"),
      updateExpires: /* @__PURE__ */ __name(() => notImplemented2("sessions.updateExpires"), "updateExpires"),
      updateActivity: /* @__PURE__ */ __name(() => notImplemented2("sessions.updateActivity"), "updateActivity")
    },
    fcm: {
      register: /* @__PURE__ */ __name(() => notImplemented2("fcm.register"), "register"),
      unregister: /* @__PURE__ */ __name(() => notImplemented2("fcm.unregister"), "unregister"),
      list: /* @__PURE__ */ __name(() => notImplemented2("fcm.list"), "list")
    },
    faspProviders: {
      getSettings: /* @__PURE__ */ __name(async () => null, "getSettings"),
      list: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.list"), "list"),
      findOne: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.findOne"), "findOne"),
      upsertByBaseUrl: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.upsertByBaseUrl"), "upsertByBaseUrl"),
      updateByBaseUrl: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.updateByBaseUrl"), "updateByBaseUrl"),
      deleteOne: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.deleteOne"), "deleteOne"),
      registrationUpsert: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.registrationUpsert"), "registrationUpsert"),
      listProviders: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.listProviders"), "listProviders"),
      insertEventSubscription: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.insertEventSubscription"), "insertEventSubscription"),
      deleteEventSubscription: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.deleteEventSubscription"), "deleteEventSubscription"),
      createBackfill: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.createBackfill"), "createBackfill"),
      continueBackfill: /* @__PURE__ */ __name(() => notImplemented2("faspProviders.continueBackfill"), "continueBackfill")
    },
    // -------------- Host 側（D1 実装） --------------
    tenant: {
      ensure: /* @__PURE__ */ __name(async (id) => {
        await d1.prepare(
          "INSERT OR IGNORE INTO tenants (id, domain, created_at) VALUES (?1, ?2, ?3)"
        ).bind(id, id, now()).run();
      }, "ensure")
    },
    host: {
      listInstances: /* @__PURE__ */ __name(async (owner) => {
        const { results } = await d1.prepare(
          "SELECT host FROM instances WHERE owner = ?1 ORDER BY created_at DESC"
        ).bind(owner).all();
        return results ?? [];
      }, "listInstances"),
      countInstances: /* @__PURE__ */ __name(async (owner) => {
        const row = await d1.prepare(
          "SELECT COUNT(1) as cnt FROM instances WHERE owner = ?1"
        ).bind(owner).first();
        return Number(row?.cnt ?? 0);
      }, "countInstances"),
      findInstanceByHost: /* @__PURE__ */ __name(async (host) => {
        const row = await d1.prepare(
          "SELECT id, host, owner, env_json FROM instances WHERE host = ?1"
        ).bind(host).first();
        if (!row) return null;
        return {
          _id: String(row.id),
          host: String(row.host),
          owner: String(row.owner),
          env: json(row.env_json) ?? {}
        };
      }, "findInstanceByHost"),
      findInstanceByHostAndOwner: /* @__PURE__ */ __name(async (host, owner) => {
        const row = await d1.prepare(
          "SELECT id, host, env_json FROM instances WHERE host = ?1 AND owner = ?2"
        ).bind(host, owner).first();
        if (!row) return null;
        return {
          _id: String(row.id),
          host: String(row.host),
          env: json(row.env_json) ?? {}
        };
      }, "findInstanceByHostAndOwner"),
      createInstance: /* @__PURE__ */ __name(async (data) => {
        await d1.prepare(
          "INSERT INTO instances (host, owner, env_json, created_at) VALUES (?1, ?2, ?3, ?4)"
        ).bind(data.host, data.owner, JSON.stringify(data.env ?? {}), now()).run();
      }, "createInstance"),
      updateInstanceEnv: /* @__PURE__ */ __name(async (id, envMap) => {
        await d1.prepare(
          "UPDATE instances SET env_json = ?2 WHERE id = ?1"
        ).bind(id, JSON.stringify(envMap ?? {})).run();
      }, "updateInstanceEnv"),
      deleteInstance: /* @__PURE__ */ __name(async (host, owner) => {
        await d1.prepare(
          "DELETE FROM instances WHERE host = ?1 AND owner = ?2"
        ).bind(host, owner).run();
      }, "deleteInstance")
    },
    oauth: {
      list: /* @__PURE__ */ __name(async () => {
        const { results } = await d1.prepare(
          "SELECT client_id as clientId, redirect_uri as redirectUri FROM oauth_clients ORDER BY client_id"
        ).all();
        return results ?? [];
      }, "list"),
      find: /* @__PURE__ */ __name(async (clientId) => {
        const row = await d1.prepare(
          "SELECT client_secret as clientSecret FROM oauth_clients WHERE client_id = ?1"
        ).bind(clientId).first();
        return row ?? null;
      }, "find"),
      create: /* @__PURE__ */ __name(async (data) => {
        await d1.prepare(
          "INSERT OR REPLACE INTO oauth_clients (client_id, client_secret, redirect_uri) VALUES (?1, ?2, ?3)"
        ).bind(data.clientId, data.clientSecret, data.redirectUri).run();
      }, "create")
    },
    domains: {
      list: /* @__PURE__ */ __name(async (user) => {
        const { results } = await d1.prepare(
          "SELECT domain, verified FROM host_domains WHERE user_id = ?1 ORDER BY domain"
        ).bind(user).all();
        return (results ?? []).map((r) => ({ domain: r.domain, verified: toBool(r.verified) }));
      }, "list"),
      find: /* @__PURE__ */ __name(async (domain2, user) => {
        const sql = user ? "SELECT id, token, verified FROM host_domains WHERE domain = ?1 AND user_id = ?2" : "SELECT id, token, verified FROM host_domains WHERE domain = ?1";
        const row = user ? await d1.prepare(sql).bind(domain2, user).first() : await d1.prepare(sql).bind(domain2).first();
        if (!row) return null;
        return {
          _id: String(row.id),
          token: String(row.token),
          verified: toBool(row.verified)
        };
      }, "find"),
      create: /* @__PURE__ */ __name(async (domain2, user, token) => {
        await d1.prepare(
          "INSERT INTO host_domains (user_id, domain, token, verified, created_at) VALUES (?1, ?2, ?3, 0, ?4)"
        ).bind(user, domain2, token, now()).run();
      }, "create"),
      verify: /* @__PURE__ */ __name(async (id) => {
        await d1.prepare(
          "UPDATE host_domains SET verified = 1 WHERE id = ?1"
        ).bind(id).run();
      }, "verify")
    },
    hostUsers: {
      findByUserName: /* @__PURE__ */ __name(async (userName) => {
        const row = await d1.prepare(
          "SELECT * FROM host_users WHERE user_name = ?1"
        ).bind(userName).first();
        if (!row) return null;
        return {
          _id: String(row.id),
          userName: String(row.user_name),
          email: String(row.email),
          emailVerified: toBool(row.email_verified),
          verifyCode: row.verify_code ? String(row.verify_code) : void 0,
          verifyCodeExpires: row.verify_expires ? new Date(Number(row.verify_expires)) : void 0,
          hashedPassword: String(row.hashed_password),
          salt: String(row.salt)
        };
      }, "findByUserName"),
      findByUserNameOrEmail: /* @__PURE__ */ __name(async (userName, email) => {
        const row = await d1.prepare(
          "SELECT * FROM host_users WHERE user_name = ?1 OR email = ?2"
        ).bind(userName, email).first();
        if (!row) return null;
        return {
          _id: String(row.id),
          userName: String(row.user_name),
          email: String(row.email),
          emailVerified: toBool(row.email_verified),
          verifyCode: row.verify_code ? String(row.verify_code) : void 0,
          verifyCodeExpires: row.verify_expires ? new Date(Number(row.verify_expires)) : void 0,
          hashedPassword: String(row.hashed_password),
          salt: String(row.salt)
        };
      }, "findByUserNameOrEmail"),
      create: /* @__PURE__ */ __name(async (data) => {
        const id = crypto.randomUUID();
        await d1.prepare(
          "INSERT INTO host_users (id, user_name, email, email_verified, verify_code, verify_expires, hashed_password, salt, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
        ).bind(
          id,
          data.userName,
          data.email,
          data.emailVerified === true ? 1 : 0,
          data.verifyCode ?? null,
          data.verifyCodeExpires ? data.verifyCodeExpires.getTime() : null,
          data.hashedPassword,
          data.salt,
          now()
        ).run();
        return {
          _id: id,
          userName: data.userName,
          email: data.email,
          emailVerified: data.emailVerified === true,
          hashedPassword: data.hashedPassword,
          salt: data.salt
        };
      }, "create"),
      update: /* @__PURE__ */ __name(async (id, data) => {
        const sets = [];
        const vals = [];
        const push = /* @__PURE__ */ __name((col, val) => {
          sets.push(`${col} = ?${sets.length + 1}`);
          vals.push(val);
        }, "push");
        if (data.userName !== void 0) push("user_name", data.userName);
        if (data.email !== void 0) push("email", data.email);
        if (data.hashedPassword !== void 0) push("hashed_password", data.hashedPassword);
        if (data.salt !== void 0) push("salt", data.salt);
        if (data.verifyCode !== void 0) push("verify_code", data.verifyCode);
        if (data.verifyCodeExpires !== void 0) push("verify_expires", data.verifyCodeExpires ? data.verifyCodeExpires.getTime() : null);
        if (data.emailVerified !== void 0) push("email_verified", data.emailVerified ? 1 : 0);
        if (sets.length === 0) return;
        const sql = `UPDATE host_users SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`;
        vals.push(id);
        await d1.prepare(sql).bind(...vals).run();
      }, "update")
    },
    hostSessions: {
      findById: /* @__PURE__ */ __name(async (sessionId) => {
        const row = await d1.prepare(
          "SELECT session_id, user_id, expires_at FROM host_sessions WHERE session_id = ?1"
        ).bind(sessionId).first();
        return row ? { sessionId: row.session_id, user: row.user_id, expiresAt: new Date(Number(row.expires_at)) } : null;
      }, "findById"),
      create: /* @__PURE__ */ __name(async (data) => {
        await d1.prepare(
          "INSERT INTO host_sessions (session_id, user_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)"
        ).bind(data.sessionId, data.user, data.expiresAt.getTime(), now()).run();
        return { sessionId: data.sessionId, user: data.user, expiresAt: data.expiresAt };
      }, "create"),
      update: /* @__PURE__ */ __name(async (sessionId, data) => {
        await d1.prepare(
          "UPDATE host_sessions SET expires_at = ?2 WHERE session_id = ?1"
        ).bind(sessionId, data.expiresAt.getTime()).run();
      }, "update"),
      delete: /* @__PURE__ */ __name(async (sessionId) => {
        await d1.prepare(
          "DELETE FROM host_sessions WHERE session_id = ?1"
        ).bind(sessionId).run();
      }, "delete")
    }
  };
}
__name(createD1DataStore, "createD1DataStore");

// app/takos_host/db/d1/schema.ts
var D1_SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  env_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret TEXT NOT NULL,
  redirect_uri TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS host_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  token TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, domain)
);

CREATE TABLE IF NOT EXISTS host_users (
  id TEXT PRIMARY KEY,
  user_name TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verify_code TEXT,
  verify_expires INTEGER,
  hashed_password TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS host_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_instances_owner ON instances(owner);
CREATE INDEX IF NOT EXISTS idx_domains_user ON host_domains(user_id);
`;

// app/takos_host/host_api_worker.ts
function mapR2BindingToGlobal(env2) {
  if ((env2.OBJECT_STORAGE_PROVIDER ?? "").toLowerCase() !== "r2") return;
  const bucketName = env2.R2_BUCKET?.trim();
  if (!bucketName) return;
  const binding2 = env2[bucketName];
  if (binding2) {
    globalThis[bucketName] = binding2;
  }
}
__name(mapR2BindingToGlobal, "mapR2BindingToGlobal");
async function serveFromAssets(env2, req, rewriteTo) {
  const url = new URL(req.url);
  if (rewriteTo) url.pathname = rewriteTo;
  let target = url;
  let res = await env2.ASSETS.fetch(new Request(target.toString(), req));
  const seen = /* @__PURE__ */ new Set();
  while (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) break;
    const next = new URL(loc, target);
    const key = next.toString();
    if (seen.has(key)) break;
    seen.add(key);
    target = next;
    res = await env2.ASSETS.fetch(new Request(target.toString(), req));
  }
  const headers = new Headers(res.headers);
  headers.set("cache-control", "no-store");
  headers.set("x-worker-assets-path", target.pathname || "/");
  headers.set("x-worker-route", "assets");
  return new Response(res.body, { status: res.status, headers });
}
__name(serveFromAssets, "serveFromAssets");
var host_api_worker_default = {
  async fetch(req, env2) {
    if (!globalThis._takos_d1_inited) {
      try {
        const stmts = D1_SCHEMA.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
        for (const sql of stmts) {
          await env2.TAKOS_HOST_DB.prepare(sql).run();
        }
      } catch (e) {
        console.warn("D1 schema init warning:", e.message ?? e);
      }
      globalThis._takos_d1_inited = true;
    }
    mapR2BindingToGlobal(env2);
    const rootDomain = (env2.ACTIVITYPUB_DOMAIN ?? "").toLowerCase();
    const freeLimit = Number(env2.FREE_PLAN_LIMIT ?? "1");
    const reserved = (env2.RESERVED_SUBDOMAINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    setStoreFactory((vars) => createD1DataStore({
      OBJECT_STORAGE_PROVIDER: env2.OBJECT_STORAGE_PROVIDER ?? vars["OBJECT_STORAGE_PROVIDER"] ?? "r2",
      R2_BUCKET: env2.R2_BUCKET ?? vars["R2_BUCKET"] ?? "TAKOS_R2",
      ACTIVITYPUB_DOMAIN: vars["ACTIVITYPUB_DOMAIN"] ?? rootDomain
    }, env2.TAKOS_HOST_DB, { tenantId: rootDomain, multiTenant: true }));
    const SESSION_COOKIE = "hostSessionId";
    const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1e3;
    const db = /* @__PURE__ */ __name(() => globalThis._db, "db");
    globalThis._db ??= createD1DataStore({
      OBJECT_STORAGE_PROVIDER: env2.OBJECT_STORAGE_PROVIDER ?? "r2",
      R2_BUCKET: env2.R2_BUCKET ?? "TAKOS_R2",
      ACTIVITYPUB_DOMAIN: rootDomain
    }, env2.TAKOS_HOST_DB, { tenantId: rootDomain, multiTenant: true });
    function toCookieMap(c) {
      const out = {};
      if (!c) return out;
      for (const part of c.split(";")) {
        const [k, v] = part.split("=");
        if (k && v) out[k.trim()] = decodeURIComponent(v);
      }
      return out;
    }
    __name(toCookieMap, "toCookieMap");
    function setCookieHeader(name, value, secure, expires) {
      const attrs = [
        `${name}=${encodeURIComponent(value)}`,
        `Path=/`,
        `SameSite=Lax`,
        `Expires=${expires.toUTCString()}`
      ];
      if (secure) attrs.push("Secure");
      attrs.push("HttpOnly");
      return attrs.join("; ");
    }
    __name(setCookieHeader, "setCookieHeader");
    async function sha256Hex(text) {
      const data = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", data);
      return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    __name(sha256Hex, "sha256Hex");
    function jsonRes(body, status = 200) {
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }
    __name(jsonRes, "jsonRes");
    const app = new Hono2({ strict: false });
    app.get("/user", (c) => serveFromAssets(env2, c.req.raw, "/index.html"));
    app.get("/auth", (c) => serveFromAssets(env2, c.req.raw, "/index.html"));
    app.get("/signup", (c) => serveFromAssets(env2, c.req.raw, "/index.html"));
    app.get("/verify", (c) => serveFromAssets(env2, c.req.raw, "/index.html"));
    app.get("/terms", (c) => serveFromAssets(env2, c.req.raw, "/index.html"));
    app.get("/robots.txt", (c) => serveFromAssets(env2, c.req.raw, "/robots.txt"));
    app.get("/auth/*", async (c, next) => {
      if (c.req.path === "/auth/status") return await next();
      const p = c.req.path.replace(/^\/auth/, "");
      return serveFromAssets(env2, c.req.raw, p || "/index.html");
    });
    app.get("/user/*", async (c, next) => {
      if (/^\/user\/(instances|oauth|domains)(\/|$)/.test(c.req.path)) {
        return await next();
      }
      const p = c.req.path.replace(/^\/user/, "");
      return serveFromAssets(env2, c.req.raw, p || "/index.html");
    });
    app.post("/auth/register", async (c) => {
      const { userName, email, password } = await c.req.json().catch(() => ({}));
      if (typeof userName !== "string" || typeof email !== "string" || typeof password !== "string") {
        return jsonRes({ error: "invalid" }, 400);
      }
      const exists = await db().hostUsers.findByUserNameOrEmail(userName, email);
      if (exists && exists.emailVerified) return jsonRes({ error: "exists" }, 400);
      const salt = crypto.randomUUID();
      const hashedPassword = await sha256Hex(password + salt);
      if (exists && !exists.emailVerified) {
        await db().hostUsers.update(exists._id, {
          userName,
          email,
          salt,
          hashedPassword,
          emailVerified: true,
          // メール送信なしで即時有効化（Workers 環境用）
          verifyCode: null,
          verifyCodeExpires: null
        });
        return jsonRes({ success: true });
      }
      await db().hostUsers.create({
        userName,
        email,
        hashedPassword,
        salt,
        verifyCode: "",
        verifyCodeExpires: /* @__PURE__ */ new Date(),
        emailVerified: true
        // 簡略化
      });
      return jsonRes({ success: true });
    });
    app.post("/auth/login", async (c) => {
      const { userName, password } = await c.req.json().catch(() => ({}));
      if (typeof userName !== "string" || typeof password !== "string") return jsonRes({ error: "invalid" }, 400);
      const user = await db().hostUsers.findByUserName(userName);
      if (!user || !user.emailVerified) return jsonRes({ error: "invalid" }, 401);
      const ok = await sha256Hex(password + user.salt) === user.hashedPassword;
      if (!ok) return jsonRes({ error: "invalid" }, 401);
      const sid = crypto.randomUUID();
      const expires = new Date(Date.now() + SESSION_LIFETIME_MS);
      await db().hostSessions.create({ sessionId: sid, user: user._id, expiresAt: expires });
      const secure = c.req.url.startsWith("https://");
      const headers = new Headers({ "set-cookie": setCookieHeader(SESSION_COOKIE, sid, secure, expires) });
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    });
    app.get("/auth/status", async (c) => {
      const cookies = toCookieMap(c.req.header("cookie") ?? null);
      const sid = cookies[SESSION_COOKIE];
      const body = { login: false, rootDomain, termsRequired: false };
      if (!sid) return jsonRes(body);
      const sess = await db().hostSessions.findById(sid);
      if (!sess || sess.expiresAt <= /* @__PURE__ */ new Date()) return jsonRes(body);
      const newExp = new Date(Date.now() + SESSION_LIFETIME_MS);
      await db().hostSessions.update(sid, { expiresAt: newExp });
      const secure = c.req.url.startsWith("https://");
      const headers = new Headers({ "set-cookie": setCookieHeader(SESSION_COOKIE, sid, secure, newExp) });
      return new Response(JSON.stringify({ login: true, user: sess.user, rootDomain, termsRequired: false }), { headers });
    });
    app.delete("/auth/logout", async (c) => {
      const cookies = toCookieMap(c.req.header("cookie") ?? null);
      const sid = cookies[SESSION_COOKIE];
      if (sid) await db().hostSessions.delete(sid);
      return jsonRes({ success: true });
    });
    app.use("/user/*", async (c, next) => {
      const cookies = toCookieMap(c.req.header("cookie") ?? null);
      const sid = cookies[SESSION_COOKIE];
      if (!sid) return jsonRes({ error: "unauthorized" }, 401);
      const sess = await db().hostSessions.findById(sid);
      if (!sess || sess.expiresAt <= /* @__PURE__ */ new Date()) return jsonRes({ error: "unauthorized" }, 401);
      c.userId = sess.user;
      await next();
    });
    app.get("/user/instances", async (c) => {
      const userId = c.userId;
      const list = await db().host.listInstances(userId);
      return jsonRes(list);
    });
    app.post("/user/instances", async (c) => {
      const userId = c.userId;
      const { host: rawHost, password } = await c.req.json().catch(() => ({}));
      if (typeof rawHost !== "string") return jsonRes({ error: "invalid" }, 400);
      const over = await db().host.countInstances(userId) >= freeLimit;
      if (over) return jsonRes({ error: "limit" }, 400);
      const lower = rawHost.toLowerCase();
      let fullHost = lower;
      const isReserved = /* @__PURE__ */ __name((s) => reserved.includes(s), "isReserved");
      if (rootDomain) {
        if (lower.includes(".")) {
          if (!lower.endsWith(`.${rootDomain}`) || lower === rootDomain) return jsonRes({ error: "domain" }, 400);
          const sub = lower.slice(0, -rootDomain.length - 1);
          if (isReserved(sub)) return jsonRes({ error: "reserved" }, 400);
        } else {
          if (isReserved(lower)) return jsonRes({ error: "reserved" }, 400);
          fullHost = `${lower}.${rootDomain}`;
        }
      } else if (isReserved(lower)) return jsonRes({ error: "reserved" }, 400);
      if (await db().host.findInstanceByHost(fullHost)) return jsonRes({ error: "already exists" }, 400);
      const envVars = {};
      if (rootDomain) {
        envVars.OAUTH_HOST = rootDomain;
        const redirect = `https://${fullHost}`;
        const clientId = redirect;
        const found = await db().oauth.find(clientId);
        const clientSecret = found?.clientSecret ?? crypto.randomUUID();
        if (!found) await db().oauth.create({ clientId, clientSecret, redirectUri: redirect });
        envVars.OAUTH_CLIENT_ID = clientId;
        envVars.OAUTH_CLIENT_SECRET = clientSecret;
      }
      if (typeof password === "string" && password) {
        const salt = crypto.randomUUID();
        envVars.hashedPassword = await sha256Hex(password + salt);
        envVars.salt = salt;
      }
      await db().host.createInstance({ host: fullHost, owner: userId, env: envVars });
      await db().tenant.ensure(fullHost);
      return jsonRes({ success: true, host: fullHost });
    });
    app.delete("/user/instances/:host", async (c) => {
      const userId = c.userId;
      const host = c.req.param("host").toLowerCase();
      await db().host.deleteInstance(host, userId);
      return jsonRes({ success: true });
    });
    app.get("/user/instances/:host", async (c) => {
      const userId = c.userId;
      const host = c.req.param("host").toLowerCase();
      const inst = await db().host.findInstanceByHostAndOwner(host, userId);
      if (!inst) return jsonRes({ error: "not found" }, 404);
      return jsonRes({ host: inst.host });
    });
    app.put("/user/instances/:host/password", async (c) => {
      const userId = c.userId;
      const host = c.req.param("host").toLowerCase();
      const { password } = await c.req.json().catch(() => ({}));
      const inst = await db().host.findInstanceByHostAndOwner(host, userId);
      if (!inst) return jsonRes({ error: "not found" }, 404);
      const newEnv = { ...inst.env ?? {} };
      if (typeof password === "string" && password) {
        const salt = crypto.randomUUID();
        newEnv.hashedPassword = await sha256Hex(password + salt);
        newEnv.salt = salt;
      } else {
        delete newEnv.hashedPassword;
        delete newEnv.salt;
      }
      await db().host.updateInstanceEnv(inst._id, newEnv);
      return jsonRes({ success: true });
    });
    app.post("/user/instances/:host/restart", async (_c) => jsonRes({ success: true }));
    app.get("/user/oauth/clients", async () => jsonRes(await db().oauth.list()));
    app.post("/user/oauth/clients", async (c) => {
      const { clientId, clientSecret, redirectUri } = await c.req.json().catch(() => ({}));
      if (typeof clientId !== "string" || typeof clientSecret !== "string" || typeof redirectUri !== "string") return jsonRes({ error: "invalid" }, 400);
      if (await db().oauth.find(clientId)) return jsonRes({ error: "exists" }, 400);
      await db().oauth.create({ clientId, clientSecret, redirectUri });
      return jsonRes({ success: true });
    });
    app.get("/user/domains", async (c) => {
      const userId = c.userId;
      return jsonRes(await db().domains.list(userId));
    });
    app.post("/user/domains", async (c) => {
      const userId = c.userId;
      const { domain: domain2 } = await c.req.json().catch(() => ({}));
      if (typeof domain2 !== "string") return jsonRes({ error: "invalid" }, 400);
      if (await db().domains.find(domain2)) return jsonRes({ error: "exists" }, 400);
      const token = crypto.randomUUID();
      await db().domains.create(domain2, userId, token);
      return jsonRes({ success: true, token });
    });
    app.post("/user/domains/:domain/verify", async (c) => {
      const userId = c.userId;
      const domain2 = c.req.param("domain");
      const doc = await db().domains.find(domain2, userId);
      if (!doc) return jsonRes({ error: "not found" }, 404);
      try {
        const res2 = await fetch(`http://${domain2}/.well-known/takos-host-verification.txt`);
        if (res2.ok && (await res2.text()).trim() === doc.token) {
          await db().domains.verify(doc._id);
          return jsonRes({ success: true });
        }
      } catch {
      }
      return jsonRes({ error: "verify" }, 400);
    });
    const res = await app.fetch(req, env2);
    if (res.status !== 404) return res;
    if (req.method === "GET") {
      return await serveFromAssets(env2, req, "/index.html");
    }
    return res;
  }
};

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env2, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env2);
  } catch (e) {
    const error3 = reduceError(e);
    return Response.json(error3, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-919aum/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = host_api_worker_default;

// ../../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env2, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env2, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env2, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env2, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-919aum/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env2, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env2, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env2, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env2, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env2, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env2, ctx) => {
      this.env = env2;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=host_api_worker.js.map
