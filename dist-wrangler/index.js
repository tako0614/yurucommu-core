var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};

// node_modules/unenv/dist/runtime/_internal/utils.mjs
function createNotImplementedError(name2) {
  return new Error(`[unenv] ${name2} is not implemented yet!`);
}
function notImplemented(name2) {
  const fn = /* @__PURE__ */ __name(() => {
    throw createNotImplementedError(name2);
  }, "fn");
  return Object.assign(fn, { __unenv__: true });
}
function notImplementedClass(name2) {
  return class {
    __unenv__ = true;
    constructor() {
      throw new Error(`[unenv] ${name2} is not implemented yet!`);
    }
  };
}
var init_utils = __esm({
  "node_modules/unenv/dist/runtime/_internal/utils.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    __name(createNotImplementedError, "createNotImplementedError");
    __name(notImplemented, "notImplemented");
    __name(notImplementedClass, "notImplementedClass");
  }
});

// node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs
var _timeOrigin, _performanceNow, nodeTiming, PerformanceEntry, PerformanceMark, PerformanceMeasure, PerformanceResourceTiming, PerformanceObserverEntryList, Performance, PerformanceObserver, performance;
var init_performance = __esm({
  "node_modules/unenv/dist/runtime/node/internal/perf_hooks/performance.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_utils();
    _timeOrigin = globalThis.performance?.timeOrigin ?? Date.now();
    _performanceNow = globalThis.performance?.now ? globalThis.performance.now.bind(globalThis.performance) : () => Date.now() - _timeOrigin;
    nodeTiming = {
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
    PerformanceEntry = class {
      __unenv__ = true;
      detail;
      entryType = "event";
      name;
      startTime;
      constructor(name2, options) {
        this.name = name2;
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
    __name(PerformanceEntry, "PerformanceEntry");
    PerformanceMark = /* @__PURE__ */ __name(class PerformanceMark2 extends PerformanceEntry {
      entryType = "mark";
      constructor() {
        super(...arguments);
      }
      get duration() {
        return 0;
      }
    }, "PerformanceMark");
    PerformanceMeasure = class extends PerformanceEntry {
      entryType = "measure";
    };
    __name(PerformanceMeasure, "PerformanceMeasure");
    PerformanceResourceTiming = class extends PerformanceEntry {
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
    __name(PerformanceResourceTiming, "PerformanceResourceTiming");
    PerformanceObserverEntryList = class {
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
    __name(PerformanceObserverEntryList, "PerformanceObserverEntryList");
    Performance = class {
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
      getEntriesByName(name2, type) {
        return this._entries.filter((e) => e.name === name2 && (!type || e.entryType === type));
      }
      getEntriesByType(type) {
        return this._entries.filter((e) => e.entryType === type);
      }
      mark(name2, options) {
        const entry = new PerformanceMark(name2, options);
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
    __name(Performance, "Performance");
    PerformanceObserver = class {
      __unenv__ = true;
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
    __name(PerformanceObserver, "PerformanceObserver");
    __publicField(PerformanceObserver, "supportedEntryTypes", []);
    performance = globalThis.performance && "addEventListener" in globalThis.performance ? globalThis.performance : new Performance();
  }
});

// node_modules/unenv/dist/runtime/node/perf_hooks.mjs
var init_perf_hooks = __esm({
  "node_modules/unenv/dist/runtime/node/perf_hooks.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_performance();
  }
});

// node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs
var init_performance2 = __esm({
  "node_modules/@cloudflare/unenv-preset/dist/runtime/polyfill/performance.mjs"() {
    init_perf_hooks();
    globalThis.performance = performance;
    globalThis.Performance = Performance;
    globalThis.PerformanceEntry = PerformanceEntry;
    globalThis.PerformanceMark = PerformanceMark;
    globalThis.PerformanceMeasure = PerformanceMeasure;
    globalThis.PerformanceObserver = PerformanceObserver;
    globalThis.PerformanceObserverEntryList = PerformanceObserverEntryList;
    globalThis.PerformanceResourceTiming = PerformanceResourceTiming;
  }
});

// node_modules/unenv/dist/runtime/mock/noop.mjs
var noop_default;
var init_noop = __esm({
  "node_modules/unenv/dist/runtime/mock/noop.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    noop_default = Object.assign(() => {
    }, { __unenv__: true });
  }
});

// node_modules/unenv/dist/runtime/node/console.mjs
import { Writable } from "node:stream";
var _console, _ignoreErrors, _stderr, _stdout, log, info, trace, debug, table, error, warn, createTask, clear, count, countReset, dir, dirxml, group, groupEnd, groupCollapsed, profile, profileEnd, time, timeEnd, timeLog, timeStamp, Console, _times, _stdoutErrorHandler, _stderrErrorHandler;
var init_console = __esm({
  "node_modules/unenv/dist/runtime/node/console.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_noop();
    init_utils();
    _console = globalThis.console;
    _ignoreErrors = true;
    _stderr = new Writable();
    _stdout = new Writable();
    log = _console?.log ?? noop_default;
    info = _console?.info ?? log;
    trace = _console?.trace ?? info;
    debug = _console?.debug ?? log;
    table = _console?.table ?? log;
    error = _console?.error ?? log;
    warn = _console?.warn ?? error;
    createTask = _console?.createTask ?? /* @__PURE__ */ notImplemented("console.createTask");
    clear = _console?.clear ?? noop_default;
    count = _console?.count ?? noop_default;
    countReset = _console?.countReset ?? noop_default;
    dir = _console?.dir ?? noop_default;
    dirxml = _console?.dirxml ?? noop_default;
    group = _console?.group ?? noop_default;
    groupEnd = _console?.groupEnd ?? noop_default;
    groupCollapsed = _console?.groupCollapsed ?? noop_default;
    profile = _console?.profile ?? noop_default;
    profileEnd = _console?.profileEnd ?? noop_default;
    time = _console?.time ?? noop_default;
    timeEnd = _console?.timeEnd ?? noop_default;
    timeLog = _console?.timeLog ?? noop_default;
    timeStamp = _console?.timeStamp ?? noop_default;
    Console = _console?.Console ?? /* @__PURE__ */ notImplementedClass("console.Console");
    _times = /* @__PURE__ */ new Map();
    _stdoutErrorHandler = noop_default;
    _stderrErrorHandler = noop_default;
  }
});

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs
var workerdConsole, assert, clear2, context, count2, countReset2, createTask2, debug2, dir2, dirxml2, error2, group2, groupCollapsed2, groupEnd2, info2, log2, profile2, profileEnd2, table2, time2, timeEnd2, timeLog2, timeStamp2, trace2, warn2, console_default;
var init_console2 = __esm({
  "node_modules/@cloudflare/unenv-preset/dist/runtime/node/console.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_console();
    workerdConsole = globalThis["console"];
    ({
      assert,
      clear: clear2,
      context: (
        // @ts-expect-error undocumented public API
        context
      ),
      count: count2,
      countReset: countReset2,
      createTask: (
        // @ts-expect-error undocumented public API
        createTask2
      ),
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
    } = workerdConsole);
    Object.assign(workerdConsole, {
      Console,
      _ignoreErrors,
      _stderr,
      _stderrErrorHandler,
      _stdout,
      _stdoutErrorHandler,
      _times
    });
    console_default = workerdConsole;
  }
});

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console
var init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console = __esm({
  "node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-console"() {
    init_console2();
    globalThis.console = console_default;
  }
});

// node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs
var hrtime;
var init_hrtime = __esm({
  "node_modules/unenv/dist/runtime/node/internal/process/hrtime.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    hrtime = /* @__PURE__ */ Object.assign(/* @__PURE__ */ __name(function hrtime2(startTime) {
      const now = Date.now();
      const seconds = Math.trunc(now / 1e3);
      const nanos = now % 1e3 * 1e6;
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
  }
});

// node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs
import { Socket } from "node:net";
var ReadStream;
var init_read_stream = __esm({
  "node_modules/unenv/dist/runtime/node/internal/tty/read-stream.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    ReadStream = class extends Socket {
      fd;
      constructor(fd) {
        super();
        this.fd = fd;
      }
      isRaw = false;
      setRawMode(mode) {
        this.isRaw = mode;
        return this;
      }
      isTTY = false;
    };
    __name(ReadStream, "ReadStream");
  }
});

// node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs
import { Socket as Socket2 } from "node:net";
var WriteStream;
var init_write_stream = __esm({
  "node_modules/unenv/dist/runtime/node/internal/tty/write-stream.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    WriteStream = class extends Socket2 {
      fd;
      constructor(fd) {
        super();
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
      columns = 80;
      rows = 24;
      isTTY = false;
    };
    __name(WriteStream, "WriteStream");
  }
});

// node_modules/unenv/dist/runtime/node/tty.mjs
var init_tty = __esm({
  "node_modules/unenv/dist/runtime/node/tty.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_read_stream();
    init_write_stream();
  }
});

// node_modules/unenv/dist/runtime/node/internal/process/process.mjs
import { EventEmitter } from "node:events";
var Process;
var init_process = __esm({
  "node_modules/unenv/dist/runtime/node/internal/process/process.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_tty();
    init_utils();
    Process = class extends EventEmitter {
      env;
      hrtime;
      nextTick;
      constructor(impl) {
        super();
        this.env = impl.env;
        this.hrtime = impl.hrtime;
        this.nextTick = impl.nextTick;
        for (const prop of [...Object.getOwnPropertyNames(Process.prototype), ...Object.getOwnPropertyNames(EventEmitter.prototype)]) {
          const value = this[prop];
          if (typeof value === "function") {
            this[prop] = value.bind(this);
          }
        }
      }
      emitWarning(warning, type, code) {
        console.warn(`${code ? `[${code}] ` : ""}${type ? `${type}: ` : ""}${warning}`);
      }
      emit(...args) {
        return super.emit(...args);
      }
      listeners(eventName) {
        return super.listeners(eventName);
      }
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
      #cwd = "/";
      chdir(cwd2) {
        this.#cwd = cwd2;
      }
      cwd() {
        return this.#cwd;
      }
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
        return "";
      }
      get versions() {
        return {};
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
      ref() {
      }
      unref() {
      }
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
      }), { rss: () => 0 });
      mainModule = void 0;
      domain = void 0;
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
    __name(Process, "Process");
  }
});

// node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs
var globalProcess, getBuiltinModule, exit, platform, nextTick, unenvProcess, abort, addListener, allowedNodeEnvironmentFlags, hasUncaughtExceptionCaptureCallback, setUncaughtExceptionCaptureCallback, loadEnvFile, sourceMapsEnabled, arch, argv, argv0, chdir, config, connected, constrainedMemory, availableMemory, cpuUsage, cwd, debugPort, dlopen, disconnect, emit, emitWarning, env, eventNames, execArgv, execPath, finalization, features, getActiveResourcesInfo, getMaxListeners, hrtime3, kill, listeners, listenerCount, memoryUsage, on, off, once, pid, ppid, prependListener, prependOnceListener, rawListeners, release, removeAllListeners, removeListener, report, resourceUsage, setMaxListeners, setSourceMapsEnabled, stderr, stdin, stdout, title, throwDeprecation, traceDeprecation, umask, uptime, version, versions, domain, initgroups, moduleLoadList, reallyExit, openStdin, assert2, binding, send, exitCode, channel, getegid, geteuid, getgid, getgroups, getuid, setegid, seteuid, setgid, setgroups, setuid, permission, mainModule, _events, _eventsCount, _exiting, _maxListeners, _debugEnd, _debugProcess, _fatalException, _getActiveHandles, _getActiveRequests, _kill, _preload_modules, _rawDebug, _startProfilerIdleNotifier, _stopProfilerIdleNotifier, _tickCallback, _disconnect, _handleQueue, _pendingMessage, _channel, _send, _linkedBinding, _process, process_default;
var init_process2 = __esm({
  "node_modules/@cloudflare/unenv-preset/dist/runtime/node/process.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_hrtime();
    init_process();
    globalProcess = globalThis["process"];
    getBuiltinModule = globalProcess.getBuiltinModule;
    ({ exit, platform, nextTick } = getBuiltinModule(
      "node:process"
    ));
    unenvProcess = new Process({
      env: globalProcess.env,
      hrtime,
      nextTick
    });
    ({
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
    } = unenvProcess);
    _process = {
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
    process_default = _process;
  }
});

// node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process
var init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process = __esm({
  "node_modules/wrangler/_virtual_unenv_global_polyfill-@cloudflare-unenv-preset-node-process"() {
    init_process2();
    globalThis.process = process_default;
  }
});

// node_modules/@prisma/client-runtime-utils/dist/index.js
var require_dist = __commonJS({
  "node_modules/@prisma/client-runtime-utils/dist/index.js"(exports, module) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var __defProp3 = Object.defineProperty;
    var __getOwnPropDesc2 = Object.getOwnPropertyDescriptor;
    var __getOwnPropNames2 = Object.getOwnPropertyNames;
    var __hasOwnProp2 = Object.prototype.hasOwnProperty;
    var __export3 = /* @__PURE__ */ __name((target, all) => {
      for (var name2 in all)
        __defProp3(target, name2, { get: all[name2], enumerable: true });
    }, "__export");
    var __copyProps2 = /* @__PURE__ */ __name((to, from, except, desc) => {
      if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames2(from))
          if (!__hasOwnProp2.call(to, key) && key !== except)
            __defProp3(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc2(from, key)) || desc.enumerable });
      }
      return to;
    }, "__copyProps");
    var __toCommonJS = /* @__PURE__ */ __name((mod2) => __copyProps2(__defProp3({}, "__esModule", { value: true }), mod2), "__toCommonJS");
    var index_exports = {};
    __export3(index_exports, {
      AnyNull: () => AnyNull2,
      AnyNullClass: () => AnyNullClass,
      DbNull: () => DbNull2,
      DbNullClass: () => DbNullClass,
      Decimal: () => Decimal2,
      JsonNull: () => JsonNull2,
      JsonNullClass: () => JsonNullClass,
      NullTypes: () => NullTypes2,
      ObjectEnumValue: () => ObjectEnumValue2,
      PrismaClientInitializationError: () => PrismaClientInitializationError2,
      PrismaClientKnownRequestError: () => PrismaClientKnownRequestError2,
      PrismaClientRustError: () => PrismaClientRustError,
      PrismaClientRustPanicError: () => PrismaClientRustPanicError2,
      PrismaClientUnknownRequestError: () => PrismaClientUnknownRequestError2,
      PrismaClientValidationError: () => PrismaClientValidationError2,
      Sql: () => Sql2,
      empty: () => empty2,
      hasBatchIndex: () => hasBatchIndex,
      isAnyNull: () => isAnyNull2,
      isDbNull: () => isDbNull2,
      isJsonNull: () => isJsonNull2,
      join: () => join2,
      raw: () => raw3,
      sql: () => sql
    });
    module.exports = __toCommonJS(index_exports);
    function hasBatchIndex(value) {
      return typeof value["batchRequestIdx"] === "number";
    }
    __name(hasBatchIndex, "hasBatchIndex");
    function setClassName(classObject, name2) {
      Object.defineProperty(classObject, "name", {
        value: name2,
        configurable: true
      });
    }
    __name(setClassName, "setClassName");
    var PrismaClientInitializationError2 = /* @__PURE__ */ __name(class _PrismaClientInitializationError extends Error {
      clientVersion;
      errorCode;
      retryable;
      constructor(message, clientVersion, errorCode) {
        super(message);
        this.name = "PrismaClientInitializationError";
        this.clientVersion = clientVersion;
        this.errorCode = errorCode;
        Error.captureStackTrace(_PrismaClientInitializationError);
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientInitializationError";
      }
    }, "_PrismaClientInitializationError");
    setClassName(PrismaClientInitializationError2, "PrismaClientInitializationError");
    var PrismaClientKnownRequestError2 = /* @__PURE__ */ __name(class extends Error {
      code;
      meta;
      clientVersion;
      batchRequestIdx;
      constructor(message, { code, clientVersion, meta, batchRequestIdx }) {
        super(message);
        this.name = "PrismaClientKnownRequestError";
        this.code = code;
        this.clientVersion = clientVersion;
        this.meta = meta;
        Object.defineProperty(this, "batchRequestIdx", {
          value: batchRequestIdx,
          enumerable: false,
          writable: true
        });
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientKnownRequestError";
      }
    }, "PrismaClientKnownRequestError");
    setClassName(PrismaClientKnownRequestError2, "PrismaClientKnownRequestError");
    function getBacktrace(log32) {
      if (log32.fields?.message) {
        let str = log32.fields?.message;
        if (log32.fields?.file) {
          str += ` in ${log32.fields.file}`;
          if (log32.fields?.line) {
            str += `:${log32.fields.line}`;
          }
          if (log32.fields?.column) {
            str += `:${log32.fields.column}`;
          }
        }
        if (log32.fields?.reason) {
          str += `
${log32.fields?.reason}`;
        }
        return str;
      }
      return "Unknown error";
    }
    __name(getBacktrace, "getBacktrace");
    function isPanic(err) {
      return err.fields?.message === "PANIC";
    }
    __name(isPanic, "isPanic");
    var PrismaClientRustError = /* @__PURE__ */ __name(class extends Error {
      clientVersion;
      _isPanic;
      constructor({ clientVersion, error: error3 }) {
        const backtrace = getBacktrace(error3);
        super(backtrace ?? "Unknown error");
        this._isPanic = isPanic(error3);
        this.clientVersion = clientVersion;
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientRustError";
      }
      isPanic() {
        return this._isPanic;
      }
    }, "PrismaClientRustError");
    setClassName(PrismaClientRustError, "PrismaClientRustError");
    var PrismaClientRustPanicError2 = /* @__PURE__ */ __name(class extends Error {
      clientVersion;
      constructor(message, clientVersion) {
        super(message);
        this.name = "PrismaClientRustPanicError";
        this.clientVersion = clientVersion;
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientRustPanicError";
      }
    }, "PrismaClientRustPanicError");
    setClassName(PrismaClientRustPanicError2, "PrismaClientRustPanicError");
    var PrismaClientUnknownRequestError2 = /* @__PURE__ */ __name(class extends Error {
      clientVersion;
      batchRequestIdx;
      constructor(message, { clientVersion, batchRequestIdx }) {
        super(message);
        this.name = "PrismaClientUnknownRequestError";
        this.clientVersion = clientVersion;
        Object.defineProperty(this, "batchRequestIdx", {
          value: batchRequestIdx,
          writable: true,
          enumerable: false
        });
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientUnknownRequestError";
      }
    }, "PrismaClientUnknownRequestError");
    setClassName(PrismaClientUnknownRequestError2, "PrismaClientUnknownRequestError");
    var PrismaClientValidationError2 = /* @__PURE__ */ __name(class extends Error {
      name = "PrismaClientValidationError";
      clientVersion;
      constructor(message, { clientVersion }) {
        super(message);
        this.clientVersion = clientVersion;
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientValidationError";
      }
    }, "PrismaClientValidationError");
    setClassName(PrismaClientValidationError2, "PrismaClientValidationError");
    var secret = Symbol();
    var representations = /* @__PURE__ */ new WeakMap();
    var ObjectEnumValue2 = /* @__PURE__ */ __name(class {
      constructor(arg) {
        if (arg === secret) {
          representations.set(this, `Prisma.${this._getName()}`);
        } else {
          representations.set(this, `new Prisma.${this._getNamespace()}.${this._getName()}()`);
        }
      }
      _getName() {
        return this.constructor.name;
      }
      toString() {
        return representations.get(this);
      }
    }, "ObjectEnumValue");
    function setClassName2(classObject, name2) {
      Object.defineProperty(classObject, "name", {
        value: name2,
        configurable: true
      });
    }
    __name(setClassName2, "setClassName2");
    var NullTypesEnumValue = /* @__PURE__ */ __name(class extends ObjectEnumValue2 {
      _getNamespace() {
        return "NullTypes";
      }
    }, "NullTypesEnumValue");
    var DbNullClass = /* @__PURE__ */ __name(class extends NullTypesEnumValue {
      // Phantom private property to prevent structural type equality
      // eslint-disable-next-line no-unused-private-class-members
      #_brand_DbNull;
    }, "DbNullClass");
    setClassName2(DbNullClass, "DbNull");
    var JsonNullClass = /* @__PURE__ */ __name(class extends NullTypesEnumValue {
      // Phantom private property to prevent structural type equality
      // eslint-disable-next-line no-unused-private-class-members
      #_brand_JsonNull;
    }, "JsonNullClass");
    setClassName2(JsonNullClass, "JsonNull");
    var AnyNullClass = /* @__PURE__ */ __name(class extends NullTypesEnumValue {
      // Phantom private property to prevent structural type equality
      // eslint-disable-next-line no-unused-private-class-members
      #_brand_AnyNull;
    }, "AnyNullClass");
    setClassName2(AnyNullClass, "AnyNull");
    var NullTypes2 = {
      DbNull: DbNullClass,
      JsonNull: JsonNullClass,
      AnyNull: AnyNullClass
    };
    var DbNull2 = new DbNullClass(secret);
    var JsonNull2 = new JsonNullClass(secret);
    var AnyNull2 = new AnyNullClass(secret);
    function isDbNull2(value) {
      return value === DbNull2;
    }
    __name(isDbNull2, "isDbNull");
    function isJsonNull2(value) {
      return value === JsonNull2;
    }
    __name(isJsonNull2, "isJsonNull");
    function isAnyNull2(value) {
      return value === AnyNull2;
    }
    __name(isAnyNull2, "isAnyNull");
    var EXP_LIMIT = 9e15;
    var MAX_DIGITS = 1e9;
    var NUMERALS = "0123456789abcdef";
    var LN10 = "2.3025850929940456840179914546843642076011014886287729760333279009675726096773524802359972050895982983419677840422862486334095254650828067566662873690987816894829072083255546808437998948262331985283935053089653777326288461633662222876982198867465436674744042432743651550489343149393914796194044002221051017141748003688084012647080685567743216228355220114804663715659121373450747856947683463616792101806445070648000277502684916746550586856935673420670581136429224554405758925724208241314695689016758940256776311356919292033376587141660230105703089634572075440370847469940168269282808481184289314848524948644871927809676271275775397027668605952496716674183485704422507197965004714951050492214776567636938662976979522110718264549734772662425709429322582798502585509785265383207606726317164309505995087807523710333101197857547331541421808427543863591778117054309827482385045648019095610299291824318237525357709750539565187697510374970888692180205189339507238539205144634197265287286965110862571492198849978748873771345686209167058";
    var PI = "3.1415926535897932384626433832795028841971693993751058209749445923078164062862089986280348253421170679821480865132823066470938446095505822317253594081284811174502841027019385211055596446229489549303819644288109756659334461284756482337867831652712019091456485669234603486104543266482133936072602491412737245870066063155881748815209209628292540917153643678925903600113305305488204665213841469519415116094330572703657595919530921861173819326117931051185480744623799627495673518857527248912279381830119491298336733624406566430860213949463952247371907021798609437027705392171762931767523846748184676694051320005681271452635608277857713427577896091736371787214684409012249534301465495853710507922796892589235420199561121290219608640344181598136297747713099605187072113499999983729780499510597317328160963185950244594553469083026425223082533446850352619311881710100031378387528865875332083814206171776691473035982534904287554687311595628638823537875937519577818577805321712268066130019278766111959092164201989380952572010654858632789";
    var DEFAULTS = {
      // These values must be integers within the stated ranges (inclusive).
      // Most of these values can be changed at run-time using the `Decimal.config` method.
      // The maximum number of significant digits of the result of a calculation or base conversion.
      // E.g. `Decimal.config({ precision: 20 });`
      precision: 20,
      // 1 to MAX_DIGITS
      // The rounding mode used when rounding to `precision`.
      //
      // ROUND_UP         0 Away from zero.
      // ROUND_DOWN       1 Towards zero.
      // ROUND_CEIL       2 Towards +Infinity.
      // ROUND_FLOOR      3 Towards -Infinity.
      // ROUND_HALF_UP    4 Towards nearest neighbour. If equidistant, up.
      // ROUND_HALF_DOWN  5 Towards nearest neighbour. If equidistant, down.
      // ROUND_HALF_EVEN  6 Towards nearest neighbour. If equidistant, towards even neighbour.
      // ROUND_HALF_CEIL  7 Towards nearest neighbour. If equidistant, towards +Infinity.
      // ROUND_HALF_FLOOR 8 Towards nearest neighbour. If equidistant, towards -Infinity.
      //
      // E.g.
      // `Decimal.rounding = 4;`
      // `Decimal.rounding = Decimal.ROUND_HALF_UP;`
      rounding: 4,
      // 0 to 8
      // The modulo mode used when calculating the modulus: a mod n.
      // The quotient (q = a / n) is calculated according to the corresponding rounding mode.
      // The remainder (r) is calculated as: r = a - n * q.
      //
      // UP         0 The remainder is positive if the dividend is negative, else is negative.
      // DOWN       1 The remainder has the same sign as the dividend (JavaScript %).
      // FLOOR      3 The remainder has the same sign as the divisor (Python %).
      // HALF_EVEN  6 The IEEE 754 remainder function.
      // EUCLID     9 Euclidian division. q = sign(n) * floor(a / abs(n)). Always positive.
      //
      // Truncated division (1), floored division (3), the IEEE 754 remainder (6), and Euclidian
      // division (9) are commonly used for the modulus operation. The other rounding modes can also
      // be used, but they may not give useful results.
      modulo: 1,
      // 0 to 9
      // The exponent value at and beneath which `toString` returns exponential notation.
      // JavaScript numbers: -7
      toExpNeg: -7,
      // 0 to -EXP_LIMIT
      // The exponent value at and above which `toString` returns exponential notation.
      // JavaScript numbers: 21
      toExpPos: 21,
      // 0 to EXP_LIMIT
      // The minimum exponent value, beneath which underflow to zero occurs.
      // JavaScript numbers: -324  (5e-324)
      minE: -EXP_LIMIT,
      // -1 to -EXP_LIMIT
      // The maximum exponent value, above which overflow to Infinity occurs.
      // JavaScript numbers: 308  (1.7976931348623157e+308)
      maxE: EXP_LIMIT,
      // 1 to EXP_LIMIT
      // Whether to use cryptographically-secure random number generation, if available.
      crypto: false
      // true/false
    };
    var inexact;
    var quadrant;
    var external = true;
    var decimalError = "[DecimalError] ";
    var invalidArgument = decimalError + "Invalid argument: ";
    var precisionLimitExceeded = decimalError + "Precision limit exceeded";
    var cryptoUnavailable = decimalError + "crypto unavailable";
    var tag = "[object Decimal]";
    var mathfloor = Math.floor;
    var mathpow = Math.pow;
    var isBinary = /^0b([01]+(\.[01]*)?|\.[01]+)(p[+-]?\d+)?$/i;
    var isHex = /^0x([0-9a-f]+(\.[0-9a-f]*)?|\.[0-9a-f]+)(p[+-]?\d+)?$/i;
    var isOctal = /^0o([0-7]+(\.[0-7]*)?|\.[0-7]+)(p[+-]?\d+)?$/i;
    var isDecimal = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i;
    var BASE = 1e7;
    var LOG_BASE = 7;
    var MAX_SAFE_INTEGER = 9007199254740991;
    var LN10_PRECISION = LN10.length - 1;
    var PI_PRECISION = PI.length - 1;
    var P = { toStringTag: tag };
    P.absoluteValue = P.abs = function() {
      var x = new this.constructor(this);
      if (x.s < 0)
        x.s = 1;
      return finalise(x);
    };
    P.ceil = function() {
      return finalise(new this.constructor(this), this.e + 1, 2);
    };
    P.clampedTo = P.clamp = function(min2, max2) {
      var k, x = this, Ctor = x.constructor;
      min2 = new Ctor(min2);
      max2 = new Ctor(max2);
      if (!min2.s || !max2.s)
        return new Ctor(NaN);
      if (min2.gt(max2))
        throw Error(invalidArgument + max2);
      k = x.cmp(min2);
      return k < 0 ? min2 : x.cmp(max2) > 0 ? max2 : new Ctor(x);
    };
    P.comparedTo = P.cmp = function(y) {
      var i, j, xdL, ydL, x = this, xd = x.d, yd = (y = new x.constructor(y)).d, xs = x.s, ys = y.s;
      if (!xd || !yd) {
        return !xs || !ys ? NaN : xs !== ys ? xs : xd === yd ? 0 : !xd ^ xs < 0 ? 1 : -1;
      }
      if (!xd[0] || !yd[0])
        return xd[0] ? xs : yd[0] ? -ys : 0;
      if (xs !== ys)
        return xs;
      if (x.e !== y.e)
        return x.e > y.e ^ xs < 0 ? 1 : -1;
      xdL = xd.length;
      ydL = yd.length;
      for (i = 0, j = xdL < ydL ? xdL : ydL; i < j; ++i) {
        if (xd[i] !== yd[i])
          return xd[i] > yd[i] ^ xs < 0 ? 1 : -1;
      }
      return xdL === ydL ? 0 : xdL > ydL ^ xs < 0 ? 1 : -1;
    };
    P.cosine = P.cos = function() {
      var pr, rm, x = this, Ctor = x.constructor;
      if (!x.d)
        return new Ctor(NaN);
      if (!x.d[0])
        return new Ctor(1);
      pr = Ctor.precision;
      rm = Ctor.rounding;
      Ctor.precision = pr + Math.max(x.e, x.sd()) + LOG_BASE;
      Ctor.rounding = 1;
      x = cosine(Ctor, toLessThanHalfPi(Ctor, x));
      Ctor.precision = pr;
      Ctor.rounding = rm;
      return finalise(quadrant == 2 || quadrant == 3 ? x.neg() : x, pr, rm, true);
    };
    P.cubeRoot = P.cbrt = function() {
      var e, m, n, r, rep, s, sd, t, t3, t3plusx, x = this, Ctor = x.constructor;
      if (!x.isFinite() || x.isZero())
        return new Ctor(x);
      external = false;
      s = x.s * mathpow(x.s * x, 1 / 3);
      if (!s || Math.abs(s) == 1 / 0) {
        n = digitsToString(x.d);
        e = x.e;
        if (s = (e - n.length + 1) % 3)
          n += s == 1 || s == -2 ? "0" : "00";
        s = mathpow(n, 1 / 3);
        e = mathfloor((e + 1) / 3) - (e % 3 == (e < 0 ? -1 : 2));
        if (s == 1 / 0) {
          n = "5e" + e;
        } else {
          n = s.toExponential();
          n = n.slice(0, n.indexOf("e") + 1) + e;
        }
        r = new Ctor(n);
        r.s = x.s;
      } else {
        r = new Ctor(s.toString());
      }
      sd = (e = Ctor.precision) + 3;
      for (; ; ) {
        t = r;
        t3 = t.times(t).times(t);
        t3plusx = t3.plus(x);
        r = divide(t3plusx.plus(x).times(t), t3plusx.plus(t3), sd + 2, 1);
        if (digitsToString(t.d).slice(0, sd) === (n = digitsToString(r.d)).slice(0, sd)) {
          n = n.slice(sd - 3, sd + 1);
          if (n == "9999" || !rep && n == "4999") {
            if (!rep) {
              finalise(t, e + 1, 0);
              if (t.times(t).times(t).eq(x)) {
                r = t;
                break;
              }
            }
            sd += 4;
            rep = 1;
          } else {
            if (!+n || !+n.slice(1) && n.charAt(0) == "5") {
              finalise(r, e + 1, 1);
              m = !r.times(r).times(r).eq(x);
            }
            break;
          }
        }
      }
      external = true;
      return finalise(r, e, Ctor.rounding, m);
    };
    P.decimalPlaces = P.dp = function() {
      var w, d = this.d, n = NaN;
      if (d) {
        w = d.length - 1;
        n = (w - mathfloor(this.e / LOG_BASE)) * LOG_BASE;
        w = d[w];
        if (w)
          for (; w % 10 == 0; w /= 10)
            n--;
        if (n < 0)
          n = 0;
      }
      return n;
    };
    P.dividedBy = P.div = function(y) {
      return divide(this, new this.constructor(y));
    };
    P.dividedToIntegerBy = P.divToInt = function(y) {
      var x = this, Ctor = x.constructor;
      return finalise(divide(x, new Ctor(y), 0, 1, 1), Ctor.precision, Ctor.rounding);
    };
    P.equals = P.eq = function(y) {
      return this.cmp(y) === 0;
    };
    P.floor = function() {
      return finalise(new this.constructor(this), this.e + 1, 3);
    };
    P.greaterThan = P.gt = function(y) {
      return this.cmp(y) > 0;
    };
    P.greaterThanOrEqualTo = P.gte = function(y) {
      var k = this.cmp(y);
      return k == 1 || k === 0;
    };
    P.hyperbolicCosine = P.cosh = function() {
      var k, n, pr, rm, len, x = this, Ctor = x.constructor, one = new Ctor(1);
      if (!x.isFinite())
        return new Ctor(x.s ? 1 / 0 : NaN);
      if (x.isZero())
        return one;
      pr = Ctor.precision;
      rm = Ctor.rounding;
      Ctor.precision = pr + Math.max(x.e, x.sd()) + 4;
      Ctor.rounding = 1;
      len = x.d.length;
      if (len < 32) {
        k = Math.ceil(len / 3);
        n = (1 / tinyPow(4, k)).toString();
      } else {
        k = 16;
        n = "2.3283064365386962890625e-10";
      }
      x = taylorSeries(Ctor, 1, x.times(n), new Ctor(1), true);
      var cosh2_x, i = k, d8 = new Ctor(8);
      for (; i--; ) {
        cosh2_x = x.times(x);
        x = one.minus(cosh2_x.times(d8.minus(cosh2_x.times(d8))));
      }
      return finalise(x, Ctor.precision = pr, Ctor.rounding = rm, true);
    };
    P.hyperbolicSine = P.sinh = function() {
      var k, pr, rm, len, x = this, Ctor = x.constructor;
      if (!x.isFinite() || x.isZero())
        return new Ctor(x);
      pr = Ctor.precision;
      rm = Ctor.rounding;
      Ctor.precision = pr + Math.max(x.e, x.sd()) + 4;
      Ctor.rounding = 1;
      len = x.d.length;
      if (len < 3) {
        x = taylorSeries(Ctor, 2, x, x, true);
      } else {
        k = 1.4 * Math.sqrt(len);
        k = k > 16 ? 16 : k | 0;
        x = x.times(1 / tinyPow(5, k));
        x = taylorSeries(Ctor, 2, x, x, true);
        var sinh2_x, d5 = new Ctor(5), d16 = new Ctor(16), d20 = new Ctor(20);
        for (; k--; ) {
          sinh2_x = x.times(x);
          x = x.times(d5.plus(sinh2_x.times(d16.times(sinh2_x).plus(d20))));
        }
      }
      Ctor.precision = pr;
      Ctor.rounding = rm;
      return finalise(x, pr, rm, true);
    };
    P.hyperbolicTangent = P.tanh = function() {
      var pr, rm, x = this, Ctor = x.constructor;
      if (!x.isFinite())
        return new Ctor(x.s);
      if (x.isZero())
        return new Ctor(x);
      pr = Ctor.precision;
      rm = Ctor.rounding;
      Ctor.precision = pr + 7;
      Ctor.rounding = 1;
      return divide(x.sinh(), x.cosh(), Ctor.precision = pr, Ctor.rounding = rm);
    };
    P.inverseCosine = P.acos = function() {
      var x = this, Ctor = x.constructor, k = x.abs().cmp(1), pr = Ctor.precision, rm = Ctor.rounding;
      if (k !== -1) {
        return k === 0 ? x.isNeg() ? getPi(Ctor, pr, rm) : new Ctor(0) : new Ctor(NaN);
      }
      if (x.isZero())
        return getPi(Ctor, pr + 4, rm).times(0.5);
      Ctor.precision = pr + 6;
      Ctor.rounding = 1;
      x = new Ctor(1).minus(x).div(x.plus(1)).sqrt().atan();
      Ctor.precision = pr;
      Ctor.rounding = rm;
      return x.times(2);
    };
    P.inverseHyperbolicCosine = P.acosh = function() {
      var pr, rm, x = this, Ctor = x.constructor;
      if (x.lte(1))
        return new Ctor(x.eq(1) ? 0 : NaN);
      if (!x.isFinite())
        return new Ctor(x);
      pr = Ctor.precision;
      rm = Ctor.rounding;
      Ctor.precision = pr + Math.max(Math.abs(x.e), x.sd()) + 4;
      Ctor.rounding = 1;
      external = false;
      x = x.times(x).minus(1).sqrt().plus(x);
      external = true;
      Ctor.precision = pr;
      Ctor.rounding = rm;
      return x.ln();
    };
    P.inverseHyperbolicSine = P.asinh = function() {
      var pr, rm, x = this, Ctor = x.constructor;
      if (!x.isFinite() || x.isZero())
        return new Ctor(x);
      pr = Ctor.precision;
      rm = Ctor.rounding;
      Ctor.precision = pr + 2 * Math.max(Math.abs(x.e), x.sd()) + 6;
      Ctor.rounding = 1;
      external = false;
      x = x.times(x).plus(1).sqrt().plus(x);
      external = true;
      Ctor.precision = pr;
      Ctor.rounding = rm;
      return x.ln();
    };
    P.inverseHyperbolicTangent = P.atanh = function() {
      var pr, rm, wpr, xsd, x = this, Ctor = x.constructor;
      if (!x.isFinite())
        return new Ctor(NaN);
      if (x.e >= 0)
        return new Ctor(x.abs().eq(1) ? x.s / 0 : x.isZero() ? x : NaN);
      pr = Ctor.precision;
      rm = Ctor.rounding;
      xsd = x.sd();
      if (Math.max(xsd, pr) < 2 * -x.e - 1)
        return finalise(new Ctor(x), pr, rm, true);
      Ctor.precision = wpr = xsd - x.e;
      x = divide(x.plus(1), new Ctor(1).minus(x), wpr + pr, 1);
      Ctor.precision = pr + 4;
      Ctor.rounding = 1;
      x = x.ln();
      Ctor.precision = pr;
      Ctor.rounding = rm;
      return x.times(0.5);
    };
    P.inverseSine = P.asin = function() {
      var halfPi, k, pr, rm, x = this, Ctor = x.constructor;
      if (x.isZero())
        return new Ctor(x);
      k = x.abs().cmp(1);
      pr = Ctor.precision;
      rm = Ctor.rounding;
      if (k !== -1) {
        if (k === 0) {
          halfPi = getPi(Ctor, pr + 4, rm).times(0.5);
          halfPi.s = x.s;
          return halfPi;
        }
        return new Ctor(NaN);
      }
      Ctor.precision = pr + 6;
      Ctor.rounding = 1;
      x = x.div(new Ctor(1).minus(x.times(x)).sqrt().plus(1)).atan();
      Ctor.precision = pr;
      Ctor.rounding = rm;
      return x.times(2);
    };
    P.inverseTangent = P.atan = function() {
      var i, j, k, n, px, t, r, wpr, x2, x = this, Ctor = x.constructor, pr = Ctor.precision, rm = Ctor.rounding;
      if (!x.isFinite()) {
        if (!x.s)
          return new Ctor(NaN);
        if (pr + 4 <= PI_PRECISION) {
          r = getPi(Ctor, pr + 4, rm).times(0.5);
          r.s = x.s;
          return r;
        }
      } else if (x.isZero()) {
        return new Ctor(x);
      } else if (x.abs().eq(1) && pr + 4 <= PI_PRECISION) {
        r = getPi(Ctor, pr + 4, rm).times(0.25);
        r.s = x.s;
        return r;
      }
      Ctor.precision = wpr = pr + 10;
      Ctor.rounding = 1;
      k = Math.min(28, wpr / LOG_BASE + 2 | 0);
      for (i = k; i; --i)
        x = x.div(x.times(x).plus(1).sqrt().plus(1));
      external = false;
      j = Math.ceil(wpr / LOG_BASE);
      n = 1;
      x2 = x.times(x);
      r = new Ctor(x);
      px = x;
      for (; i !== -1; ) {
        px = px.times(x2);
        t = r.minus(px.div(n += 2));
        px = px.times(x2);
        r = t.plus(px.div(n += 2));
        if (r.d[j] !== void 0)
          for (i = j; r.d[i] === t.d[i] && i--; )
            ;
      }
      if (k)
        r = r.times(2 << k - 1);
      external = true;
      return finalise(r, Ctor.precision = pr, Ctor.rounding = rm, true);
    };
    P.isFinite = function() {
      return !!this.d;
    };
    P.isInteger = P.isInt = function() {
      return !!this.d && mathfloor(this.e / LOG_BASE) > this.d.length - 2;
    };
    P.isNaN = function() {
      return !this.s;
    };
    P.isNegative = P.isNeg = function() {
      return this.s < 0;
    };
    P.isPositive = P.isPos = function() {
      return this.s > 0;
    };
    P.isZero = function() {
      return !!this.d && this.d[0] === 0;
    };
    P.lessThan = P.lt = function(y) {
      return this.cmp(y) < 0;
    };
    P.lessThanOrEqualTo = P.lte = function(y) {
      return this.cmp(y) < 1;
    };
    P.logarithm = P.log = function(base) {
      var isBase10, d, denominator, k, inf, num, sd, r, arg = this, Ctor = arg.constructor, pr = Ctor.precision, rm = Ctor.rounding, guard = 5;
      if (base == null) {
        base = new Ctor(10);
        isBase10 = true;
      } else {
        base = new Ctor(base);
        d = base.d;
        if (base.s < 0 || !d || !d[0] || base.eq(1))
          return new Ctor(NaN);
        isBase10 = base.eq(10);
      }
      d = arg.d;
      if (arg.s < 0 || !d || !d[0] || arg.eq(1)) {
        return new Ctor(d && !d[0] ? -1 / 0 : arg.s != 1 ? NaN : d ? 0 : 1 / 0);
      }
      if (isBase10) {
        if (d.length > 1) {
          inf = true;
        } else {
          for (k = d[0]; k % 10 === 0; )
            k /= 10;
          inf = k !== 1;
        }
      }
      external = false;
      sd = pr + guard;
      num = naturalLogarithm(arg, sd);
      denominator = isBase10 ? getLn10(Ctor, sd + 10) : naturalLogarithm(base, sd);
      r = divide(num, denominator, sd, 1);
      if (checkRoundingDigits(r.d, k = pr, rm)) {
        do {
          sd += 10;
          num = naturalLogarithm(arg, sd);
          denominator = isBase10 ? getLn10(Ctor, sd + 10) : naturalLogarithm(base, sd);
          r = divide(num, denominator, sd, 1);
          if (!inf) {
            if (+digitsToString(r.d).slice(k + 1, k + 15) + 1 == 1e14) {
              r = finalise(r, pr + 1, 0);
            }
            break;
          }
        } while (checkRoundingDigits(r.d, k += 10, rm));
      }
      external = true;
      return finalise(r, pr, rm);
    };
    P.minus = P.sub = function(y) {
      var d, e, i, j, k, len, pr, rm, xd, xe, xLTy, yd, x = this, Ctor = x.constructor;
      y = new Ctor(y);
      if (!x.d || !y.d) {
        if (!x.s || !y.s)
          y = new Ctor(NaN);
        else if (x.d)
          y.s = -y.s;
        else
          y = new Ctor(y.d || x.s !== y.s ? x : NaN);
        return y;
      }
      if (x.s != y.s) {
        y.s = -y.s;
        return x.plus(y);
      }
      xd = x.d;
      yd = y.d;
      pr = Ctor.precision;
      rm = Ctor.rounding;
      if (!xd[0] || !yd[0]) {
        if (yd[0])
          y.s = -y.s;
        else if (xd[0])
          y = new Ctor(x);
        else
          return new Ctor(rm === 3 ? -0 : 0);
        return external ? finalise(y, pr, rm) : y;
      }
      e = mathfloor(y.e / LOG_BASE);
      xe = mathfloor(x.e / LOG_BASE);
      xd = xd.slice();
      k = xe - e;
      if (k) {
        xLTy = k < 0;
        if (xLTy) {
          d = xd;
          k = -k;
          len = yd.length;
        } else {
          d = yd;
          e = xe;
          len = xd.length;
        }
        i = Math.max(Math.ceil(pr / LOG_BASE), len) + 2;
        if (k > i) {
          k = i;
          d.length = 1;
        }
        d.reverse();
        for (i = k; i--; )
          d.push(0);
        d.reverse();
      } else {
        i = xd.length;
        len = yd.length;
        xLTy = i < len;
        if (xLTy)
          len = i;
        for (i = 0; i < len; i++) {
          if (xd[i] != yd[i]) {
            xLTy = xd[i] < yd[i];
            break;
          }
        }
        k = 0;
      }
      if (xLTy) {
        d = xd;
        xd = yd;
        yd = d;
        y.s = -y.s;
      }
      len = xd.length;
      for (i = yd.length - len; i > 0; --i)
        xd[len++] = 0;
      for (i = yd.length; i > k; ) {
        if (xd[--i] < yd[i]) {
          for (j = i; j && xd[--j] === 0; )
            xd[j] = BASE - 1;
          --xd[j];
          xd[i] += BASE;
        }
        xd[i] -= yd[i];
      }
      for (; xd[--len] === 0; )
        xd.pop();
      for (; xd[0] === 0; xd.shift())
        --e;
      if (!xd[0])
        return new Ctor(rm === 3 ? -0 : 0);
      y.d = xd;
      y.e = getBase10Exponent(xd, e);
      return external ? finalise(y, pr, rm) : y;
    };
    P.modulo = P.mod = function(y) {
      var q, x = this, Ctor = x.constructor;
      y = new Ctor(y);
      if (!x.d || !y.s || y.d && !y.d[0])
        return new Ctor(NaN);
      if (!y.d || x.d && !x.d[0]) {
        return finalise(new Ctor(x), Ctor.precision, Ctor.rounding);
      }
      external = false;
      if (Ctor.modulo == 9) {
        q = divide(x, y.abs(), 0, 3, 1);
        q.s *= y.s;
      } else {
        q = divide(x, y, 0, Ctor.modulo, 1);
      }
      q = q.times(y);
      external = true;
      return x.minus(q);
    };
    P.naturalExponential = P.exp = function() {
      return naturalExponential(this);
    };
    P.naturalLogarithm = P.ln = function() {
      return naturalLogarithm(this);
    };
    P.negated = P.neg = function() {
      var x = new this.constructor(this);
      x.s = -x.s;
      return finalise(x);
    };
    P.plus = P.add = function(y) {
      var carry, d, e, i, k, len, pr, rm, xd, yd, x = this, Ctor = x.constructor;
      y = new Ctor(y);
      if (!x.d || !y.d) {
        if (!x.s || !y.s)
          y = new Ctor(NaN);
        else if (!x.d)
          y = new Ctor(y.d || x.s === y.s ? x : NaN);
        return y;
      }
      if (x.s != y.s) {
        y.s = -y.s;
        return x.minus(y);
      }
      xd = x.d;
      yd = y.d;
      pr = Ctor.precision;
      rm = Ctor.rounding;
      if (!xd[0] || !yd[0]) {
        if (!yd[0])
          y = new Ctor(x);
        return external ? finalise(y, pr, rm) : y;
      }
      k = mathfloor(x.e / LOG_BASE);
      e = mathfloor(y.e / LOG_BASE);
      xd = xd.slice();
      i = k - e;
      if (i) {
        if (i < 0) {
          d = xd;
          i = -i;
          len = yd.length;
        } else {
          d = yd;
          e = k;
          len = xd.length;
        }
        k = Math.ceil(pr / LOG_BASE);
        len = k > len ? k + 1 : len + 1;
        if (i > len) {
          i = len;
          d.length = 1;
        }
        d.reverse();
        for (; i--; )
          d.push(0);
        d.reverse();
      }
      len = xd.length;
      i = yd.length;
      if (len - i < 0) {
        i = len;
        d = yd;
        yd = xd;
        xd = d;
      }
      for (carry = 0; i; ) {
        carry = (xd[--i] = xd[i] + yd[i] + carry) / BASE | 0;
        xd[i] %= BASE;
      }
      if (carry) {
        xd.unshift(carry);
        ++e;
      }
      for (len = xd.length; xd[--len] == 0; )
        xd.pop();
      y.d = xd;
      y.e = getBase10Exponent(xd, e);
      return external ? finalise(y, pr, rm) : y;
    };
    P.precision = P.sd = function(z) {
      var k, x = this;
      if (z !== void 0 && z !== !!z && z !== 1 && z !== 0)
        throw Error(invalidArgument + z);
      if (x.d) {
        k = getPrecision(x.d);
        if (z && x.e + 1 > k)
          k = x.e + 1;
      } else {
        k = NaN;
      }
      return k;
    };
    P.round = function() {
      var x = this, Ctor = x.constructor;
      return finalise(new Ctor(x), x.e + 1, Ctor.rounding);
    };
    P.sine = P.sin = function() {
      var pr, rm, x = this, Ctor = x.constructor;
      if (!x.isFinite())
        return new Ctor(NaN);
      if (x.isZero())
        return new Ctor(x);
      pr = Ctor.precision;
      rm = Ctor.rounding;
      Ctor.precision = pr + Math.max(x.e, x.sd()) + LOG_BASE;
      Ctor.rounding = 1;
      x = sine(Ctor, toLessThanHalfPi(Ctor, x));
      Ctor.precision = pr;
      Ctor.rounding = rm;
      return finalise(quadrant > 2 ? x.neg() : x, pr, rm, true);
    };
    P.squareRoot = P.sqrt = function() {
      var m, n, sd, r, rep, t, x = this, d = x.d, e = x.e, s = x.s, Ctor = x.constructor;
      if (s !== 1 || !d || !d[0]) {
        return new Ctor(!s || s < 0 && (!d || d[0]) ? NaN : d ? x : 1 / 0);
      }
      external = false;
      s = Math.sqrt(+x);
      if (s == 0 || s == 1 / 0) {
        n = digitsToString(d);
        if ((n.length + e) % 2 == 0)
          n += "0";
        s = Math.sqrt(n);
        e = mathfloor((e + 1) / 2) - (e < 0 || e % 2);
        if (s == 1 / 0) {
          n = "5e" + e;
        } else {
          n = s.toExponential();
          n = n.slice(0, n.indexOf("e") + 1) + e;
        }
        r = new Ctor(n);
      } else {
        r = new Ctor(s.toString());
      }
      sd = (e = Ctor.precision) + 3;
      for (; ; ) {
        t = r;
        r = t.plus(divide(x, t, sd + 2, 1)).times(0.5);
        if (digitsToString(t.d).slice(0, sd) === (n = digitsToString(r.d)).slice(0, sd)) {
          n = n.slice(sd - 3, sd + 1);
          if (n == "9999" || !rep && n == "4999") {
            if (!rep) {
              finalise(t, e + 1, 0);
              if (t.times(t).eq(x)) {
                r = t;
                break;
              }
            }
            sd += 4;
            rep = 1;
          } else {
            if (!+n || !+n.slice(1) && n.charAt(0) == "5") {
              finalise(r, e + 1, 1);
              m = !r.times(r).eq(x);
            }
            break;
          }
        }
      }
      external = true;
      return finalise(r, e, Ctor.rounding, m);
    };
    P.tangent = P.tan = function() {
      var pr, rm, x = this, Ctor = x.constructor;
      if (!x.isFinite())
        return new Ctor(NaN);
      if (x.isZero())
        return new Ctor(x);
      pr = Ctor.precision;
      rm = Ctor.rounding;
      Ctor.precision = pr + 10;
      Ctor.rounding = 1;
      x = x.sin();
      x.s = 1;
      x = divide(x, new Ctor(1).minus(x.times(x)).sqrt(), pr + 10, 0);
      Ctor.precision = pr;
      Ctor.rounding = rm;
      return finalise(quadrant == 2 || quadrant == 4 ? x.neg() : x, pr, rm, true);
    };
    P.times = P.mul = function(y) {
      var carry, e, i, k, r, rL, t, xdL, ydL, x = this, Ctor = x.constructor, xd = x.d, yd = (y = new Ctor(y)).d;
      y.s *= x.s;
      if (!xd || !xd[0] || !yd || !yd[0]) {
        return new Ctor(!y.s || xd && !xd[0] && !yd || yd && !yd[0] && !xd ? NaN : !xd || !yd ? y.s / 0 : y.s * 0);
      }
      e = mathfloor(x.e / LOG_BASE) + mathfloor(y.e / LOG_BASE);
      xdL = xd.length;
      ydL = yd.length;
      if (xdL < ydL) {
        r = xd;
        xd = yd;
        yd = r;
        rL = xdL;
        xdL = ydL;
        ydL = rL;
      }
      r = [];
      rL = xdL + ydL;
      for (i = rL; i--; )
        r.push(0);
      for (i = ydL; --i >= 0; ) {
        carry = 0;
        for (k = xdL + i; k > i; ) {
          t = r[k] + yd[i] * xd[k - i - 1] + carry;
          r[k--] = t % BASE | 0;
          carry = t / BASE | 0;
        }
        r[k] = (r[k] + carry) % BASE | 0;
      }
      for (; !r[--rL]; )
        r.pop();
      if (carry)
        ++e;
      else
        r.shift();
      y.d = r;
      y.e = getBase10Exponent(r, e);
      return external ? finalise(y, Ctor.precision, Ctor.rounding) : y;
    };
    P.toBinary = function(sd, rm) {
      return toStringBinary(this, 2, sd, rm);
    };
    P.toDecimalPlaces = P.toDP = function(dp, rm) {
      var x = this, Ctor = x.constructor;
      x = new Ctor(x);
      if (dp === void 0)
        return x;
      checkInt32(dp, 0, MAX_DIGITS);
      if (rm === void 0)
        rm = Ctor.rounding;
      else
        checkInt32(rm, 0, 8);
      return finalise(x, dp + x.e + 1, rm);
    };
    P.toExponential = function(dp, rm) {
      var str, x = this, Ctor = x.constructor;
      if (dp === void 0) {
        str = finiteToString(x, true);
      } else {
        checkInt32(dp, 0, MAX_DIGITS);
        if (rm === void 0)
          rm = Ctor.rounding;
        else
          checkInt32(rm, 0, 8);
        x = finalise(new Ctor(x), dp + 1, rm);
        str = finiteToString(x, true, dp + 1);
      }
      return x.isNeg() && !x.isZero() ? "-" + str : str;
    };
    P.toFixed = function(dp, rm) {
      var str, y, x = this, Ctor = x.constructor;
      if (dp === void 0) {
        str = finiteToString(x);
      } else {
        checkInt32(dp, 0, MAX_DIGITS);
        if (rm === void 0)
          rm = Ctor.rounding;
        else
          checkInt32(rm, 0, 8);
        y = finalise(new Ctor(x), dp + x.e + 1, rm);
        str = finiteToString(y, false, dp + y.e + 1);
      }
      return x.isNeg() && !x.isZero() ? "-" + str : str;
    };
    P.toFraction = function(maxD) {
      var d, d0, d1, d2, e, k, n, n0, n1, pr, q, r, x = this, xd = x.d, Ctor = x.constructor;
      if (!xd)
        return new Ctor(x);
      n1 = d0 = new Ctor(1);
      d1 = n0 = new Ctor(0);
      d = new Ctor(d1);
      e = d.e = getPrecision(xd) - x.e - 1;
      k = e % LOG_BASE;
      d.d[0] = mathpow(10, k < 0 ? LOG_BASE + k : k);
      if (maxD == null) {
        maxD = e > 0 ? d : n1;
      } else {
        n = new Ctor(maxD);
        if (!n.isInt() || n.lt(n1))
          throw Error(invalidArgument + n);
        maxD = n.gt(d) ? e > 0 ? d : n1 : n;
      }
      external = false;
      n = new Ctor(digitsToString(xd));
      pr = Ctor.precision;
      Ctor.precision = e = xd.length * LOG_BASE * 2;
      for (; ; ) {
        q = divide(n, d, 0, 1, 1);
        d2 = d0.plus(q.times(d1));
        if (d2.cmp(maxD) == 1)
          break;
        d0 = d1;
        d1 = d2;
        d2 = n1;
        n1 = n0.plus(q.times(d2));
        n0 = d2;
        d2 = d;
        d = n.minus(q.times(d2));
        n = d2;
      }
      d2 = divide(maxD.minus(d0), d1, 0, 1, 1);
      n0 = n0.plus(d2.times(n1));
      d0 = d0.plus(d2.times(d1));
      n0.s = n1.s = x.s;
      r = divide(n1, d1, e, 1).minus(x).abs().cmp(divide(n0, d0, e, 1).minus(x).abs()) < 1 ? [n1, d1] : [n0, d0];
      Ctor.precision = pr;
      external = true;
      return r;
    };
    P.toHexadecimal = P.toHex = function(sd, rm) {
      return toStringBinary(this, 16, sd, rm);
    };
    P.toNearest = function(y, rm) {
      var x = this, Ctor = x.constructor;
      x = new Ctor(x);
      if (y == null) {
        if (!x.d)
          return x;
        y = new Ctor(1);
        rm = Ctor.rounding;
      } else {
        y = new Ctor(y);
        if (rm === void 0) {
          rm = Ctor.rounding;
        } else {
          checkInt32(rm, 0, 8);
        }
        if (!x.d)
          return y.s ? x : y;
        if (!y.d) {
          if (y.s)
            y.s = x.s;
          return y;
        }
      }
      if (y.d[0]) {
        external = false;
        x = divide(x, y, 0, rm, 1).times(y);
        external = true;
        finalise(x);
      } else {
        y.s = x.s;
        x = y;
      }
      return x;
    };
    P.toNumber = function() {
      return +this;
    };
    P.toOctal = function(sd, rm) {
      return toStringBinary(this, 8, sd, rm);
    };
    P.toPower = P.pow = function(y) {
      var e, k, pr, r, rm, s, x = this, Ctor = x.constructor, yn = +(y = new Ctor(y));
      if (!x.d || !y.d || !x.d[0] || !y.d[0])
        return new Ctor(mathpow(+x, yn));
      x = new Ctor(x);
      if (x.eq(1))
        return x;
      pr = Ctor.precision;
      rm = Ctor.rounding;
      if (y.eq(1))
        return finalise(x, pr, rm);
      e = mathfloor(y.e / LOG_BASE);
      if (e >= y.d.length - 1 && (k = yn < 0 ? -yn : yn) <= MAX_SAFE_INTEGER) {
        r = intPow(Ctor, x, k, pr);
        return y.s < 0 ? new Ctor(1).div(r) : finalise(r, pr, rm);
      }
      s = x.s;
      if (s < 0) {
        if (e < y.d.length - 1)
          return new Ctor(NaN);
        if ((y.d[e] & 1) == 0)
          s = 1;
        if (x.e == 0 && x.d[0] == 1 && x.d.length == 1) {
          x.s = s;
          return x;
        }
      }
      k = mathpow(+x, yn);
      e = k == 0 || !isFinite(k) ? mathfloor(yn * (Math.log("0." + digitsToString(x.d)) / Math.LN10 + x.e + 1)) : new Ctor(k + "").e;
      if (e > Ctor.maxE + 1 || e < Ctor.minE - 1)
        return new Ctor(e > 0 ? s / 0 : 0);
      external = false;
      Ctor.rounding = x.s = 1;
      k = Math.min(12, (e + "").length);
      r = naturalExponential(y.times(naturalLogarithm(x, pr + k)), pr);
      if (r.d) {
        r = finalise(r, pr + 5, 1);
        if (checkRoundingDigits(r.d, pr, rm)) {
          e = pr + 10;
          r = finalise(naturalExponential(y.times(naturalLogarithm(x, e + k)), e), e + 5, 1);
          if (+digitsToString(r.d).slice(pr + 1, pr + 15) + 1 == 1e14) {
            r = finalise(r, pr + 1, 0);
          }
        }
      }
      r.s = s;
      external = true;
      Ctor.rounding = rm;
      return finalise(r, pr, rm);
    };
    P.toPrecision = function(sd, rm) {
      var str, x = this, Ctor = x.constructor;
      if (sd === void 0) {
        str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);
      } else {
        checkInt32(sd, 1, MAX_DIGITS);
        if (rm === void 0)
          rm = Ctor.rounding;
        else
          checkInt32(rm, 0, 8);
        x = finalise(new Ctor(x), sd, rm);
        str = finiteToString(x, sd <= x.e || x.e <= Ctor.toExpNeg, sd);
      }
      return x.isNeg() && !x.isZero() ? "-" + str : str;
    };
    P.toSignificantDigits = P.toSD = function(sd, rm) {
      var x = this, Ctor = x.constructor;
      if (sd === void 0) {
        sd = Ctor.precision;
        rm = Ctor.rounding;
      } else {
        checkInt32(sd, 1, MAX_DIGITS);
        if (rm === void 0)
          rm = Ctor.rounding;
        else
          checkInt32(rm, 0, 8);
      }
      return finalise(new Ctor(x), sd, rm);
    };
    P.toString = function() {
      var x = this, Ctor = x.constructor, str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);
      return x.isNeg() && !x.isZero() ? "-" + str : str;
    };
    P.truncated = P.trunc = function() {
      return finalise(new this.constructor(this), this.e + 1, 1);
    };
    P.valueOf = P.toJSON = function() {
      var x = this, Ctor = x.constructor, str = finiteToString(x, x.e <= Ctor.toExpNeg || x.e >= Ctor.toExpPos);
      return x.isNeg() ? "-" + str : str;
    };
    function digitsToString(d) {
      var i, k, ws, indexOfLastWord = d.length - 1, str = "", w = d[0];
      if (indexOfLastWord > 0) {
        str += w;
        for (i = 1; i < indexOfLastWord; i++) {
          ws = d[i] + "";
          k = LOG_BASE - ws.length;
          if (k)
            str += getZeroString(k);
          str += ws;
        }
        w = d[i];
        ws = w + "";
        k = LOG_BASE - ws.length;
        if (k)
          str += getZeroString(k);
      } else if (w === 0) {
        return "0";
      }
      for (; w % 10 === 0; )
        w /= 10;
      return str + w;
    }
    __name(digitsToString, "digitsToString");
    function checkInt32(i, min2, max2) {
      if (i !== ~~i || i < min2 || i > max2) {
        throw Error(invalidArgument + i);
      }
    }
    __name(checkInt32, "checkInt32");
    function checkRoundingDigits(d, i, rm, repeating) {
      var di, k, r, rd;
      for (k = d[0]; k >= 10; k /= 10)
        --i;
      if (--i < 0) {
        i += LOG_BASE;
        di = 0;
      } else {
        di = Math.ceil((i + 1) / LOG_BASE);
        i %= LOG_BASE;
      }
      k = mathpow(10, LOG_BASE - i);
      rd = d[di] % k | 0;
      if (repeating == null) {
        if (i < 3) {
          if (i == 0)
            rd = rd / 100 | 0;
          else if (i == 1)
            rd = rd / 10 | 0;
          r = rm < 4 && rd == 99999 || rm > 3 && rd == 49999 || rd == 5e4 || rd == 0;
        } else {
          r = (rm < 4 && rd + 1 == k || rm > 3 && rd + 1 == k / 2) && (d[di + 1] / k / 100 | 0) == mathpow(10, i - 2) - 1 || (rd == k / 2 || rd == 0) && (d[di + 1] / k / 100 | 0) == 0;
        }
      } else {
        if (i < 4) {
          if (i == 0)
            rd = rd / 1e3 | 0;
          else if (i == 1)
            rd = rd / 100 | 0;
          else if (i == 2)
            rd = rd / 10 | 0;
          r = (repeating || rm < 4) && rd == 9999 || !repeating && rm > 3 && rd == 4999;
        } else {
          r = ((repeating || rm < 4) && rd + 1 == k || !repeating && rm > 3 && rd + 1 == k / 2) && (d[di + 1] / k / 1e3 | 0) == mathpow(10, i - 3) - 1;
        }
      }
      return r;
    }
    __name(checkRoundingDigits, "checkRoundingDigits");
    function convertBase(str, baseIn, baseOut) {
      var j, arr = [0], arrL, i = 0, strL = str.length;
      for (; i < strL; ) {
        for (arrL = arr.length; arrL--; )
          arr[arrL] *= baseIn;
        arr[0] += NUMERALS.indexOf(str.charAt(i++));
        for (j = 0; j < arr.length; j++) {
          if (arr[j] > baseOut - 1) {
            if (arr[j + 1] === void 0)
              arr[j + 1] = 0;
            arr[j + 1] += arr[j] / baseOut | 0;
            arr[j] %= baseOut;
          }
        }
      }
      return arr.reverse();
    }
    __name(convertBase, "convertBase");
    function cosine(Ctor, x) {
      var k, len, y;
      if (x.isZero())
        return x;
      len = x.d.length;
      if (len < 32) {
        k = Math.ceil(len / 3);
        y = (1 / tinyPow(4, k)).toString();
      } else {
        k = 16;
        y = "2.3283064365386962890625e-10";
      }
      Ctor.precision += k;
      x = taylorSeries(Ctor, 1, x.times(y), new Ctor(1));
      for (var i = k; i--; ) {
        var cos2x = x.times(x);
        x = cos2x.times(cos2x).minus(cos2x).times(8).plus(1);
      }
      Ctor.precision -= k;
      return x;
    }
    __name(cosine, "cosine");
    var divide = /* @__PURE__ */ function() {
      function multiplyInteger(x, k, base) {
        var temp, carry = 0, i = x.length;
        for (x = x.slice(); i--; ) {
          temp = x[i] * k + carry;
          x[i] = temp % base | 0;
          carry = temp / base | 0;
        }
        if (carry)
          x.unshift(carry);
        return x;
      }
      __name(multiplyInteger, "multiplyInteger");
      function compare(a, b, aL, bL) {
        var i, r;
        if (aL != bL) {
          r = aL > bL ? 1 : -1;
        } else {
          for (i = r = 0; i < aL; i++) {
            if (a[i] != b[i]) {
              r = a[i] > b[i] ? 1 : -1;
              break;
            }
          }
        }
        return r;
      }
      __name(compare, "compare");
      function subtract(a, b, aL, base) {
        var i = 0;
        for (; aL--; ) {
          a[aL] -= i;
          i = a[aL] < b[aL] ? 1 : 0;
          a[aL] = i * base + a[aL] - b[aL];
        }
        for (; !a[0] && a.length > 1; )
          a.shift();
      }
      __name(subtract, "subtract");
      return function(x, y, pr, rm, dp, base) {
        var cmp, e, i, k, logBase, more, prod, prodL, q, qd, rem, remL, rem0, sd, t, xi, xL, yd0, yL, yz, Ctor = x.constructor, sign2 = x.s == y.s ? 1 : -1, xd = x.d, yd = y.d;
        if (!xd || !xd[0] || !yd || !yd[0]) {
          return new Ctor(
            // Return NaN if either NaN, or both Infinity or 0.
            !x.s || !y.s || (xd ? yd && xd[0] == yd[0] : !yd) ? NaN : (
              // Return ±0 if x is 0 or y is ±Infinity, or return ±Infinity as y is 0.
              xd && xd[0] == 0 || !yd ? sign2 * 0 : sign2 / 0
            )
          );
        }
        if (base) {
          logBase = 1;
          e = x.e - y.e;
        } else {
          base = BASE;
          logBase = LOG_BASE;
          e = mathfloor(x.e / logBase) - mathfloor(y.e / logBase);
        }
        yL = yd.length;
        xL = xd.length;
        q = new Ctor(sign2);
        qd = q.d = [];
        for (i = 0; yd[i] == (xd[i] || 0); i++)
          ;
        if (yd[i] > (xd[i] || 0))
          e--;
        if (pr == null) {
          sd = pr = Ctor.precision;
          rm = Ctor.rounding;
        } else if (dp) {
          sd = pr + (x.e - y.e) + 1;
        } else {
          sd = pr;
        }
        if (sd < 0) {
          qd.push(1);
          more = true;
        } else {
          sd = sd / logBase + 2 | 0;
          i = 0;
          if (yL == 1) {
            k = 0;
            yd = yd[0];
            sd++;
            for (; (i < xL || k) && sd--; i++) {
              t = k * base + (xd[i] || 0);
              qd[i] = t / yd | 0;
              k = t % yd | 0;
            }
            more = k || i < xL;
          } else {
            k = base / (yd[0] + 1) | 0;
            if (k > 1) {
              yd = multiplyInteger(yd, k, base);
              xd = multiplyInteger(xd, k, base);
              yL = yd.length;
              xL = xd.length;
            }
            xi = yL;
            rem = xd.slice(0, yL);
            remL = rem.length;
            for (; remL < yL; )
              rem[remL++] = 0;
            yz = yd.slice();
            yz.unshift(0);
            yd0 = yd[0];
            if (yd[1] >= base / 2)
              ++yd0;
            do {
              k = 0;
              cmp = compare(yd, rem, yL, remL);
              if (cmp < 0) {
                rem0 = rem[0];
                if (yL != remL)
                  rem0 = rem0 * base + (rem[1] || 0);
                k = rem0 / yd0 | 0;
                if (k > 1) {
                  if (k >= base)
                    k = base - 1;
                  prod = multiplyInteger(yd, k, base);
                  prodL = prod.length;
                  remL = rem.length;
                  cmp = compare(prod, rem, prodL, remL);
                  if (cmp == 1) {
                    k--;
                    subtract(prod, yL < prodL ? yz : yd, prodL, base);
                  }
                } else {
                  if (k == 0)
                    cmp = k = 1;
                  prod = yd.slice();
                }
                prodL = prod.length;
                if (prodL < remL)
                  prod.unshift(0);
                subtract(rem, prod, remL, base);
                if (cmp == -1) {
                  remL = rem.length;
                  cmp = compare(yd, rem, yL, remL);
                  if (cmp < 1) {
                    k++;
                    subtract(rem, yL < remL ? yz : yd, remL, base);
                  }
                }
                remL = rem.length;
              } else if (cmp === 0) {
                k++;
                rem = [0];
              }
              qd[i++] = k;
              if (cmp && rem[0]) {
                rem[remL++] = xd[xi] || 0;
              } else {
                rem = [xd[xi]];
                remL = 1;
              }
            } while ((xi++ < xL || rem[0] !== void 0) && sd--);
            more = rem[0] !== void 0;
          }
          if (!qd[0])
            qd.shift();
        }
        if (logBase == 1) {
          q.e = e;
          inexact = more;
        } else {
          for (i = 1, k = qd[0]; k >= 10; k /= 10)
            i++;
          q.e = i + e * logBase - 1;
          finalise(q, dp ? pr + q.e + 1 : pr, rm, more);
        }
        return q;
      };
    }();
    function finalise(x, sd, rm, isTruncated) {
      var digits, i, j, k, rd, roundUp, w, xd, xdi, Ctor = x.constructor;
      out:
        if (sd != null) {
          xd = x.d;
          if (!xd)
            return x;
          for (digits = 1, k = xd[0]; k >= 10; k /= 10)
            digits++;
          i = sd - digits;
          if (i < 0) {
            i += LOG_BASE;
            j = sd;
            w = xd[xdi = 0];
            rd = w / mathpow(10, digits - j - 1) % 10 | 0;
          } else {
            xdi = Math.ceil((i + 1) / LOG_BASE);
            k = xd.length;
            if (xdi >= k) {
              if (isTruncated) {
                for (; k++ <= xdi; )
                  xd.push(0);
                w = rd = 0;
                digits = 1;
                i %= LOG_BASE;
                j = i - LOG_BASE + 1;
              } else {
                break out;
              }
            } else {
              w = k = xd[xdi];
              for (digits = 1; k >= 10; k /= 10)
                digits++;
              i %= LOG_BASE;
              j = i - LOG_BASE + digits;
              rd = j < 0 ? 0 : w / mathpow(10, digits - j - 1) % 10 | 0;
            }
          }
          isTruncated = isTruncated || sd < 0 || xd[xdi + 1] !== void 0 || (j < 0 ? w : w % mathpow(10, digits - j - 1));
          roundUp = rm < 4 ? (rd || isTruncated) && (rm == 0 || rm == (x.s < 0 ? 3 : 2)) : rd > 5 || rd == 5 && (rm == 4 || isTruncated || rm == 6 && // Check whether the digit to the left of the rounding digit is odd.
          (i > 0 ? j > 0 ? w / mathpow(10, digits - j) : 0 : xd[xdi - 1]) % 10 & 1 || rm == (x.s < 0 ? 8 : 7));
          if (sd < 1 || !xd[0]) {
            xd.length = 0;
            if (roundUp) {
              sd -= x.e + 1;
              xd[0] = mathpow(10, (LOG_BASE - sd % LOG_BASE) % LOG_BASE);
              x.e = -sd || 0;
            } else {
              xd[0] = x.e = 0;
            }
            return x;
          }
          if (i == 0) {
            xd.length = xdi;
            k = 1;
            xdi--;
          } else {
            xd.length = xdi + 1;
            k = mathpow(10, LOG_BASE - i);
            xd[xdi] = j > 0 ? (w / mathpow(10, digits - j) % mathpow(10, j) | 0) * k : 0;
          }
          if (roundUp) {
            for (; ; ) {
              if (xdi == 0) {
                for (i = 1, j = xd[0]; j >= 10; j /= 10)
                  i++;
                j = xd[0] += k;
                for (k = 1; j >= 10; j /= 10)
                  k++;
                if (i != k) {
                  x.e++;
                  if (xd[0] == BASE)
                    xd[0] = 1;
                }
                break;
              } else {
                xd[xdi] += k;
                if (xd[xdi] != BASE)
                  break;
                xd[xdi--] = 0;
                k = 1;
              }
            }
          }
          for (i = xd.length; xd[--i] === 0; )
            xd.pop();
        }
      if (external) {
        if (x.e > Ctor.maxE) {
          x.d = null;
          x.e = NaN;
        } else if (x.e < Ctor.minE) {
          x.e = 0;
          x.d = [0];
        }
      }
      return x;
    }
    __name(finalise, "finalise");
    function finiteToString(x, isExp, sd) {
      if (!x.isFinite())
        return nonFiniteToString(x);
      var k, e = x.e, str = digitsToString(x.d), len = str.length;
      if (isExp) {
        if (sd && (k = sd - len) > 0) {
          str = str.charAt(0) + "." + str.slice(1) + getZeroString(k);
        } else if (len > 1) {
          str = str.charAt(0) + "." + str.slice(1);
        }
        str = str + (x.e < 0 ? "e" : "e+") + x.e;
      } else if (e < 0) {
        str = "0." + getZeroString(-e - 1) + str;
        if (sd && (k = sd - len) > 0)
          str += getZeroString(k);
      } else if (e >= len) {
        str += getZeroString(e + 1 - len);
        if (sd && (k = sd - e - 1) > 0)
          str = str + "." + getZeroString(k);
      } else {
        if ((k = e + 1) < len)
          str = str.slice(0, k) + "." + str.slice(k);
        if (sd && (k = sd - len) > 0) {
          if (e + 1 === len)
            str += ".";
          str += getZeroString(k);
        }
      }
      return str;
    }
    __name(finiteToString, "finiteToString");
    function getBase10Exponent(digits, e) {
      var w = digits[0];
      for (e *= LOG_BASE; w >= 10; w /= 10)
        e++;
      return e;
    }
    __name(getBase10Exponent, "getBase10Exponent");
    function getLn10(Ctor, sd, pr) {
      if (sd > LN10_PRECISION) {
        external = true;
        if (pr)
          Ctor.precision = pr;
        throw Error(precisionLimitExceeded);
      }
      return finalise(new Ctor(LN10), sd, 1, true);
    }
    __name(getLn10, "getLn10");
    function getPi(Ctor, sd, rm) {
      if (sd > PI_PRECISION)
        throw Error(precisionLimitExceeded);
      return finalise(new Ctor(PI), sd, rm, true);
    }
    __name(getPi, "getPi");
    function getPrecision(digits) {
      var w = digits.length - 1, len = w * LOG_BASE + 1;
      w = digits[w];
      if (w) {
        for (; w % 10 == 0; w /= 10)
          len--;
        for (w = digits[0]; w >= 10; w /= 10)
          len++;
      }
      return len;
    }
    __name(getPrecision, "getPrecision");
    function getZeroString(k) {
      var zs = "";
      for (; k--; )
        zs += "0";
      return zs;
    }
    __name(getZeroString, "getZeroString");
    function intPow(Ctor, x, n, pr) {
      var isTruncated, r = new Ctor(1), k = Math.ceil(pr / LOG_BASE + 4);
      external = false;
      for (; ; ) {
        if (n % 2) {
          r = r.times(x);
          if (truncate(r.d, k))
            isTruncated = true;
        }
        n = mathfloor(n / 2);
        if (n === 0) {
          n = r.d.length - 1;
          if (isTruncated && r.d[n] === 0)
            ++r.d[n];
          break;
        }
        x = x.times(x);
        truncate(x.d, k);
      }
      external = true;
      return r;
    }
    __name(intPow, "intPow");
    function isOdd(n) {
      return n.d[n.d.length - 1] & 1;
    }
    __name(isOdd, "isOdd");
    function maxOrMin(Ctor, args, n) {
      var k, y, x = new Ctor(args[0]), i = 0;
      for (; ++i < args.length; ) {
        y = new Ctor(args[i]);
        if (!y.s) {
          x = y;
          break;
        }
        k = x.cmp(y);
        if (k === n || k === 0 && x.s === n) {
          x = y;
        }
      }
      return x;
    }
    __name(maxOrMin, "maxOrMin");
    function naturalExponential(x, sd) {
      var denominator, guard, j, pow2, sum2, t, wpr, rep = 0, i = 0, k = 0, Ctor = x.constructor, rm = Ctor.rounding, pr = Ctor.precision;
      if (!x.d || !x.d[0] || x.e > 17) {
        return new Ctor(x.d ? !x.d[0] ? 1 : x.s < 0 ? 0 : 1 / 0 : x.s ? x.s < 0 ? 0 : x : 0 / 0);
      }
      if (sd == null) {
        external = false;
        wpr = pr;
      } else {
        wpr = sd;
      }
      t = new Ctor(0.03125);
      while (x.e > -2) {
        x = x.times(t);
        k += 5;
      }
      guard = Math.log(mathpow(2, k)) / Math.LN10 * 2 + 5 | 0;
      wpr += guard;
      denominator = pow2 = sum2 = new Ctor(1);
      Ctor.precision = wpr;
      for (; ; ) {
        pow2 = finalise(pow2.times(x), wpr, 1);
        denominator = denominator.times(++i);
        t = sum2.plus(divide(pow2, denominator, wpr, 1));
        if (digitsToString(t.d).slice(0, wpr) === digitsToString(sum2.d).slice(0, wpr)) {
          j = k;
          while (j--)
            sum2 = finalise(sum2.times(sum2), wpr, 1);
          if (sd == null) {
            if (rep < 3 && checkRoundingDigits(sum2.d, wpr - guard, rm, rep)) {
              Ctor.precision = wpr += 10;
              denominator = pow2 = t = new Ctor(1);
              i = 0;
              rep++;
            } else {
              return finalise(sum2, Ctor.precision = pr, rm, external = true);
            }
          } else {
            Ctor.precision = pr;
            return sum2;
          }
        }
        sum2 = t;
      }
    }
    __name(naturalExponential, "naturalExponential");
    function naturalLogarithm(y, sd) {
      var c, c0, denominator, e, numerator, rep, sum2, t, wpr, x1, x2, n = 1, guard = 10, x = y, xd = x.d, Ctor = x.constructor, rm = Ctor.rounding, pr = Ctor.precision;
      if (x.s < 0 || !xd || !xd[0] || !x.e && xd[0] == 1 && xd.length == 1) {
        return new Ctor(xd && !xd[0] ? -1 / 0 : x.s != 1 ? NaN : xd ? 0 : x);
      }
      if (sd == null) {
        external = false;
        wpr = pr;
      } else {
        wpr = sd;
      }
      Ctor.precision = wpr += guard;
      c = digitsToString(xd);
      c0 = c.charAt(0);
      if (Math.abs(e = x.e) < 15e14) {
        while (c0 < 7 && c0 != 1 || c0 == 1 && c.charAt(1) > 3) {
          x = x.times(y);
          c = digitsToString(x.d);
          c0 = c.charAt(0);
          n++;
        }
        e = x.e;
        if (c0 > 1) {
          x = new Ctor("0." + c);
          e++;
        } else {
          x = new Ctor(c0 + "." + c.slice(1));
        }
      } else {
        t = getLn10(Ctor, wpr + 2, pr).times(e + "");
        x = naturalLogarithm(new Ctor(c0 + "." + c.slice(1)), wpr - guard).plus(t);
        Ctor.precision = pr;
        return sd == null ? finalise(x, pr, rm, external = true) : x;
      }
      x1 = x;
      sum2 = numerator = x = divide(x.minus(1), x.plus(1), wpr, 1);
      x2 = finalise(x.times(x), wpr, 1);
      denominator = 3;
      for (; ; ) {
        numerator = finalise(numerator.times(x2), wpr, 1);
        t = sum2.plus(divide(numerator, new Ctor(denominator), wpr, 1));
        if (digitsToString(t.d).slice(0, wpr) === digitsToString(sum2.d).slice(0, wpr)) {
          sum2 = sum2.times(2);
          if (e !== 0)
            sum2 = sum2.plus(getLn10(Ctor, wpr + 2, pr).times(e + ""));
          sum2 = divide(sum2, new Ctor(n), wpr, 1);
          if (sd == null) {
            if (checkRoundingDigits(sum2.d, wpr - guard, rm, rep)) {
              Ctor.precision = wpr += guard;
              t = numerator = x = divide(x1.minus(1), x1.plus(1), wpr, 1);
              x2 = finalise(x.times(x), wpr, 1);
              denominator = rep = 1;
            } else {
              return finalise(sum2, Ctor.precision = pr, rm, external = true);
            }
          } else {
            Ctor.precision = pr;
            return sum2;
          }
        }
        sum2 = t;
        denominator += 2;
      }
    }
    __name(naturalLogarithm, "naturalLogarithm");
    function nonFiniteToString(x) {
      return String(x.s * x.s / 0);
    }
    __name(nonFiniteToString, "nonFiniteToString");
    function parseDecimal(x, str) {
      var e, i, len;
      if ((e = str.indexOf(".")) > -1)
        str = str.replace(".", "");
      if ((i = str.search(/e/i)) > 0) {
        if (e < 0)
          e = i;
        e += +str.slice(i + 1);
        str = str.substring(0, i);
      } else if (e < 0) {
        e = str.length;
      }
      for (i = 0; str.charCodeAt(i) === 48; i++)
        ;
      for (len = str.length; str.charCodeAt(len - 1) === 48; --len)
        ;
      str = str.slice(i, len);
      if (str) {
        len -= i;
        x.e = e = e - i - 1;
        x.d = [];
        i = (e + 1) % LOG_BASE;
        if (e < 0)
          i += LOG_BASE;
        if (i < len) {
          if (i)
            x.d.push(+str.slice(0, i));
          for (len -= LOG_BASE; i < len; )
            x.d.push(+str.slice(i, i += LOG_BASE));
          str = str.slice(i);
          i = LOG_BASE - str.length;
        } else {
          i -= len;
        }
        for (; i--; )
          str += "0";
        x.d.push(+str);
        if (external) {
          if (x.e > x.constructor.maxE) {
            x.d = null;
            x.e = NaN;
          } else if (x.e < x.constructor.minE) {
            x.e = 0;
            x.d = [0];
          }
        }
      } else {
        x.e = 0;
        x.d = [0];
      }
      return x;
    }
    __name(parseDecimal, "parseDecimal");
    function parseOther(x, str) {
      var base, Ctor, divisor, i, isFloat, len, p, xd, xe;
      if (str.indexOf("_") > -1) {
        str = str.replace(/(\d)_(?=\d)/g, "$1");
        if (isDecimal.test(str))
          return parseDecimal(x, str);
      } else if (str === "Infinity" || str === "NaN") {
        if (!+str)
          x.s = NaN;
        x.e = NaN;
        x.d = null;
        return x;
      }
      if (isHex.test(str)) {
        base = 16;
        str = str.toLowerCase();
      } else if (isBinary.test(str)) {
        base = 2;
      } else if (isOctal.test(str)) {
        base = 8;
      } else {
        throw Error(invalidArgument + str);
      }
      i = str.search(/p/i);
      if (i > 0) {
        p = +str.slice(i + 1);
        str = str.substring(2, i);
      } else {
        str = str.slice(2);
      }
      i = str.indexOf(".");
      isFloat = i >= 0;
      Ctor = x.constructor;
      if (isFloat) {
        str = str.replace(".", "");
        len = str.length;
        i = len - i;
        divisor = intPow(Ctor, new Ctor(base), i, i * 2);
      }
      xd = convertBase(str, base, BASE);
      xe = xd.length - 1;
      for (i = xe; xd[i] === 0; --i)
        xd.pop();
      if (i < 0)
        return new Ctor(x.s * 0);
      x.e = getBase10Exponent(xd, xe);
      x.d = xd;
      external = false;
      if (isFloat)
        x = divide(x, divisor, len * 4);
      if (p)
        x = x.times(Math.abs(p) < 54 ? mathpow(2, p) : Decimal2.pow(2, p));
      external = true;
      return x;
    }
    __name(parseOther, "parseOther");
    function sine(Ctor, x) {
      var k, len = x.d.length;
      if (len < 3) {
        return x.isZero() ? x : taylorSeries(Ctor, 2, x, x);
      }
      k = 1.4 * Math.sqrt(len);
      k = k > 16 ? 16 : k | 0;
      x = x.times(1 / tinyPow(5, k));
      x = taylorSeries(Ctor, 2, x, x);
      var sin2_x, d5 = new Ctor(5), d16 = new Ctor(16), d20 = new Ctor(20);
      for (; k--; ) {
        sin2_x = x.times(x);
        x = x.times(d5.plus(sin2_x.times(d16.times(sin2_x).minus(d20))));
      }
      return x;
    }
    __name(sine, "sine");
    function taylorSeries(Ctor, n, x, y, isHyperbolic) {
      var j, t, u, x2, i = 1, pr = Ctor.precision, k = Math.ceil(pr / LOG_BASE);
      external = false;
      x2 = x.times(x);
      u = new Ctor(y);
      for (; ; ) {
        t = divide(u.times(x2), new Ctor(n++ * n++), pr, 1);
        u = isHyperbolic ? y.plus(t) : y.minus(t);
        y = divide(t.times(x2), new Ctor(n++ * n++), pr, 1);
        t = u.plus(y);
        if (t.d[k] !== void 0) {
          for (j = k; t.d[j] === u.d[j] && j--; )
            ;
          if (j == -1)
            break;
        }
        j = u;
        u = y;
        y = t;
        t = j;
        i++;
      }
      external = true;
      t.d.length = k + 1;
      return t;
    }
    __name(taylorSeries, "taylorSeries");
    function tinyPow(b, e) {
      var n = b;
      while (--e)
        n *= b;
      return n;
    }
    __name(tinyPow, "tinyPow");
    function toLessThanHalfPi(Ctor, x) {
      var t, isNeg = x.s < 0, pi = getPi(Ctor, Ctor.precision, 1), halfPi = pi.times(0.5);
      x = x.abs();
      if (x.lte(halfPi)) {
        quadrant = isNeg ? 4 : 1;
        return x;
      }
      t = x.divToInt(pi);
      if (t.isZero()) {
        quadrant = isNeg ? 3 : 2;
      } else {
        x = x.minus(t.times(pi));
        if (x.lte(halfPi)) {
          quadrant = isOdd(t) ? isNeg ? 2 : 3 : isNeg ? 4 : 1;
          return x;
        }
        quadrant = isOdd(t) ? isNeg ? 1 : 4 : isNeg ? 3 : 2;
      }
      return x.minus(pi).abs();
    }
    __name(toLessThanHalfPi, "toLessThanHalfPi");
    function toStringBinary(x, baseOut, sd, rm) {
      var base, e, i, k, len, roundUp, str, xd, y, Ctor = x.constructor, isExp = sd !== void 0;
      if (isExp) {
        checkInt32(sd, 1, MAX_DIGITS);
        if (rm === void 0)
          rm = Ctor.rounding;
        else
          checkInt32(rm, 0, 8);
      } else {
        sd = Ctor.precision;
        rm = Ctor.rounding;
      }
      if (!x.isFinite()) {
        str = nonFiniteToString(x);
      } else {
        str = finiteToString(x);
        i = str.indexOf(".");
        if (isExp) {
          base = 2;
          if (baseOut == 16) {
            sd = sd * 4 - 3;
          } else if (baseOut == 8) {
            sd = sd * 3 - 2;
          }
        } else {
          base = baseOut;
        }
        if (i >= 0) {
          str = str.replace(".", "");
          y = new Ctor(1);
          y.e = str.length - i;
          y.d = convertBase(finiteToString(y), 10, base);
          y.e = y.d.length;
        }
        xd = convertBase(str, 10, base);
        e = len = xd.length;
        for (; xd[--len] == 0; )
          xd.pop();
        if (!xd[0]) {
          str = isExp ? "0p+0" : "0";
        } else {
          if (i < 0) {
            e--;
          } else {
            x = new Ctor(x);
            x.d = xd;
            x.e = e;
            x = divide(x, y, sd, rm, 0, base);
            xd = x.d;
            e = x.e;
            roundUp = inexact;
          }
          i = xd[sd];
          k = base / 2;
          roundUp = roundUp || xd[sd + 1] !== void 0;
          roundUp = rm < 4 ? (i !== void 0 || roundUp) && (rm === 0 || rm === (x.s < 0 ? 3 : 2)) : i > k || i === k && (rm === 4 || roundUp || rm === 6 && xd[sd - 1] & 1 || rm === (x.s < 0 ? 8 : 7));
          xd.length = sd;
          if (roundUp) {
            for (; ++xd[--sd] > base - 1; ) {
              xd[sd] = 0;
              if (!sd) {
                ++e;
                xd.unshift(1);
              }
            }
          }
          for (len = xd.length; !xd[len - 1]; --len)
            ;
          for (i = 0, str = ""; i < len; i++)
            str += NUMERALS.charAt(xd[i]);
          if (isExp) {
            if (len > 1) {
              if (baseOut == 16 || baseOut == 8) {
                i = baseOut == 16 ? 4 : 3;
                for (--len; len % i; len++)
                  str += "0";
                xd = convertBase(str, base, baseOut);
                for (len = xd.length; !xd[len - 1]; --len)
                  ;
                for (i = 1, str = "1."; i < len; i++)
                  str += NUMERALS.charAt(xd[i]);
              } else {
                str = str.charAt(0) + "." + str.slice(1);
              }
            }
            str = str + (e < 0 ? "p" : "p+") + e;
          } else if (e < 0) {
            for (; ++e; )
              str = "0" + str;
            str = "0." + str;
          } else {
            if (++e > len)
              for (e -= len; e--; )
                str += "0";
            else if (e < len)
              str = str.slice(0, e) + "." + str.slice(e);
          }
        }
        str = (baseOut == 16 ? "0x" : baseOut == 2 ? "0b" : baseOut == 8 ? "0o" : "") + str;
      }
      return x.s < 0 ? "-" + str : str;
    }
    __name(toStringBinary, "toStringBinary");
    function truncate(arr, len) {
      if (arr.length > len) {
        arr.length = len;
        return true;
      }
    }
    __name(truncate, "truncate");
    function abs(x) {
      return new this(x).abs();
    }
    __name(abs, "abs");
    function acos(x) {
      return new this(x).acos();
    }
    __name(acos, "acos");
    function acosh(x) {
      return new this(x).acosh();
    }
    __name(acosh, "acosh");
    function add(x, y) {
      return new this(x).plus(y);
    }
    __name(add, "add");
    function asin(x) {
      return new this(x).asin();
    }
    __name(asin, "asin");
    function asinh(x) {
      return new this(x).asinh();
    }
    __name(asinh, "asinh");
    function atan(x) {
      return new this(x).atan();
    }
    __name(atan, "atan");
    function atanh(x) {
      return new this(x).atanh();
    }
    __name(atanh, "atanh");
    function atan2(y, x) {
      y = new this(y);
      x = new this(x);
      var r, pr = this.precision, rm = this.rounding, wpr = pr + 4;
      if (!y.s || !x.s) {
        r = new this(NaN);
      } else if (!y.d && !x.d) {
        r = getPi(this, wpr, 1).times(x.s > 0 ? 0.25 : 0.75);
        r.s = y.s;
      } else if (!x.d || y.isZero()) {
        r = x.s < 0 ? getPi(this, pr, rm) : new this(0);
        r.s = y.s;
      } else if (!y.d || x.isZero()) {
        r = getPi(this, wpr, 1).times(0.5);
        r.s = y.s;
      } else if (x.s < 0) {
        this.precision = wpr;
        this.rounding = 1;
        r = this.atan(divide(y, x, wpr, 1));
        x = getPi(this, wpr, 1);
        this.precision = pr;
        this.rounding = rm;
        r = y.s < 0 ? r.minus(x) : r.plus(x);
      } else {
        r = this.atan(divide(y, x, wpr, 1));
      }
      return r;
    }
    __name(atan2, "atan2");
    function cbrt(x) {
      return new this(x).cbrt();
    }
    __name(cbrt, "cbrt");
    function ceil(x) {
      return finalise(x = new this(x), x.e + 1, 2);
    }
    __name(ceil, "ceil");
    function clamp(x, min2, max2) {
      return new this(x).clamp(min2, max2);
    }
    __name(clamp, "clamp");
    function config2(obj) {
      if (!obj || typeof obj !== "object")
        throw Error(decimalError + "Object expected");
      var i, p, v, useDefaults = obj.defaults === true, ps = [
        "precision",
        1,
        MAX_DIGITS,
        "rounding",
        0,
        8,
        "toExpNeg",
        -EXP_LIMIT,
        0,
        "toExpPos",
        0,
        EXP_LIMIT,
        "maxE",
        0,
        EXP_LIMIT,
        "minE",
        -EXP_LIMIT,
        0,
        "modulo",
        0,
        9
      ];
      for (i = 0; i < ps.length; i += 3) {
        if (p = ps[i], useDefaults)
          this[p] = DEFAULTS[p];
        if ((v = obj[p]) !== void 0) {
          if (mathfloor(v) === v && v >= ps[i + 1] && v <= ps[i + 2])
            this[p] = v;
          else
            throw Error(invalidArgument + p + ": " + v);
        }
      }
      if (p = "crypto", useDefaults)
        this[p] = DEFAULTS[p];
      if ((v = obj[p]) !== void 0) {
        if (v === true || v === false || v === 0 || v === 1) {
          if (v) {
            if (typeof crypto != "undefined" && crypto && (crypto.getRandomValues || crypto.randomBytes)) {
              this[p] = true;
            } else {
              throw Error(cryptoUnavailable);
            }
          } else {
            this[p] = false;
          }
        } else {
          throw Error(invalidArgument + p + ": " + v);
        }
      }
      return this;
    }
    __name(config2, "config");
    function cos(x) {
      return new this(x).cos();
    }
    __name(cos, "cos");
    function cosh(x) {
      return new this(x).cosh();
    }
    __name(cosh, "cosh");
    function clone(obj) {
      var i, p, ps;
      function Decimal22(v) {
        var e, i2, t, x = this;
        if (!(x instanceof Decimal22))
          return new Decimal22(v);
        x.constructor = Decimal22;
        if (isDecimalInstance(v)) {
          x.s = v.s;
          if (external) {
            if (!v.d || v.e > Decimal22.maxE) {
              x.e = NaN;
              x.d = null;
            } else if (v.e < Decimal22.minE) {
              x.e = 0;
              x.d = [0];
            } else {
              x.e = v.e;
              x.d = v.d.slice();
            }
          } else {
            x.e = v.e;
            x.d = v.d ? v.d.slice() : v.d;
          }
          return;
        }
        t = typeof v;
        if (t === "number") {
          if (v === 0) {
            x.s = 1 / v < 0 ? -1 : 1;
            x.e = 0;
            x.d = [0];
            return;
          }
          if (v < 0) {
            v = -v;
            x.s = -1;
          } else {
            x.s = 1;
          }
          if (v === ~~v && v < 1e7) {
            for (e = 0, i2 = v; i2 >= 10; i2 /= 10)
              e++;
            if (external) {
              if (e > Decimal22.maxE) {
                x.e = NaN;
                x.d = null;
              } else if (e < Decimal22.minE) {
                x.e = 0;
                x.d = [0];
              } else {
                x.e = e;
                x.d = [v];
              }
            } else {
              x.e = e;
              x.d = [v];
            }
            return;
          }
          if (v * 0 !== 0) {
            if (!v)
              x.s = NaN;
            x.e = NaN;
            x.d = null;
            return;
          }
          return parseDecimal(x, v.toString());
        }
        if (t === "string") {
          if ((i2 = v.charCodeAt(0)) === 45) {
            v = v.slice(1);
            x.s = -1;
          } else {
            if (i2 === 43)
              v = v.slice(1);
            x.s = 1;
          }
          return isDecimal.test(v) ? parseDecimal(x, v) : parseOther(x, v);
        }
        if (t === "bigint") {
          if (v < 0) {
            v = -v;
            x.s = -1;
          } else {
            x.s = 1;
          }
          return parseDecimal(x, v.toString());
        }
        throw Error(invalidArgument + v);
      }
      __name(Decimal22, "Decimal2");
      Decimal22.prototype = P;
      Decimal22.ROUND_UP = 0;
      Decimal22.ROUND_DOWN = 1;
      Decimal22.ROUND_CEIL = 2;
      Decimal22.ROUND_FLOOR = 3;
      Decimal22.ROUND_HALF_UP = 4;
      Decimal22.ROUND_HALF_DOWN = 5;
      Decimal22.ROUND_HALF_EVEN = 6;
      Decimal22.ROUND_HALF_CEIL = 7;
      Decimal22.ROUND_HALF_FLOOR = 8;
      Decimal22.EUCLID = 9;
      Decimal22.config = Decimal22.set = config2;
      Decimal22.clone = clone;
      Decimal22.isDecimal = isDecimalInstance;
      Decimal22.abs = abs;
      Decimal22.acos = acos;
      Decimal22.acosh = acosh;
      Decimal22.add = add;
      Decimal22.asin = asin;
      Decimal22.asinh = asinh;
      Decimal22.atan = atan;
      Decimal22.atanh = atanh;
      Decimal22.atan2 = atan2;
      Decimal22.cbrt = cbrt;
      Decimal22.ceil = ceil;
      Decimal22.clamp = clamp;
      Decimal22.cos = cos;
      Decimal22.cosh = cosh;
      Decimal22.div = div;
      Decimal22.exp = exp;
      Decimal22.floor = floor;
      Decimal22.hypot = hypot;
      Decimal22.ln = ln;
      Decimal22.log = log3;
      Decimal22.log10 = log10;
      Decimal22.log2 = log22;
      Decimal22.max = max;
      Decimal22.min = min;
      Decimal22.mod = mod;
      Decimal22.mul = mul;
      Decimal22.pow = pow;
      Decimal22.random = random;
      Decimal22.round = round;
      Decimal22.sign = sign;
      Decimal22.sin = sin;
      Decimal22.sinh = sinh;
      Decimal22.sqrt = sqrt;
      Decimal22.sub = sub;
      Decimal22.sum = sum;
      Decimal22.tan = tan;
      Decimal22.tanh = tanh;
      Decimal22.trunc = trunc;
      if (obj === void 0)
        obj = {};
      if (obj) {
        if (obj.defaults !== true) {
          ps = ["precision", "rounding", "toExpNeg", "toExpPos", "maxE", "minE", "modulo", "crypto"];
          for (i = 0; i < ps.length; )
            if (!obj.hasOwnProperty(p = ps[i++]))
              obj[p] = this[p];
        }
      }
      Decimal22.config(obj);
      return Decimal22;
    }
    __name(clone, "clone");
    function div(x, y) {
      return new this(x).div(y);
    }
    __name(div, "div");
    function exp(x) {
      return new this(x).exp();
    }
    __name(exp, "exp");
    function floor(x) {
      return finalise(x = new this(x), x.e + 1, 3);
    }
    __name(floor, "floor");
    function hypot() {
      var i, n, t = new this(0);
      external = false;
      for (i = 0; i < arguments.length; ) {
        n = new this(arguments[i++]);
        if (!n.d) {
          if (n.s) {
            external = true;
            return new this(1 / 0);
          }
          t = n;
        } else if (t.d) {
          t = t.plus(n.times(n));
        }
      }
      external = true;
      return t.sqrt();
    }
    __name(hypot, "hypot");
    function isDecimalInstance(obj) {
      return obj instanceof Decimal2 || obj && obj.toStringTag === tag || false;
    }
    __name(isDecimalInstance, "isDecimalInstance");
    function ln(x) {
      return new this(x).ln();
    }
    __name(ln, "ln");
    function log3(x, y) {
      return new this(x).log(y);
    }
    __name(log3, "log");
    function log22(x) {
      return new this(x).log(2);
    }
    __name(log22, "log2");
    function log10(x) {
      return new this(x).log(10);
    }
    __name(log10, "log10");
    function max() {
      return maxOrMin(this, arguments, -1);
    }
    __name(max, "max");
    function min() {
      return maxOrMin(this, arguments, 1);
    }
    __name(min, "min");
    function mod(x, y) {
      return new this(x).mod(y);
    }
    __name(mod, "mod");
    function mul(x, y) {
      return new this(x).mul(y);
    }
    __name(mul, "mul");
    function pow(x, y) {
      return new this(x).pow(y);
    }
    __name(pow, "pow");
    function random(sd) {
      var d, e, k, n, i = 0, r = new this(1), rd = [];
      if (sd === void 0)
        sd = this.precision;
      else
        checkInt32(sd, 1, MAX_DIGITS);
      k = Math.ceil(sd / LOG_BASE);
      if (!this.crypto) {
        for (; i < k; )
          rd[i++] = Math.random() * 1e7 | 0;
      } else if (crypto.getRandomValues) {
        d = crypto.getRandomValues(new Uint32Array(k));
        for (; i < k; ) {
          n = d[i];
          if (n >= 429e7) {
            d[i] = crypto.getRandomValues(new Uint32Array(1))[0];
          } else {
            rd[i++] = n % 1e7;
          }
        }
      } else if (crypto.randomBytes) {
        d = crypto.randomBytes(k *= 4);
        for (; i < k; ) {
          n = d[i] + (d[i + 1] << 8) + (d[i + 2] << 16) + ((d[i + 3] & 127) << 24);
          if (n >= 214e7) {
            crypto.randomBytes(4).copy(d, i);
          } else {
            rd.push(n % 1e7);
            i += 4;
          }
        }
        i = k / 4;
      } else {
        throw Error(cryptoUnavailable);
      }
      k = rd[--i];
      sd %= LOG_BASE;
      if (k && sd) {
        n = mathpow(10, LOG_BASE - sd);
        rd[i] = (k / n | 0) * n;
      }
      for (; rd[i] === 0; i--)
        rd.pop();
      if (i < 0) {
        e = 0;
        rd = [0];
      } else {
        e = -1;
        for (; rd[0] === 0; e -= LOG_BASE)
          rd.shift();
        for (k = 1, n = rd[0]; n >= 10; n /= 10)
          k++;
        if (k < LOG_BASE)
          e -= LOG_BASE - k;
      }
      r.e = e;
      r.d = rd;
      return r;
    }
    __name(random, "random");
    function round(x) {
      return finalise(x = new this(x), x.e + 1, this.rounding);
    }
    __name(round, "round");
    function sign(x) {
      x = new this(x);
      return x.d ? x.d[0] ? x.s : 0 * x.s : x.s || NaN;
    }
    __name(sign, "sign");
    function sin(x) {
      return new this(x).sin();
    }
    __name(sin, "sin");
    function sinh(x) {
      return new this(x).sinh();
    }
    __name(sinh, "sinh");
    function sqrt(x) {
      return new this(x).sqrt();
    }
    __name(sqrt, "sqrt");
    function sub(x, y) {
      return new this(x).sub(y);
    }
    __name(sub, "sub");
    function sum() {
      var i = 0, args = arguments, x = new this(args[i]);
      external = false;
      for (; x.s && ++i < args.length; )
        x = x.plus(args[i]);
      external = true;
      return finalise(x, this.precision, this.rounding);
    }
    __name(sum, "sum");
    function tan(x) {
      return new this(x).tan();
    }
    __name(tan, "tan");
    function tanh(x) {
      return new this(x).tanh();
    }
    __name(tanh, "tanh");
    function trunc(x) {
      return finalise(x = new this(x), x.e + 1, 1);
    }
    __name(trunc, "trunc");
    P[Symbol.for("nodejs.util.inspect.custom")] = P.toString;
    P[Symbol.toStringTag] = "Decimal";
    var Decimal2 = P.constructor = clone(DEFAULTS);
    LN10 = new Decimal2(LN10);
    PI = new Decimal2(PI);
    var Sql2 = /* @__PURE__ */ __name(class _Sql {
      constructor(rawStrings, rawValues) {
        if (rawStrings.length - 1 !== rawValues.length) {
          if (rawStrings.length === 0) {
            throw new TypeError("Expected at least 1 string");
          }
          throw new TypeError(`Expected ${rawStrings.length} strings to have ${rawStrings.length - 1} values`);
        }
        const valuesLength = rawValues.reduce((len, value) => len + (value instanceof _Sql ? value.values.length : 1), 0);
        this.values = new Array(valuesLength);
        this.strings = new Array(valuesLength + 1);
        this.strings[0] = rawStrings[0];
        let i = 0, pos = 0;
        while (i < rawValues.length) {
          const child = rawValues[i++];
          const rawString = rawStrings[i];
          if (child instanceof _Sql) {
            this.strings[pos] += child.strings[0];
            let childIndex = 0;
            while (childIndex < child.values.length) {
              this.values[pos++] = child.values[childIndex++];
              this.strings[pos] = child.strings[childIndex];
            }
            this.strings[pos] += rawString;
          } else {
            this.values[pos++] = child;
            this.strings[pos] = rawString;
          }
        }
      }
      get sql() {
        const len = this.strings.length;
        let i = 1;
        let value = this.strings[0];
        while (i < len)
          value += `?${this.strings[i++]}`;
        return value;
      }
      get statement() {
        const len = this.strings.length;
        let i = 1;
        let value = this.strings[0];
        while (i < len)
          value += `:${i}${this.strings[i++]}`;
        return value;
      }
      get text() {
        const len = this.strings.length;
        let i = 1;
        let value = this.strings[0];
        while (i < len)
          value += `$${i}${this.strings[i++]}`;
        return value;
      }
      inspect() {
        return {
          sql: this.sql,
          statement: this.statement,
          text: this.text,
          values: this.values
        };
      }
    }, "_Sql");
    function join2(values, separator = ",", prefix = "", suffix = "") {
      if (values.length === 0) {
        throw new TypeError("Expected `join([])` to be called with an array of multiple elements, but got an empty array");
      }
      return new Sql2([prefix, ...Array(values.length - 1).fill(separator), suffix], values);
    }
    __name(join2, "join");
    function raw3(value) {
      return new Sql2([value], []);
    }
    __name(raw3, "raw");
    var empty2 = raw3("");
    function sql(strings, ...values) {
      return new Sql2(strings, values);
    }
    __name(sql, "sql");
  }
});

// src/generated/prisma/runtime/wasm-compiler-edge.js
var require_wasm_compiler_edge = __commonJS({
  "src/generated/prisma/runtime/wasm-compiler-edge.js"(exports, module) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var nu = Object.create;
    var pr = Object.defineProperty;
    var iu = Object.getOwnPropertyDescriptor;
    var ou = Object.getOwnPropertyNames;
    var su = Object.getPrototypeOf;
    var au = Object.prototype.hasOwnProperty;
    var fe = /* @__PURE__ */ __name((e, t) => () => (e && (t = e(e = 0)), t), "fe");
    var oe = /* @__PURE__ */ __name((e, t) => () => (t || e((t = { exports: {} }).exports, t), t.exports), "oe");
    var Ye = /* @__PURE__ */ __name((e, t) => {
      for (var r in t)
        pr(e, r, { get: t[r], enumerable: true });
    }, "Ye");
    var Ui = /* @__PURE__ */ __name((e, t, r, n) => {
      if (t && typeof t == "object" || typeof t == "function")
        for (let i of ou(t))
          !au.call(e, i) && i !== r && pr(e, i, { get: () => t[i], enumerable: !(n = iu(t, i)) || n.enumerable });
      return e;
    }, "Ui");
    var Ue = /* @__PURE__ */ __name((e, t, r) => (r = e != null ? nu(su(e)) : {}, Ui(t || !e || !e.__esModule ? pr(r, "default", { value: e, enumerable: true }) : r, e)), "Ue");
    var $i = /* @__PURE__ */ __name((e) => Ui(pr({}, "__esModule", { value: true }), e), "$i");
    function xn(e, t) {
      if (t = t.toLowerCase(), t === "utf8" || t === "utf-8")
        return new h(pu.encode(e));
      if (t === "base64" || t === "base64url")
        return e = e.replace(/-/g, "+").replace(/_/g, "/"), e = e.replace(/[^A-Za-z0-9+/]/g, ""), new h([...atob(e)].map((r) => r.charCodeAt(0)));
      if (t === "binary" || t === "ascii" || t === "latin1" || t === "latin-1")
        return new h([...e].map((r) => r.charCodeAt(0)));
      if (t === "ucs2" || t === "ucs-2" || t === "utf16le" || t === "utf-16le") {
        let r = new h(e.length * 2), n = new DataView(r.buffer);
        for (let i = 0; i < e.length; i++)
          n.setUint16(i * 2, e.charCodeAt(i), true);
        return r;
      }
      if (t === "hex") {
        let r = new h(e.length / 2);
        for (let n = 0, i = 0; i < e.length; i += 2, n++)
          r[n] = parseInt(e.slice(i, i + 2), 16);
        return r;
      }
      Vi(`encoding "${t}"`);
    }
    __name(xn, "xn");
    function lu(e) {
      let r = Object.getOwnPropertyNames(DataView.prototype).filter((a) => a.startsWith("get") || a.startsWith("set")), n = r.map((a) => a.replace("get", "read").replace("set", "write")), i = /* @__PURE__ */ __name((a, d) => function(f = 0) {
        return H(f, "offset"), ie(f, "offset"), W(f, "offset", this.length - 1), new DataView(this.buffer)[r[a]](f, d);
      }, "i"), o = /* @__PURE__ */ __name((a, d) => function(f, P = 0) {
        let v = r[a].match(/set(\w+\d+)/)[1].toLowerCase(), S = cu[v];
        return H(P, "offset"), ie(P, "offset"), W(P, "offset", this.length - 1), uu(f, "value", S[0], S[1]), new DataView(this.buffer)[r[a]](P, f, d), P + parseInt(r[a].match(/\d+/)[0]) / 8;
      }, "o"), s = /* @__PURE__ */ __name((a) => {
        a.forEach((d) => {
          d.includes("Uint") && (e[d.replace("Uint", "UInt")] = e[d]), d.includes("Float64") && (e[d.replace("Float64", "Double")] = e[d]), d.includes("Float32") && (e[d.replace("Float32", "Float")] = e[d]);
        });
      }, "s");
      n.forEach((a, d) => {
        a.startsWith("read") && (e[a] = i(d, false), e[a + "LE"] = i(d, true), e[a + "BE"] = i(d, false)), a.startsWith("write") && (e[a] = o(d, false), e[a + "LE"] = o(d, true), e[a + "BE"] = o(d, false)), s([a, a + "LE", a + "BE"]);
      });
    }
    __name(lu, "lu");
    function Vi(e) {
      throw new Error(`Buffer polyfill does not implement "${e}"`);
    }
    __name(Vi, "Vi");
    function mr(e, t) {
      if (!(e instanceof Uint8Array))
        throw new TypeError(`The "${t}" argument must be an instance of Buffer or Uint8Array`);
    }
    __name(mr, "mr");
    function W(e, t, r = fu + 1) {
      if (e < 0 || e > r) {
        let n = new RangeError(`The value of "${t}" is out of range. It must be >= 0 && <= ${r}. Received ${e}`);
        throw n.code = "ERR_OUT_OF_RANGE", n;
      }
    }
    __name(W, "W");
    function H(e, t) {
      if (typeof e != "number") {
        let r = new TypeError(`The "${t}" argument must be of type number. Received type ${typeof e}.`);
        throw r.code = "ERR_INVALID_ARG_TYPE", r;
      }
    }
    __name(H, "H");
    function ie(e, t) {
      if (!Number.isInteger(e) || Number.isNaN(e)) {
        let r = new RangeError(`The value of "${t}" is out of range. It must be an integer. Received ${e}`);
        throw r.code = "ERR_OUT_OF_RANGE", r;
      }
    }
    __name(ie, "ie");
    function uu(e, t, r, n) {
      if (e < r || e > n) {
        let i = new RangeError(`The value of "${t}" is out of range. It must be >= ${r} and <= ${n}. Received ${e}`);
        throw i.code = "ERR_OUT_OF_RANGE", i;
      }
    }
    __name(uu, "uu");
    function qi(e, t) {
      if (typeof e != "string") {
        let r = new TypeError(`The "${t}" argument must be of type string. Received type ${typeof e}`);
        throw r.code = "ERR_INVALID_ARG_TYPE", r;
      }
    }
    __name(qi, "qi");
    function gu(e, t = "utf8") {
      return h.from(e, t);
    }
    __name(gu, "gu");
    var h;
    var cu;
    var pu;
    var mu;
    var du;
    var fu;
    var y;
    var En;
    var l = fe(() => {
      "use strict";
      h = /* @__PURE__ */ __name(class e extends Uint8Array {
        _isBuffer = true;
        get offset() {
          return this.byteOffset;
        }
        static alloc(t, r = 0, n = "utf8") {
          return qi(n, "encoding"), e.allocUnsafe(t).fill(r, n);
        }
        static allocUnsafe(t) {
          return e.from(t);
        }
        static allocUnsafeSlow(t) {
          return e.from(t);
        }
        static isBuffer(t) {
          return t && !!t._isBuffer;
        }
        static byteLength(t, r = "utf8") {
          if (typeof t == "string")
            return xn(t, r).byteLength;
          if (t && t.byteLength)
            return t.byteLength;
          let n = new TypeError('The "string" argument must be of type string or an instance of Buffer or ArrayBuffer.');
          throw n.code = "ERR_INVALID_ARG_TYPE", n;
        }
        static isEncoding(t) {
          return du.includes(t);
        }
        static compare(t, r) {
          mr(t, "buff1"), mr(r, "buff2");
          for (let n = 0; n < t.length; n++) {
            if (t[n] < r[n])
              return -1;
            if (t[n] > r[n])
              return 1;
          }
          return t.length === r.length ? 0 : t.length > r.length ? 1 : -1;
        }
        static from(t, r = "utf8") {
          if (t && typeof t == "object" && t.type === "Buffer")
            return new e(t.data);
          if (typeof t == "number")
            return new e(new Uint8Array(t));
          if (typeof t == "string")
            return xn(t, r);
          if (ArrayBuffer.isView(t)) {
            let { byteOffset: n, byteLength: i, buffer: o } = t;
            return "map" in t && typeof t.map == "function" ? new e(t.map((s) => s % 256), n, i) : new e(o, n, i);
          }
          if (t && typeof t == "object" && ("length" in t || "byteLength" in t || "buffer" in t))
            return new e(t);
          throw new TypeError("First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.");
        }
        static concat(t, r) {
          if (t.length === 0)
            return e.alloc(0);
          let n = [].concat(...t.map((o) => [...o])), i = e.alloc(r !== void 0 ? r : n.length);
          return i.set(r !== void 0 ? n.slice(0, r) : n), i;
        }
        slice(t = 0, r = this.length) {
          return this.subarray(t, r);
        }
        subarray(t = 0, r = this.length) {
          return Object.setPrototypeOf(super.subarray(t, r), e.prototype);
        }
        reverse() {
          return super.reverse(), this;
        }
        readIntBE(t, r) {
          H(t, "offset"), ie(t, "offset"), W(t, "offset", this.length - 1), H(r, "byteLength"), ie(r, "byteLength");
          let n = new DataView(this.buffer, t, r), i = 0;
          for (let o = 0; o < r; o++)
            i = i * 256 + n.getUint8(o);
          return n.getUint8(0) & 128 && (i -= Math.pow(256, r)), i;
        }
        readIntLE(t, r) {
          H(t, "offset"), ie(t, "offset"), W(t, "offset", this.length - 1), H(r, "byteLength"), ie(r, "byteLength");
          let n = new DataView(this.buffer, t, r), i = 0;
          for (let o = 0; o < r; o++)
            i += n.getUint8(o) * Math.pow(256, o);
          return n.getUint8(r - 1) & 128 && (i -= Math.pow(256, r)), i;
        }
        readUIntBE(t, r) {
          H(t, "offset"), ie(t, "offset"), W(t, "offset", this.length - 1), H(r, "byteLength"), ie(r, "byteLength");
          let n = new DataView(this.buffer, t, r), i = 0;
          for (let o = 0; o < r; o++)
            i = i * 256 + n.getUint8(o);
          return i;
        }
        readUintBE(t, r) {
          return this.readUIntBE(t, r);
        }
        readUIntLE(t, r) {
          H(t, "offset"), ie(t, "offset"), W(t, "offset", this.length - 1), H(r, "byteLength"), ie(r, "byteLength");
          let n = new DataView(this.buffer, t, r), i = 0;
          for (let o = 0; o < r; o++)
            i += n.getUint8(o) * Math.pow(256, o);
          return i;
        }
        readUintLE(t, r) {
          return this.readUIntLE(t, r);
        }
        writeIntBE(t, r, n) {
          return t = t < 0 ? t + Math.pow(256, n) : t, this.writeUIntBE(t, r, n);
        }
        writeIntLE(t, r, n) {
          return t = t < 0 ? t + Math.pow(256, n) : t, this.writeUIntLE(t, r, n);
        }
        writeUIntBE(t, r, n) {
          H(r, "offset"), ie(r, "offset"), W(r, "offset", this.length - 1), H(n, "byteLength"), ie(n, "byteLength");
          let i = new DataView(this.buffer, r, n);
          for (let o = n - 1; o >= 0; o--)
            i.setUint8(o, t & 255), t = t / 256;
          return r + n;
        }
        writeUintBE(t, r, n) {
          return this.writeUIntBE(t, r, n);
        }
        writeUIntLE(t, r, n) {
          H(r, "offset"), ie(r, "offset"), W(r, "offset", this.length - 1), H(n, "byteLength"), ie(n, "byteLength");
          let i = new DataView(this.buffer, r, n);
          for (let o = 0; o < n; o++)
            i.setUint8(o, t & 255), t = t / 256;
          return r + n;
        }
        writeUintLE(t, r, n) {
          return this.writeUIntLE(t, r, n);
        }
        toJSON() {
          return { type: "Buffer", data: Array.from(this) };
        }
        swap16() {
          let t = new DataView(this.buffer, this.byteOffset, this.byteLength);
          for (let r = 0; r < this.length; r += 2)
            t.setUint16(r, t.getUint16(r, true), false);
          return this;
        }
        swap32() {
          let t = new DataView(this.buffer, this.byteOffset, this.byteLength);
          for (let r = 0; r < this.length; r += 4)
            t.setUint32(r, t.getUint32(r, true), false);
          return this;
        }
        swap64() {
          let t = new DataView(this.buffer, this.byteOffset, this.byteLength);
          for (let r = 0; r < this.length; r += 8)
            t.setBigUint64(r, t.getBigUint64(r, true), false);
          return this;
        }
        compare(t, r = 0, n = t.length, i = 0, o = this.length) {
          return mr(t, "target"), H(r, "targetStart"), H(n, "targetEnd"), H(i, "sourceStart"), H(o, "sourceEnd"), W(r, "targetStart"), W(n, "targetEnd", t.length), W(i, "sourceStart"), W(o, "sourceEnd", this.length), e.compare(this.slice(i, o), t.slice(r, n));
        }
        equals(t) {
          return mr(t, "otherBuffer"), this.length === t.length && this.every((r, n) => r === t[n]);
        }
        copy(t, r = 0, n = 0, i = this.length) {
          W(r, "targetStart"), W(n, "sourceStart", this.length), W(i, "sourceEnd"), r >>>= 0, n >>>= 0, i >>>= 0;
          let o = 0;
          for (; n < i && !(this[n] === void 0 || t[r] === void 0); )
            t[r] = this[n], o++, n++, r++;
          return o;
        }
        write(t, r, n, i = "utf8") {
          let o = typeof r == "string" ? 0 : r ?? 0, s = typeof n == "string" ? this.length - o : n ?? this.length - o;
          return i = typeof r == "string" ? r : typeof n == "string" ? n : i, H(o, "offset"), H(s, "length"), W(o, "offset", this.length), W(s, "length", this.length), (i === "ucs2" || i === "ucs-2" || i === "utf16le" || i === "utf-16le") && (s = s - s % 2), xn(t, i).copy(this, o, 0, s);
        }
        fill(t = 0, r = 0, n = this.length, i = "utf-8") {
          let o = typeof r == "string" ? 0 : r, s = typeof n == "string" ? this.length : n;
          if (i = typeof r == "string" ? r : typeof n == "string" ? n : i, t = e.from(typeof t == "number" ? [t] : t ?? [], i), qi(i, "encoding"), W(o, "offset", this.length), W(s, "end", this.length), t.length !== 0)
            for (let a = o; a < s; a += t.length)
              super.set(t.slice(0, t.length + a >= this.length ? this.length - a : t.length), a);
          return this;
        }
        includes(t, r = null, n = "utf-8") {
          return this.indexOf(t, r, n) !== -1;
        }
        lastIndexOf(t, r = null, n = "utf-8") {
          return this.indexOf(t, r, n, true);
        }
        indexOf(t, r = null, n = "utf-8", i = false) {
          let o = i ? this.findLastIndex.bind(this) : this.findIndex.bind(this);
          n = typeof r == "string" ? r : n;
          let s = e.from(typeof t == "number" ? [t] : t, n), a = typeof r == "string" ? 0 : r;
          return a = typeof r == "number" ? a : null, a = Number.isNaN(a) ? null : a, a ??= i ? this.length : 0, a = a < 0 ? this.length + a : a, s.length === 0 && i === false ? a >= this.length ? this.length : a : s.length === 0 && i === true ? (a >= this.length ? this.length : a) || this.length : o((d, f) => (i ? f <= a : f >= a) && this[f] === s[0] && s.every((v, S) => this[f + S] === v));
        }
        toString(t = "utf8", r = 0, n = this.length) {
          if (r = r < 0 ? 0 : r, t = t.toString().toLowerCase(), n <= 0)
            return "";
          if (t === "utf8" || t === "utf-8")
            return mu.decode(this.slice(r, n));
          if (t === "base64" || t === "base64url") {
            let i = btoa(this.reduce((o, s) => o + En(s), ""));
            return t === "base64url" ? i.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : i;
          }
          if (t === "binary" || t === "ascii" || t === "latin1" || t === "latin-1")
            return this.slice(r, n).reduce((i, o) => i + En(o & (t === "ascii" ? 127 : 255)), "");
          if (t === "ucs2" || t === "ucs-2" || t === "utf16le" || t === "utf-16le") {
            let i = new DataView(this.buffer.slice(r, n));
            return Array.from({ length: i.byteLength / 2 }, (o, s) => s * 2 + 1 < i.byteLength ? En(i.getUint16(s * 2, true)) : "").join("");
          }
          if (t === "hex")
            return this.slice(r, n).reduce((i, o) => i + o.toString(16).padStart(2, "0"), "");
          Vi(`encoding "${t}"`);
        }
        toLocaleString() {
          return this.toString();
        }
        inspect() {
          return `<Buffer ${this.toString("hex").match(/.{1,2}/g).join(" ")}>`;
        }
      }, "e");
      cu = { int8: [-128, 127], int16: [-32768, 32767], int32: [-2147483648, 2147483647], uint8: [0, 255], uint16: [0, 65535], uint32: [0, 4294967295], float32: [-1 / 0, 1 / 0], float64: [-1 / 0, 1 / 0], bigint64: [-0x8000000000000000n, 0x7fffffffffffffffn], biguint64: [0n, 0xffffffffffffffffn] }, pu = new TextEncoder(), mu = new TextDecoder(), du = ["utf8", "utf-8", "hex", "base64", "ascii", "binary", "base64url", "ucs2", "ucs-2", "utf16le", "utf-16le", "latin1", "latin-1"], fu = 4294967295;
      lu(h.prototype);
      y = new Proxy(gu, { construct(e, [t, r]) {
        return h.from(t, r);
      }, get(e, t) {
        return h[t];
      } }), En = String.fromCodePoint;
    });
    var g;
    var x;
    var u = fe(() => {
      "use strict";
      g = { nextTick: (e, ...t) => {
        setTimeout(() => {
          e(...t);
        }, 0);
      }, env: {}, version: "", cwd: () => "/", stderr: {}, argv: ["/bin/node"], pid: 1e4 }, { cwd: x } = g;
    });
    var w;
    var c = fe(() => {
      "use strict";
      w = globalThis.performance ?? (() => {
        let e = Date.now();
        return { now: () => Date.now() - e };
      })();
    });
    var b;
    var p = fe(() => {
      "use strict";
      b = /* @__PURE__ */ __name(() => {
      }, "b");
      b.prototype = b;
    });
    function Hi(e, t) {
      var r, n, i, o, s, a, d, f, P = e.constructor, v = P.precision;
      if (!e.s || !t.s)
        return t.s || (t = new P(e)), B ? _(t, v) : t;
      if (d = e.d, f = t.d, s = e.e, i = t.e, d = d.slice(), o = s - i, o) {
        for (o < 0 ? (n = d, o = -o, a = f.length) : (n = f, i = s, a = d.length), s = Math.ceil(v / $3), a = s > a ? s + 1 : a + 1, o > a && (o = a, n.length = 1), n.reverse(); o--; )
          n.push(0);
        n.reverse();
      }
      for (a = d.length, o = f.length, a - o < 0 && (o = a, n = f, f = d, d = n), r = 0; o; )
        r = (d[--o] = d[o] + f[o] + r) / G | 0, d[o] %= G;
      for (r && (d.unshift(r), ++i), a = d.length; d[--a] == 0; )
        d.pop();
      return t.d = d, t.e = i, B ? _(t, v) : t;
    }
    __name(Hi, "Hi");
    function ye(e, t, r) {
      if (e !== ~~e || e < t || e > r)
        throw Error(qe + e);
    }
    __name(ye, "ye");
    function ge(e) {
      var t, r, n, i = e.length - 1, o = "", s = e[0];
      if (i > 0) {
        for (o += s, t = 1; t < i; t++)
          n = e[t] + "", r = $3 - n.length, r && (o += Re(r)), o += n;
        s = e[t], n = s + "", r = $3 - n.length, r && (o += Re(r));
      } else if (s === 0)
        return "0";
      for (; s % 10 === 0; )
        s /= 10;
      return o + s;
    }
    __name(ge, "ge");
    function Ji(e, t) {
      var r, n, i, o, s, a, d = 0, f = 0, P = e.constructor, v = P.precision;
      if (J(e) > 16)
        throw Error(Pn + J(e));
      if (!e.s)
        return new P(se);
      for (t == null ? (B = false, a = v) : a = t, s = new P(0.03125); e.abs().gte(0.1); )
        e = e.times(s), f += 5;
      for (n = Math.log($e(2, f)) / Math.LN10 * 2 + 5 | 0, a += n, r = i = o = new P(se), P.precision = a; ; ) {
        if (i = _(i.times(e), a), r = r.times(++d), s = o.plus(ve(i, r, a)), ge(s.d).slice(0, a) === ge(o.d).slice(0, a)) {
          for (; f--; )
            o = _(o.times(o), a);
          return P.precision = v, t == null ? (B = true, _(o, v)) : o;
        }
        o = s;
      }
    }
    __name(Ji, "Ji");
    function J(e) {
      for (var t = e.e * $3, r = e.d[0]; r >= 10; r /= 10)
        t++;
      return t;
    }
    __name(J, "J");
    function Tn(e, t, r) {
      if (t > e.LN10.sd())
        throw B = true, r && (e.precision = r), Error(le + "LN10 precision limit exceeded");
      return _(new e(e.LN10), t);
    }
    __name(Tn, "Tn");
    function Re(e) {
      for (var t = ""; e--; )
        t += "0";
      return t;
    }
    __name(Re, "Re");
    function Ct(e, t) {
      var r, n, i, o, s, a, d, f, P, v = 1, S = 10, C = e, M = C.d, R = C.constructor, k = R.precision;
      if (C.s < 1)
        throw Error(le + (C.s ? "NaN" : "-Infinity"));
      if (C.eq(se))
        return new R(0);
      if (t == null ? (B = false, f = k) : f = t, C.eq(10))
        return t == null && (B = true), Tn(R, f);
      if (f += S, R.precision = f, r = ge(M), n = r.charAt(0), o = J(C), Math.abs(o) < 15e14) {
        for (; n < 7 && n != 1 || n == 1 && r.charAt(1) > 3; )
          C = C.times(e), r = ge(C.d), n = r.charAt(0), v++;
        o = J(C), n > 1 ? (C = new R("0." + r), o++) : C = new R(n + "." + r.slice(1));
      } else
        return d = Tn(R, f + 2, k).times(o + ""), C = Ct(new R(n + "." + r.slice(1)), f - S).plus(d), R.precision = k, t == null ? (B = true, _(C, k)) : C;
      for (a = s = C = ve(C.minus(se), C.plus(se), f), P = _(C.times(C), f), i = 3; ; ) {
        if (s = _(s.times(P), f), d = a.plus(ve(s, new R(i), f)), ge(d.d).slice(0, f) === ge(a.d).slice(0, f))
          return a = a.times(2), o !== 0 && (a = a.plus(Tn(R, f + 2, k).times(o + ""))), a = ve(a, new R(v), f), R.precision = k, t == null ? (B = true, _(a, k)) : a;
        a = d, i += 2;
      }
    }
    __name(Ct, "Ct");
    function Bi(e, t) {
      var r, n, i;
      for ((r = t.indexOf(".")) > -1 && (t = t.replace(".", "")), (n = t.search(/e/i)) > 0 ? (r < 0 && (r = n), r += +t.slice(n + 1), t = t.substring(0, n)) : r < 0 && (r = t.length), n = 0; t.charCodeAt(n) === 48; )
        ++n;
      for (i = t.length; t.charCodeAt(i - 1) === 48; )
        --i;
      if (t = t.slice(n, i), t) {
        if (i -= n, r = r - n - 1, e.e = et(r / $3), e.d = [], n = (r + 1) % $3, r < 0 && (n += $3), n < i) {
          for (n && e.d.push(+t.slice(0, n)), i -= $3; n < i; )
            e.d.push(+t.slice(n, n += $3));
          t = t.slice(n), n = $3 - t.length;
        } else
          n -= i;
        for (; n--; )
          t += "0";
        if (e.d.push(+t), B && (e.e > dr || e.e < -dr))
          throw Error(Pn + r);
      } else
        e.s = 0, e.e = 0, e.d = [0];
      return e;
    }
    __name(Bi, "Bi");
    function _(e, t, r) {
      var n, i, o, s, a, d, f, P, v = e.d;
      for (s = 1, o = v[0]; o >= 10; o /= 10)
        s++;
      if (n = t - s, n < 0)
        n += $3, i = t, f = v[P = 0];
      else {
        if (P = Math.ceil((n + 1) / $3), o = v.length, P >= o)
          return e;
        for (f = o = v[P], s = 1; o >= 10; o /= 10)
          s++;
        n %= $3, i = n - $3 + s;
      }
      if (r !== void 0 && (o = $e(10, s - i - 1), a = f / o % 10 | 0, d = t < 0 || v[P + 1] !== void 0 || f % o, d = r < 4 ? (a || d) && (r == 0 || r == (e.s < 0 ? 3 : 2)) : a > 5 || a == 5 && (r == 4 || d || r == 6 && (n > 0 ? i > 0 ? f / $e(10, s - i) : 0 : v[P - 1]) % 10 & 1 || r == (e.s < 0 ? 8 : 7))), t < 1 || !v[0])
        return d ? (o = J(e), v.length = 1, t = t - o - 1, v[0] = $e(10, ($3 - t % $3) % $3), e.e = et(-t / $3) || 0) : (v.length = 1, v[0] = e.e = e.s = 0), e;
      if (n == 0 ? (v.length = P, o = 1, P--) : (v.length = P + 1, o = $e(10, $3 - n), v[P] = i > 0 ? (f / $e(10, s - i) % $e(10, i) | 0) * o : 0), d)
        for (; ; )
          if (P == 0) {
            (v[0] += o) == G && (v[0] = 1, ++e.e);
            break;
          } else {
            if (v[P] += o, v[P] != G)
              break;
            v[P--] = 0, o = 1;
          }
      for (n = v.length; v[--n] === 0; )
        v.pop();
      if (B && (e.e > dr || e.e < -dr))
        throw Error(Pn + J(e));
      return e;
    }
    __name(_, "_");
    function Wi(e, t) {
      var r, n, i, o, s, a, d, f, P, v, S = e.constructor, C = S.precision;
      if (!e.s || !t.s)
        return t.s ? t.s = -t.s : t = new S(e), B ? _(t, C) : t;
      if (d = e.d, v = t.d, n = t.e, f = e.e, d = d.slice(), s = f - n, s) {
        for (P = s < 0, P ? (r = d, s = -s, a = v.length) : (r = v, n = f, a = d.length), i = Math.max(Math.ceil(C / $3), a) + 2, s > i && (s = i, r.length = 1), r.reverse(), i = s; i--; )
          r.push(0);
        r.reverse();
      } else {
        for (i = d.length, a = v.length, P = i < a, P && (a = i), i = 0; i < a; i++)
          if (d[i] != v[i]) {
            P = d[i] < v[i];
            break;
          }
        s = 0;
      }
      for (P && (r = d, d = v, v = r, t.s = -t.s), a = d.length, i = v.length - a; i > 0; --i)
        d[a++] = 0;
      for (i = v.length; i > s; ) {
        if (d[--i] < v[i]) {
          for (o = i; o && d[--o] === 0; )
            d[o] = G - 1;
          --d[o], d[i] += G;
        }
        d[i] -= v[i];
      }
      for (; d[--a] === 0; )
        d.pop();
      for (; d[0] === 0; d.shift())
        --n;
      return d[0] ? (t.d = d, t.e = n, B ? _(t, C) : t) : new S(0);
    }
    __name(Wi, "Wi");
    function Ve(e, t, r) {
      var n, i = J(e), o = ge(e.d), s = o.length;
      return t ? (r && (n = r - s) > 0 ? o = o.charAt(0) + "." + o.slice(1) + Re(n) : s > 1 && (o = o.charAt(0) + "." + o.slice(1)), o = o + (i < 0 ? "e" : "e+") + i) : i < 0 ? (o = "0." + Re(-i - 1) + o, r && (n = r - s) > 0 && (o += Re(n))) : i >= s ? (o += Re(i + 1 - s), r && (n = r - i - 1) > 0 && (o = o + "." + Re(n))) : ((n = i + 1) < s && (o = o.slice(0, n) + "." + o.slice(n)), r && (n = r - s) > 0 && (i + 1 === s && (o += "."), o += Re(n))), e.s < 0 ? "-" + o : o;
    }
    __name(Ve, "Ve");
    function ji(e, t) {
      if (e.length > t)
        return e.length = t, true;
    }
    __name(ji, "ji");
    function Gi(e) {
      var t, r, n;
      function i(o) {
        var s = this;
        if (!(s instanceof i))
          return new i(o);
        if (s.constructor = i, o instanceof i) {
          s.s = o.s, s.e = o.e, s.d = (o = o.d) ? o.slice() : o;
          return;
        }
        if (typeof o == "number") {
          if (o * 0 !== 0)
            throw Error(qe + o);
          if (o > 0)
            s.s = 1;
          else if (o < 0)
            o = -o, s.s = -1;
          else {
            s.s = 0, s.e = 0, s.d = [0];
            return;
          }
          if (o === ~~o && o < 1e7) {
            s.e = 0, s.d = [o];
            return;
          }
          return Bi(s, o.toString());
        } else if (typeof o != "string")
          throw Error(qe + o);
        if (o.charCodeAt(0) === 45 ? (o = o.slice(1), s.s = -1) : s.s = 1, hu.test(o))
          Bi(s, o);
        else
          throw Error(qe + o);
      }
      __name(i, "i");
      if (i.prototype = A, i.ROUND_UP = 0, i.ROUND_DOWN = 1, i.ROUND_CEIL = 2, i.ROUND_FLOOR = 3, i.ROUND_HALF_UP = 4, i.ROUND_HALF_DOWN = 5, i.ROUND_HALF_EVEN = 6, i.ROUND_HALF_CEIL = 7, i.ROUND_HALF_FLOOR = 8, i.clone = Gi, i.config = i.set = wu, e === void 0 && (e = {}), e)
        for (n = ["precision", "rounding", "toExpNeg", "toExpPos", "LN10"], t = 0; t < n.length; )
          e.hasOwnProperty(r = n[t++]) || (e[r] = this[r]);
      return i.config(e), i;
    }
    __name(Gi, "Gi");
    function wu(e) {
      if (!e || typeof e != "object")
        throw Error(le + "Object expected");
      var t, r, n, i = ["precision", 1, Xe, "rounding", 0, 8, "toExpNeg", -1 / 0, 0, "toExpPos", 0, 1 / 0];
      for (t = 0; t < i.length; t += 3)
        if ((n = e[r = i[t]]) !== void 0)
          if (et(n) === n && n >= i[t + 1] && n <= i[t + 2])
            this[r] = n;
          else
            throw Error(qe + r + ": " + n);
      if ((n = e[r = "LN10"]) !== void 0)
        if (n == Math.LN10)
          this[r] = new this(n);
        else
          throw Error(qe + r + ": " + n);
      return this;
    }
    __name(wu, "wu");
    var Xe;
    var yu;
    var Ki;
    var B;
    var le;
    var qe;
    var Pn;
    var et;
    var $e;
    var hu;
    var se;
    var G;
    var $3;
    var Qi;
    var dr;
    var A;
    var ve;
    var Ki;
    var zi = fe(() => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      Xe = 1e9, yu = { precision: 20, rounding: 4, toExpNeg: -7, toExpPos: 21, LN10: "2.302585092994045684017991454684364207601101488628772976033327900967572609677352480235997205089598298341967784042286" }, B = true, le = "[DecimalError] ", qe = le + "Invalid argument: ", Pn = le + "Exponent out of range: ", et = Math.floor, $e = Math.pow, hu = /^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i, G = 1e7, $3 = 7, Qi = 9007199254740991, dr = et(Qi / $3), A = {};
      A.absoluteValue = A.abs = function() {
        var e = new this.constructor(this);
        return e.s && (e.s = 1), e;
      };
      A.comparedTo = A.cmp = function(e) {
        var t, r, n, i, o = this;
        if (e = new o.constructor(e), o.s !== e.s)
          return o.s || -e.s;
        if (o.e !== e.e)
          return o.e > e.e ^ o.s < 0 ? 1 : -1;
        for (n = o.d.length, i = e.d.length, t = 0, r = n < i ? n : i; t < r; ++t)
          if (o.d[t] !== e.d[t])
            return o.d[t] > e.d[t] ^ o.s < 0 ? 1 : -1;
        return n === i ? 0 : n > i ^ o.s < 0 ? 1 : -1;
      };
      A.decimalPlaces = A.dp = function() {
        var e = this, t = e.d.length - 1, r = (t - e.e) * $3;
        if (t = e.d[t], t)
          for (; t % 10 == 0; t /= 10)
            r--;
        return r < 0 ? 0 : r;
      };
      A.dividedBy = A.div = function(e) {
        return ve(this, new this.constructor(e));
      };
      A.dividedToIntegerBy = A.idiv = function(e) {
        var t = this, r = t.constructor;
        return _(ve(t, new r(e), 0, 1), r.precision);
      };
      A.equals = A.eq = function(e) {
        return !this.cmp(e);
      };
      A.exponent = function() {
        return J(this);
      };
      A.greaterThan = A.gt = function(e) {
        return this.cmp(e) > 0;
      };
      A.greaterThanOrEqualTo = A.gte = function(e) {
        return this.cmp(e) >= 0;
      };
      A.isInteger = A.isint = function() {
        return this.e > this.d.length - 2;
      };
      A.isNegative = A.isneg = function() {
        return this.s < 0;
      };
      A.isPositive = A.ispos = function() {
        return this.s > 0;
      };
      A.isZero = function() {
        return this.s === 0;
      };
      A.lessThan = A.lt = function(e) {
        return this.cmp(e) < 0;
      };
      A.lessThanOrEqualTo = A.lte = function(e) {
        return this.cmp(e) < 1;
      };
      A.logarithm = A.log = function(e) {
        var t, r = this, n = r.constructor, i = n.precision, o = i + 5;
        if (e === void 0)
          e = new n(10);
        else if (e = new n(e), e.s < 1 || e.eq(se))
          throw Error(le + "NaN");
        if (r.s < 1)
          throw Error(le + (r.s ? "NaN" : "-Infinity"));
        return r.eq(se) ? new n(0) : (B = false, t = ve(Ct(r, o), Ct(e, o), o), B = true, _(t, i));
      };
      A.minus = A.sub = function(e) {
        var t = this;
        return e = new t.constructor(e), t.s == e.s ? Wi(t, e) : Hi(t, (e.s = -e.s, e));
      };
      A.modulo = A.mod = function(e) {
        var t, r = this, n = r.constructor, i = n.precision;
        if (e = new n(e), !e.s)
          throw Error(le + "NaN");
        return r.s ? (B = false, t = ve(r, e, 0, 1).times(e), B = true, r.minus(t)) : _(new n(r), i);
      };
      A.naturalExponential = A.exp = function() {
        return Ji(this);
      };
      A.naturalLogarithm = A.ln = function() {
        return Ct(this);
      };
      A.negated = A.neg = function() {
        var e = new this.constructor(this);
        return e.s = -e.s || 0, e;
      };
      A.plus = A.add = function(e) {
        var t = this;
        return e = new t.constructor(e), t.s == e.s ? Hi(t, e) : Wi(t, (e.s = -e.s, e));
      };
      A.precision = A.sd = function(e) {
        var t, r, n, i = this;
        if (e !== void 0 && e !== !!e && e !== 1 && e !== 0)
          throw Error(qe + e);
        if (t = J(i) + 1, n = i.d.length - 1, r = n * $3 + 1, n = i.d[n], n) {
          for (; n % 10 == 0; n /= 10)
            r--;
          for (n = i.d[0]; n >= 10; n /= 10)
            r++;
        }
        return e && t > r ? t : r;
      };
      A.squareRoot = A.sqrt = function() {
        var e, t, r, n, i, o, s, a = this, d = a.constructor;
        if (a.s < 1) {
          if (!a.s)
            return new d(0);
          throw Error(le + "NaN");
        }
        for (e = J(a), B = false, i = Math.sqrt(+a), i == 0 || i == 1 / 0 ? (t = ge(a.d), (t.length + e) % 2 == 0 && (t += "0"), i = Math.sqrt(t), e = et((e + 1) / 2) - (e < 0 || e % 2), i == 1 / 0 ? t = "5e" + e : (t = i.toExponential(), t = t.slice(0, t.indexOf("e") + 1) + e), n = new d(t)) : n = new d(i.toString()), r = d.precision, i = s = r + 3; ; )
          if (o = n, n = o.plus(ve(a, o, s + 2)).times(0.5), ge(o.d).slice(0, s) === (t = ge(n.d)).slice(0, s)) {
            if (t = t.slice(s - 3, s + 1), i == s && t == "4999") {
              if (_(o, r + 1, 0), o.times(o).eq(a)) {
                n = o;
                break;
              }
            } else if (t != "9999")
              break;
            s += 4;
          }
        return B = true, _(n, r);
      };
      A.times = A.mul = function(e) {
        var t, r, n, i, o, s, a, d, f, P = this, v = P.constructor, S = P.d, C = (e = new v(e)).d;
        if (!P.s || !e.s)
          return new v(0);
        for (e.s *= P.s, r = P.e + e.e, d = S.length, f = C.length, d < f && (o = S, S = C, C = o, s = d, d = f, f = s), o = [], s = d + f, n = s; n--; )
          o.push(0);
        for (n = f; --n >= 0; ) {
          for (t = 0, i = d + n; i > n; )
            a = o[i] + C[n] * S[i - n - 1] + t, o[i--] = a % G | 0, t = a / G | 0;
          o[i] = (o[i] + t) % G | 0;
        }
        for (; !o[--s]; )
          o.pop();
        return t ? ++r : o.shift(), e.d = o, e.e = r, B ? _(e, v.precision) : e;
      };
      A.toDecimalPlaces = A.todp = function(e, t) {
        var r = this, n = r.constructor;
        return r = new n(r), e === void 0 ? r : (ye(e, 0, Xe), t === void 0 ? t = n.rounding : ye(t, 0, 8), _(r, e + J(r) + 1, t));
      };
      A.toExponential = function(e, t) {
        var r, n = this, i = n.constructor;
        return e === void 0 ? r = Ve(n, true) : (ye(e, 0, Xe), t === void 0 ? t = i.rounding : ye(t, 0, 8), n = _(new i(n), e + 1, t), r = Ve(n, true, e + 1)), r;
      };
      A.toFixed = function(e, t) {
        var r, n, i = this, o = i.constructor;
        return e === void 0 ? Ve(i) : (ye(e, 0, Xe), t === void 0 ? t = o.rounding : ye(t, 0, 8), n = _(new o(i), e + J(i) + 1, t), r = Ve(n.abs(), false, e + J(n) + 1), i.isneg() && !i.isZero() ? "-" + r : r);
      };
      A.toInteger = A.toint = function() {
        var e = this, t = e.constructor;
        return _(new t(e), J(e) + 1, t.rounding);
      };
      A.toNumber = function() {
        return +this;
      };
      A.toPower = A.pow = function(e) {
        var t, r, n, i, o, s, a = this, d = a.constructor, f = 12, P = +(e = new d(e));
        if (!e.s)
          return new d(se);
        if (a = new d(a), !a.s) {
          if (e.s < 1)
            throw Error(le + "Infinity");
          return a;
        }
        if (a.eq(se))
          return a;
        if (n = d.precision, e.eq(se))
          return _(a, n);
        if (t = e.e, r = e.d.length - 1, s = t >= r, o = a.s, s) {
          if ((r = P < 0 ? -P : P) <= Qi) {
            for (i = new d(se), t = Math.ceil(n / $3 + 4), B = false; r % 2 && (i = i.times(a), ji(i.d, t)), r = et(r / 2), r !== 0; )
              a = a.times(a), ji(a.d, t);
            return B = true, e.s < 0 ? new d(se).div(i) : _(i, n);
          }
        } else if (o < 0)
          throw Error(le + "NaN");
        return o = o < 0 && e.d[Math.max(t, r)] & 1 ? -1 : 1, a.s = 1, B = false, i = e.times(Ct(a, n + f)), B = true, i = Ji(i), i.s = o, i;
      };
      A.toPrecision = function(e, t) {
        var r, n, i = this, o = i.constructor;
        return e === void 0 ? (r = J(i), n = Ve(i, r <= o.toExpNeg || r >= o.toExpPos)) : (ye(e, 1, Xe), t === void 0 ? t = o.rounding : ye(t, 0, 8), i = _(new o(i), e, t), r = J(i), n = Ve(i, e <= r || r <= o.toExpNeg, e)), n;
      };
      A.toSignificantDigits = A.tosd = function(e, t) {
        var r = this, n = r.constructor;
        return e === void 0 ? (e = n.precision, t = n.rounding) : (ye(e, 1, Xe), t === void 0 ? t = n.rounding : ye(t, 0, 8)), _(new n(r), e, t);
      };
      A.toString = A.valueOf = A.val = A.toJSON = A[Symbol.for("nodejs.util.inspect.custom")] = function() {
        var e = this, t = J(e), r = e.constructor;
        return Ve(e, t <= r.toExpNeg || t >= r.toExpPos);
      };
      ve = function() {
        function e(n, i) {
          var o, s = 0, a = n.length;
          for (n = n.slice(); a--; )
            o = n[a] * i + s, n[a] = o % G | 0, s = o / G | 0;
          return s && n.unshift(s), n;
        }
        __name(e, "e");
        function t(n, i, o, s) {
          var a, d;
          if (o != s)
            d = o > s ? 1 : -1;
          else
            for (a = d = 0; a < o; a++)
              if (n[a] != i[a]) {
                d = n[a] > i[a] ? 1 : -1;
                break;
              }
          return d;
        }
        __name(t, "t");
        function r(n, i, o) {
          for (var s = 0; o--; )
            n[o] -= s, s = n[o] < i[o] ? 1 : 0, n[o] = s * G + n[o] - i[o];
          for (; !n[0] && n.length > 1; )
            n.shift();
        }
        __name(r, "r");
        return function(n, i, o, s) {
          var a, d, f, P, v, S, C, M, R, k, Pe, re, F, ne, Fe, bn, ce, ur, cr = n.constructor, ru = n.s == i.s ? 1 : -1, de = n.d, Q = i.d;
          if (!n.s)
            return new cr(n);
          if (!i.s)
            throw Error(le + "Division by zero");
          for (d = n.e - i.e, ce = Q.length, Fe = de.length, C = new cr(ru), M = C.d = [], f = 0; Q[f] == (de[f] || 0); )
            ++f;
          if (Q[f] > (de[f] || 0) && --d, o == null ? re = o = cr.precision : s ? re = o + (J(n) - J(i)) + 1 : re = o, re < 0)
            return new cr(0);
          if (re = re / $3 + 2 | 0, f = 0, ce == 1)
            for (P = 0, Q = Q[0], re++; (f < Fe || P) && re--; f++)
              F = P * G + (de[f] || 0), M[f] = F / Q | 0, P = F % Q | 0;
          else {
            for (P = G / (Q[0] + 1) | 0, P > 1 && (Q = e(Q, P), de = e(de, P), ce = Q.length, Fe = de.length), ne = ce, R = de.slice(0, ce), k = R.length; k < ce; )
              R[k++] = 0;
            ur = Q.slice(), ur.unshift(0), bn = Q[0], Q[1] >= G / 2 && ++bn;
            do
              P = 0, a = t(Q, R, ce, k), a < 0 ? (Pe = R[0], ce != k && (Pe = Pe * G + (R[1] || 0)), P = Pe / bn | 0, P > 1 ? (P >= G && (P = G - 1), v = e(Q, P), S = v.length, k = R.length, a = t(v, R, S, k), a == 1 && (P--, r(v, ce < S ? ur : Q, S))) : (P == 0 && (a = P = 1), v = Q.slice()), S = v.length, S < k && v.unshift(0), r(R, v, k), a == -1 && (k = R.length, a = t(Q, R, ce, k), a < 1 && (P++, r(R, ce < k ? ur : Q, k))), k = R.length) : a === 0 && (P++, R = [0]), M[f++] = P, a && R[0] ? R[k++] = de[ne] || 0 : (R = [de[ne]], k = 1);
            while ((ne++ < Fe || R[0] !== void 0) && re--);
          }
          return M[0] || M.shift(), C.e = d, _(C, s ? o + J(C) + 1 : o);
        };
      }();
      Ki = Gi(yu);
      se = new Ki(1);
    });
    var m = fe(() => {
      "use strict";
      zi();
    });
    var In = {};
    Ye(In, { Hash: () => Ot, createHash: () => yo, default: () => rt, randomFillSync: () => wr, randomUUID: () => hr, webcrypto: () => kt });
    function hr() {
      return globalThis.crypto.randomUUID();
    }
    __name(hr, "hr");
    function wr(e, t, r) {
      return t !== void 0 && (r !== void 0 ? e = e.subarray(t, t + r) : e = e.subarray(t)), globalThis.crypto.getRandomValues(e);
    }
    __name(wr, "wr");
    function yo(e) {
      return new Ot(e);
    }
    __name(yo, "yo");
    var kt;
    var Ot;
    var rt;
    var Be = fe(() => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      kt = globalThis.crypto;
      Ot = /* @__PURE__ */ __name(class {
        #t = [];
        #e;
        constructor(t) {
          this.#e = t;
        }
        update(t) {
          this.#t.push(t);
        }
        async digest() {
          let t = new Uint8Array(this.#t.reduce((i, o) => i + o.length, 0)), r = 0;
          for (let i of this.#t)
            t.set(i, r), r += i.length;
          let n = await globalThis.crypto.subtle.digest(this.#e, t);
          return new Uint8Array(n);
        }
      }, "Ot"), rt = { webcrypto: kt, randomUUID: hr, randomFillSync: wr, createHash: yo, Hash: Ot };
    });
    var ho = oe(() => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
    });
    var wo = oe((jg, vu) => {
      vu.exports = { name: "@prisma/engines-version", version: "7.2.0-4.0c8ef2ce45c83248ab3df073180d5eda9e8be7a3", main: "index.js", types: "index.d.ts", license: "Apache-2.0", author: "Tim Suchanek <suchanek@prisma.io>", prisma: { enginesVersion: "0c8ef2ce45c83248ab3df073180d5eda9e8be7a3" }, repository: { type: "git", url: "https://github.com/prisma/engines-wrapper.git", directory: "packages/engines-version" }, devDependencies: { "@types/node": "18.19.76", typescript: "4.9.5" }, files: ["index.js", "index.d.ts"], scripts: { build: "tsc -d" } };
    });
    var bo = oe((br) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      Object.defineProperty(br, "__esModule", { value: true });
      br.enginesVersion = void 0;
      br.enginesVersion = wo().prisma.enginesVersion;
    });
    var Po = oe((ry, To) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      To.exports = (e, t = 1, r) => {
        if (r = { indent: " ", includeEmptyLines: false, ...r }, typeof e != "string")
          throw new TypeError(`Expected \`input\` to be a \`string\`, got \`${typeof e}\``);
        if (typeof t != "number")
          throw new TypeError(`Expected \`count\` to be a \`number\`, got \`${typeof t}\``);
        if (typeof r.indent != "string")
          throw new TypeError(`Expected \`options.indent\` to be a \`string\`, got \`${typeof r.indent}\``);
        if (t === 0)
          return e;
        let n = r.includeEmptyLines ? /^/gm : /^(?!\s*$)/gm;
        return e.replace(n, r.indent.repeat(t));
      };
    });
    var Ao = oe((Dy, Er) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      Er.exports = (e = {}) => {
        let t;
        if (e.repoUrl)
          t = e.repoUrl;
        else if (e.user && e.repo)
          t = `https://github.com/${e.user}/${e.repo}`;
        else
          throw new Error("You need to specify either the `repoUrl` option or both the `user` and `repo` options");
        let r = new URL(`${t}/issues/new`), n = ["body", "title", "labels", "template", "milestone", "assignee", "projects"];
        for (let i of n) {
          let o = e[i];
          if (o !== void 0) {
            if (i === "labels" || i === "projects") {
              if (!Array.isArray(o))
                throw new TypeError(`The \`${i}\` option should be an array`);
              o = o.join(",");
            }
            r.searchParams.set(i, o);
          }
        }
        return r.toString();
      };
      Er.exports.default = Er.exports;
    });
    var _n = oe((Ew, Ro) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      Ro.exports = function() {
        function e(t, r, n, i, o) {
          return t < r || n < r ? t > n ? n + 1 : t + 1 : i === o ? r : r + 1;
        }
        __name(e, "e");
        return function(t, r) {
          if (t === r)
            return 0;
          if (t.length > r.length) {
            var n = t;
            t = r, r = n;
          }
          for (var i = t.length, o = r.length; i > 0 && t.charCodeAt(i - 1) === r.charCodeAt(o - 1); )
            i--, o--;
          for (var s = 0; s < i && t.charCodeAt(s) === r.charCodeAt(s); )
            s++;
          if (i -= s, o -= s, i === 0 || o < 3)
            return o;
          var a = 0, d, f, P, v, S, C, M, R, k, Pe, re, F, ne = [];
          for (d = 0; d < i; d++)
            ne.push(d + 1), ne.push(t.charCodeAt(s + d));
          for (var Fe = ne.length - 1; a < o - 3; )
            for (k = r.charCodeAt(s + (f = a)), Pe = r.charCodeAt(s + (P = a + 1)), re = r.charCodeAt(s + (v = a + 2)), F = r.charCodeAt(s + (S = a + 3)), C = a += 4, d = 0; d < Fe; d += 2)
              M = ne[d], R = ne[d + 1], f = e(M, f, P, k, R), P = e(f, P, v, Pe, R), v = e(P, v, S, re, R), C = e(v, S, C, F, R), ne[d] = C, S = v, v = P, P = f, f = M;
          for (; a < o; )
            for (k = r.charCodeAt(s + (f = a)), C = ++a, d = 0; d < Fe; d += 2)
              M = ne[d], ne[d] = C = e(M, f, C, k, ne[d + 1]), f = M;
          return C;
        };
      }();
    });
    var Do = fe(() => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
    });
    var No = fe(() => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
    });
    var $r;
    var os = fe(() => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      $r = /* @__PURE__ */ __name(class {
        events = {};
        on(t, r) {
          return this.events[t] || (this.events[t] = []), this.events[t].push(r), this;
        }
        emit(t, ...r) {
          return this.events[t] ? (this.events[t].forEach((n) => {
            n(...r);
          }), true) : false;
        }
      }, "$r");
    });
    var ri = oe((Je) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      Object.defineProperty(Je, "__esModule", { value: true });
      Je.anumber = ti;
      Je.abytes = Gs;
      Je.ahash = ip;
      Je.aexists = op;
      Je.aoutput = sp;
      function ti(e) {
        if (!Number.isSafeInteger(e) || e < 0)
          throw new Error("positive integer expected, got " + e);
      }
      __name(ti, "ti");
      function np(e) {
        return e instanceof Uint8Array || ArrayBuffer.isView(e) && e.constructor.name === "Uint8Array";
      }
      __name(np, "np");
      function Gs(e, ...t) {
        if (!np(e))
          throw new Error("Uint8Array expected");
        if (t.length > 0 && !t.includes(e.length))
          throw new Error("Uint8Array expected of length " + t + ", got length=" + e.length);
      }
      __name(Gs, "Gs");
      function ip(e) {
        if (typeof e != "function" || typeof e.create != "function")
          throw new Error("Hash should be wrapped by utils.wrapConstructor");
        ti(e.outputLen), ti(e.blockLen);
      }
      __name(ip, "ip");
      function op(e, t = true) {
        if (e.destroyed)
          throw new Error("Hash instance has been destroyed");
        if (t && e.finished)
          throw new Error("Hash#digest() has already been called");
      }
      __name(op, "op");
      function sp(e, t) {
        Gs(e);
        let r = t.outputLen;
        if (e.length < r)
          throw new Error("digestInto() expects output buffer of length at least " + r);
      }
      __name(sp, "sp");
    });
    var ya = oe((O) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      Object.defineProperty(O, "__esModule", { value: true });
      O.add5L = O.add5H = O.add4H = O.add4L = O.add3H = O.add3L = O.rotlBL = O.rotlBH = O.rotlSL = O.rotlSH = O.rotr32L = O.rotr32H = O.rotrBL = O.rotrBH = O.rotrSL = O.rotrSH = O.shrSL = O.shrSH = O.toBig = void 0;
      O.fromBig = ii;
      O.split = Ks;
      O.add = ua;
      var Gr = BigInt(2 ** 32 - 1), ni = BigInt(32);
      function ii(e, t = false) {
        return t ? { h: Number(e & Gr), l: Number(e >> ni & Gr) } : { h: Number(e >> ni & Gr) | 0, l: Number(e & Gr) | 0 };
      }
      __name(ii, "ii");
      function Ks(e, t = false) {
        let r = new Uint32Array(e.length), n = new Uint32Array(e.length);
        for (let i = 0; i < e.length; i++) {
          let { h: o, l: s } = ii(e[i], t);
          [r[i], n[i]] = [o, s];
        }
        return [r, n];
      }
      __name(Ks, "Ks");
      var zs = /* @__PURE__ */ __name((e, t) => BigInt(e >>> 0) << ni | BigInt(t >>> 0), "zs");
      O.toBig = zs;
      var Zs = /* @__PURE__ */ __name((e, t, r) => e >>> r, "Zs");
      O.shrSH = Zs;
      var Ys = /* @__PURE__ */ __name((e, t, r) => e << 32 - r | t >>> r, "Ys");
      O.shrSL = Ys;
      var Xs = /* @__PURE__ */ __name((e, t, r) => e >>> r | t << 32 - r, "Xs");
      O.rotrSH = Xs;
      var ea = /* @__PURE__ */ __name((e, t, r) => e << 32 - r | t >>> r, "ea");
      O.rotrSL = ea;
      var ta = /* @__PURE__ */ __name((e, t, r) => e << 64 - r | t >>> r - 32, "ta");
      O.rotrBH = ta;
      var ra = /* @__PURE__ */ __name((e, t, r) => e >>> r - 32 | t << 64 - r, "ra");
      O.rotrBL = ra;
      var na = /* @__PURE__ */ __name((e, t) => t, "na");
      O.rotr32H = na;
      var ia = /* @__PURE__ */ __name((e, t) => e, "ia");
      O.rotr32L = ia;
      var oa = /* @__PURE__ */ __name((e, t, r) => e << r | t >>> 32 - r, "oa");
      O.rotlSH = oa;
      var sa = /* @__PURE__ */ __name((e, t, r) => t << r | e >>> 32 - r, "sa");
      O.rotlSL = sa;
      var aa = /* @__PURE__ */ __name((e, t, r) => t << r - 32 | e >>> 64 - r, "aa");
      O.rotlBH = aa;
      var la = /* @__PURE__ */ __name((e, t, r) => e << r - 32 | t >>> 64 - r, "la");
      O.rotlBL = la;
      function ua(e, t, r, n) {
        let i = (t >>> 0) + (n >>> 0);
        return { h: e + r + (i / 2 ** 32 | 0) | 0, l: i | 0 };
      }
      __name(ua, "ua");
      var ca = /* @__PURE__ */ __name((e, t, r) => (e >>> 0) + (t >>> 0) + (r >>> 0), "ca");
      O.add3L = ca;
      var pa = /* @__PURE__ */ __name((e, t, r, n) => t + r + n + (e / 2 ** 32 | 0) | 0, "pa");
      O.add3H = pa;
      var ma = /* @__PURE__ */ __name((e, t, r, n) => (e >>> 0) + (t >>> 0) + (r >>> 0) + (n >>> 0), "ma");
      O.add4L = ma;
      var da = /* @__PURE__ */ __name((e, t, r, n, i) => t + r + n + i + (e / 2 ** 32 | 0) | 0, "da");
      O.add4H = da;
      var fa = /* @__PURE__ */ __name((e, t, r, n, i) => (e >>> 0) + (t >>> 0) + (r >>> 0) + (n >>> 0) + (i >>> 0), "fa");
      O.add5L = fa;
      var ga = /* @__PURE__ */ __name((e, t, r, n, i, o) => t + r + n + i + o + (e / 2 ** 32 | 0) | 0, "ga");
      O.add5H = ga;
      var ap4 = { fromBig: ii, split: Ks, toBig: zs, shrSH: Zs, shrSL: Ys, rotrSH: Xs, rotrSL: ea, rotrBH: ta, rotrBL: ra, rotr32H: na, rotr32L: ia, rotlSH: oa, rotlSL: sa, rotlBH: aa, rotlBL: la, add: ua, add3L: ca, add3H: pa, add4L: ma, add4H: da, add5H: ga, add5L: fa };
      O.default = ap4;
    });
    var ha = oe((Kr) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      Object.defineProperty(Kr, "__esModule", { value: true });
      Kr.crypto = void 0;
      var Ne = (Be(), $i(In));
      Kr.crypto = Ne && typeof Ne == "object" && "webcrypto" in Ne ? Ne.webcrypto : Ne && typeof Ne == "object" && "randomBytes" in Ne ? Ne : void 0;
    });
    var xa = oe((N) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      Object.defineProperty(N, "__esModule", { value: true });
      N.Hash = N.nextTick = N.byteSwapIfBE = N.isLE = void 0;
      N.isBytes = lp;
      N.u8 = up;
      N.u32 = cp;
      N.createView = pp;
      N.rotr = mp;
      N.rotl = dp;
      N.byteSwap = ai;
      N.byteSwap32 = fp;
      N.bytesToHex = yp;
      N.hexToBytes = hp;
      N.asyncLoop = bp;
      N.utf8ToBytes = ba;
      N.toBytes = zr;
      N.concatBytes = xp;
      N.checkOpts = Ep;
      N.wrapConstructor = Tp;
      N.wrapConstructorWithOpts = Pp;
      N.wrapXOFConstructorWithOpts = vp;
      N.randomBytes = Ap;
      var wt = ha(), si = ri();
      function lp(e) {
        return e instanceof Uint8Array || ArrayBuffer.isView(e) && e.constructor.name === "Uint8Array";
      }
      __name(lp, "lp");
      function up(e) {
        return new Uint8Array(e.buffer, e.byteOffset, e.byteLength);
      }
      __name(up, "up");
      function cp(e) {
        return new Uint32Array(e.buffer, e.byteOffset, Math.floor(e.byteLength / 4));
      }
      __name(cp, "cp");
      function pp(e) {
        return new DataView(e.buffer, e.byteOffset, e.byteLength);
      }
      __name(pp, "pp");
      function mp(e, t) {
        return e << 32 - t | e >>> t;
      }
      __name(mp, "mp");
      function dp(e, t) {
        return e << t | e >>> 32 - t >>> 0;
      }
      __name(dp, "dp");
      N.isLE = new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68;
      function ai(e) {
        return e << 24 & 4278190080 | e << 8 & 16711680 | e >>> 8 & 65280 | e >>> 24 & 255;
      }
      __name(ai, "ai");
      N.byteSwapIfBE = N.isLE ? (e) => e : (e) => ai(e);
      function fp(e) {
        for (let t = 0; t < e.length; t++)
          e[t] = ai(e[t]);
      }
      __name(fp, "fp");
      var gp = Array.from({ length: 256 }, (e, t) => t.toString(16).padStart(2, "0"));
      function yp(e) {
        (0, si.abytes)(e);
        let t = "";
        for (let r = 0; r < e.length; r++)
          t += gp[e[r]];
        return t;
      }
      __name(yp, "yp");
      var Ce = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
      function wa(e) {
        if (e >= Ce._0 && e <= Ce._9)
          return e - Ce._0;
        if (e >= Ce.A && e <= Ce.F)
          return e - (Ce.A - 10);
        if (e >= Ce.a && e <= Ce.f)
          return e - (Ce.a - 10);
      }
      __name(wa, "wa");
      function hp(e) {
        if (typeof e != "string")
          throw new Error("hex string expected, got " + typeof e);
        let t = e.length, r = t / 2;
        if (t % 2)
          throw new Error("hex string expected, got unpadded hex of length " + t);
        let n = new Uint8Array(r);
        for (let i = 0, o = 0; i < r; i++, o += 2) {
          let s = wa(e.charCodeAt(o)), a = wa(e.charCodeAt(o + 1));
          if (s === void 0 || a === void 0) {
            let d = e[o] + e[o + 1];
            throw new Error('hex string expected, got non-hex character "' + d + '" at index ' + o);
          }
          n[i] = s * 16 + a;
        }
        return n;
      }
      __name(hp, "hp");
      var wp = /* @__PURE__ */ __name(async () => {
      }, "wp");
      N.nextTick = wp;
      async function bp(e, t, r) {
        let n = Date.now();
        for (let i = 0; i < e; i++) {
          r(i);
          let o = Date.now() - n;
          o >= 0 && o < t || (await (0, N.nextTick)(), n += o);
        }
      }
      __name(bp, "bp");
      function ba(e) {
        if (typeof e != "string")
          throw new Error("utf8ToBytes expected string, got " + typeof e);
        return new Uint8Array(new TextEncoder().encode(e));
      }
      __name(ba, "ba");
      function zr(e) {
        return typeof e == "string" && (e = ba(e)), (0, si.abytes)(e), e;
      }
      __name(zr, "zr");
      function xp(...e) {
        let t = 0;
        for (let n = 0; n < e.length; n++) {
          let i = e[n];
          (0, si.abytes)(i), t += i.length;
        }
        let r = new Uint8Array(t);
        for (let n = 0, i = 0; n < e.length; n++) {
          let o = e[n];
          r.set(o, i), i += o.length;
        }
        return r;
      }
      __name(xp, "xp");
      var oi = /* @__PURE__ */ __name(class {
        clone() {
          return this._cloneInto();
        }
      }, "oi");
      N.Hash = oi;
      function Ep(e, t) {
        if (t !== void 0 && {}.toString.call(t) !== "[object Object]")
          throw new Error("Options should be object or undefined");
        return Object.assign(e, t);
      }
      __name(Ep, "Ep");
      function Tp(e) {
        let t = /* @__PURE__ */ __name((n) => e().update(zr(n)).digest(), "t"), r = e();
        return t.outputLen = r.outputLen, t.blockLen = r.blockLen, t.create = () => e(), t;
      }
      __name(Tp, "Tp");
      function Pp(e) {
        let t = /* @__PURE__ */ __name((n, i) => e(i).update(zr(n)).digest(), "t"), r = e({});
        return t.outputLen = r.outputLen, t.blockLen = r.blockLen, t.create = (n) => e(n), t;
      }
      __name(Pp, "Pp");
      function vp(e) {
        let t = /* @__PURE__ */ __name((n, i) => e(i).update(zr(n)).digest(), "t"), r = e({});
        return t.outputLen = r.outputLen, t.blockLen = r.blockLen, t.create = (n) => e(n), t;
      }
      __name(vp, "vp");
      function Ap(e = 32) {
        if (wt.crypto && typeof wt.crypto.getRandomValues == "function")
          return wt.crypto.getRandomValues(new Uint8Array(e));
        if (wt.crypto && typeof wt.crypto.randomBytes == "function")
          return wt.crypto.randomBytes(e);
        throw new Error("crypto.getRandomValues must be defined");
      }
      __name(Ap, "Ap");
    });
    var Ra = oe((V) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      Object.defineProperty(V, "__esModule", { value: true });
      V.shake256 = V.shake128 = V.keccak_512 = V.keccak_384 = V.keccak_256 = V.keccak_224 = V.sha3_512 = V.sha3_384 = V.sha3_256 = V.sha3_224 = V.Keccak = void 0;
      V.keccakP = Ca;
      var bt = ri(), zt = ya(), Se = xa(), Pa = [], va = [], Aa = [], Cp = BigInt(0), Kt = BigInt(1), Sp = BigInt(2), Rp = BigInt(7), Ip = BigInt(256), Op = BigInt(113);
      for (let e = 0, t = Kt, r = 1, n = 0; e < 24; e++) {
        [r, n] = [n, (2 * r + 3 * n) % 5], Pa.push(2 * (5 * n + r)), va.push((e + 1) * (e + 2) / 2 % 64);
        let i = Cp;
        for (let o = 0; o < 7; o++)
          t = (t << Kt ^ (t >> Rp) * Op) % Ip, t & Sp && (i ^= Kt << (Kt << BigInt(o)) - Kt);
        Aa.push(i);
      }
      var [kp, Mp] = (0, zt.split)(Aa, true), Ea = /* @__PURE__ */ __name((e, t, r) => r > 32 ? (0, zt.rotlBH)(e, t, r) : (0, zt.rotlSH)(e, t, r), "Ea"), Ta = /* @__PURE__ */ __name((e, t, r) => r > 32 ? (0, zt.rotlBL)(e, t, r) : (0, zt.rotlSL)(e, t, r), "Ta");
      function Ca(e, t = 24) {
        let r = new Uint32Array(10);
        for (let n = 24 - t; n < 24; n++) {
          for (let s = 0; s < 10; s++)
            r[s] = e[s] ^ e[s + 10] ^ e[s + 20] ^ e[s + 30] ^ e[s + 40];
          for (let s = 0; s < 10; s += 2) {
            let a = (s + 8) % 10, d = (s + 2) % 10, f = r[d], P = r[d + 1], v = Ea(f, P, 1) ^ r[a], S = Ta(f, P, 1) ^ r[a + 1];
            for (let C = 0; C < 50; C += 10)
              e[s + C] ^= v, e[s + C + 1] ^= S;
          }
          let i = e[2], o = e[3];
          for (let s = 0; s < 24; s++) {
            let a = va[s], d = Ea(i, o, a), f = Ta(i, o, a), P = Pa[s];
            i = e[P], o = e[P + 1], e[P] = d, e[P + 1] = f;
          }
          for (let s = 0; s < 50; s += 10) {
            for (let a = 0; a < 10; a++)
              r[a] = e[s + a];
            for (let a = 0; a < 10; a++)
              e[s + a] ^= ~r[(a + 2) % 10] & r[(a + 4) % 10];
          }
          e[0] ^= kp[n], e[1] ^= Mp[n];
        }
        r.fill(0);
      }
      __name(Ca, "Ca");
      var Zt = /* @__PURE__ */ __name(class e extends Se.Hash {
        constructor(t, r, n, i = false, o = 24) {
          if (super(), this.blockLen = t, this.suffix = r, this.outputLen = n, this.enableXOF = i, this.rounds = o, this.pos = 0, this.posOut = 0, this.finished = false, this.destroyed = false, (0, bt.anumber)(n), 0 >= this.blockLen || this.blockLen >= 200)
            throw new Error("Sha3 supports only keccak-f1600 function");
          this.state = new Uint8Array(200), this.state32 = (0, Se.u32)(this.state);
        }
        keccak() {
          Se.isLE || (0, Se.byteSwap32)(this.state32), Ca(this.state32, this.rounds), Se.isLE || (0, Se.byteSwap32)(this.state32), this.posOut = 0, this.pos = 0;
        }
        update(t) {
          (0, bt.aexists)(this);
          let { blockLen: r, state: n } = this;
          t = (0, Se.toBytes)(t);
          let i = t.length;
          for (let o = 0; o < i; ) {
            let s = Math.min(r - this.pos, i - o);
            for (let a = 0; a < s; a++)
              n[this.pos++] ^= t[o++];
            this.pos === r && this.keccak();
          }
          return this;
        }
        finish() {
          if (this.finished)
            return;
          this.finished = true;
          let { state: t, suffix: r, pos: n, blockLen: i } = this;
          t[n] ^= r, (r & 128) !== 0 && n === i - 1 && this.keccak(), t[i - 1] ^= 128, this.keccak();
        }
        writeInto(t) {
          (0, bt.aexists)(this, false), (0, bt.abytes)(t), this.finish();
          let r = this.state, { blockLen: n } = this;
          for (let i = 0, o = t.length; i < o; ) {
            this.posOut >= n && this.keccak();
            let s = Math.min(n - this.posOut, o - i);
            t.set(r.subarray(this.posOut, this.posOut + s), i), this.posOut += s, i += s;
          }
          return t;
        }
        xofInto(t) {
          if (!this.enableXOF)
            throw new Error("XOF is not possible for this instance");
          return this.writeInto(t);
        }
        xof(t) {
          return (0, bt.anumber)(t), this.xofInto(new Uint8Array(t));
        }
        digestInto(t) {
          if ((0, bt.aoutput)(t, this), this.finished)
            throw new Error("digest() was already called");
          return this.writeInto(t), this.destroy(), t;
        }
        digest() {
          return this.digestInto(new Uint8Array(this.outputLen));
        }
        destroy() {
          this.destroyed = true, this.state.fill(0);
        }
        _cloneInto(t) {
          let { blockLen: r, suffix: n, outputLen: i, rounds: o, enableXOF: s } = this;
          return t || (t = new e(r, n, i, s, o)), t.state32.set(this.state32), t.pos = this.pos, t.posOut = this.posOut, t.finished = this.finished, t.rounds = o, t.suffix = n, t.outputLen = i, t.enableXOF = s, t.destroyed = this.destroyed, t;
        }
      }, "e");
      V.Keccak = Zt;
      var Le = /* @__PURE__ */ __name((e, t, r) => (0, Se.wrapConstructor)(() => new Zt(t, e, r)), "Le");
      V.sha3_224 = Le(6, 144, 224 / 8);
      V.sha3_256 = Le(6, 136, 256 / 8);
      V.sha3_384 = Le(6, 104, 384 / 8);
      V.sha3_512 = Le(6, 72, 512 / 8);
      V.keccak_224 = Le(1, 144, 224 / 8);
      V.keccak_256 = Le(1, 136, 256 / 8);
      V.keccak_384 = Le(1, 104, 384 / 8);
      V.keccak_512 = Le(1, 72, 512 / 8);
      var Sa = /* @__PURE__ */ __name((e, t, r) => (0, Se.wrapXOFConstructorWithOpts)((n = {}) => new Zt(t, e, n.dkLen === void 0 ? r : n.dkLen, true)), "Sa");
      V.shake128 = Sa(31, 168, 128 / 8);
      V.shake256 = Sa(31, 136, 256 / 8);
    });
    var _a = oe((_I, _e) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      var { sha3_512: Dp } = Ra(), Oa = 24, Yt = 32, li = /* @__PURE__ */ __name((e = 4, t = Math.random) => {
        let r = "";
        for (; r.length < e; )
          r = r + Math.floor(t() * 36).toString(36);
        return r;
      }, "li");
      function ka(e) {
        let t = 8n, r = 0n;
        for (let n of e.values()) {
          let i = BigInt(n);
          r = (r << t) + i;
        }
        return r;
      }
      __name(ka, "ka");
      var Ma = /* @__PURE__ */ __name((e = "") => ka(Dp(e)).toString(36).slice(1), "Ma"), Ia = Array.from({ length: 26 }, (e, t) => String.fromCharCode(t + 97)), Np = /* @__PURE__ */ __name((e) => Ia[Math.floor(e() * Ia.length)], "Np"), Da = /* @__PURE__ */ __name(({ globalObj: e = typeof globalThis < "u" ? globalThis : typeof window < "u" ? window : {}, random: t = Math.random } = {}) => {
        let r = Object.keys(e).toString(), n = r.length ? r + li(Yt, t) : li(Yt, t);
        return Ma(n).substring(0, Yt);
      }, "Da"), Na = /* @__PURE__ */ __name((e) => () => e++, "Na"), Lp = 476782367, La = /* @__PURE__ */ __name(({ random: e = Math.random, counter: t = Na(Math.floor(e() * Lp)), length: r = Oa, fingerprint: n = Da({ random: e }) } = {}) => function() {
        let o = Np(e), s = Date.now().toString(36), a = t().toString(36), d = li(r, e), f = `${s + d + a + n}`;
        return `${o + Ma(f).substring(1, r)}`;
      }, "La"), _p = La(), Fp = /* @__PURE__ */ __name((e, { minLength: t = 2, maxLength: r = Yt } = {}) => {
        let n = e.length, i = /^[0-9a-z]+$/;
        try {
          if (typeof e == "string" && n >= t && n <= r && i.test(e))
            return true;
        } finally {
        }
        return false;
      }, "Fp");
      _e.exports.getConstants = () => ({ defaultLength: Oa, bigLength: Yt });
      _e.exports.init = La;
      _e.exports.createId = _p;
      _e.exports.bufToBigInt = ka;
      _e.exports.createCounter = Na;
      _e.exports.createFingerprint = Da;
      _e.exports.isCuid = Fp;
    });
    var Fa = oe((BI, Xt) => {
      "use strict";
      l();
      u();
      c();
      p();
      m();
      var { createId: Up, init: $p, getConstants: qp, isCuid: Vp } = _a();
      Xt.exports.createId = Up;
      Xt.exports.init = $p;
      Xt.exports.getConstants = qp;
      Xt.exports.isCuid = Vp;
    });
    var id = {};
    Ye(id, { AnyNull: () => ee.AnyNull, DMMF: () => _t, DbNull: () => ee.DbNull, Debug: () => X, Decimal: () => tu.Decimal, Extensions: () => vn, JsonNull: () => ee.JsonNull, NullTypes: () => ee.NullTypes, ObjectEnumValue: () => ee.ObjectEnumValue, PrismaClientInitializationError: () => D.PrismaClientInitializationError, PrismaClientKnownRequestError: () => D.PrismaClientKnownRequestError, PrismaClientRustPanicError: () => D.PrismaClientRustPanicError, PrismaClientUnknownRequestError: () => D.PrismaClientUnknownRequestError, PrismaClientValidationError: () => D.PrismaClientValidationError, Public: () => An, Sql: () => Te.Sql, createParam: () => Yo, defineDmmfProperty: () => ns, deserializeJsonResponse: () => De, deserializeRawResult: () => hn, dmmfToRuntimeDataModel: () => to, empty: () => Te.empty, getPrismaClient: () => Yl, getRuntime: () => eu, isAnyNull: () => ee.isAnyNull, isDbNull: () => ee.isDbNull, isJsonNull: () => ee.isJsonNull, join: () => Te.join, makeStrictEnum: () => Xl, makeTypedQueryFactory: () => is, raw: () => Te.raw, serializeJsonQuery: () => _r, skip: () => Lr, sqltag: () => Te.sql, warnOnce: () => Ln });
    module.exports = $i(id);
    l();
    u();
    c();
    p();
    m();
    var vn = {};
    Ye(vn, { defineExtension: () => Zi, getExtensionContext: () => Yi });
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function Zi(e) {
      return typeof e == "function" ? e : (t) => t.$extends(e);
    }
    __name(Zi, "Zi");
    l();
    u();
    c();
    p();
    m();
    function Yi(e) {
      return e;
    }
    __name(Yi, "Yi");
    var An = {};
    Ye(An, { validator: () => Xi });
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function Xi(...e) {
      return (t) => t;
    }
    __name(Xi, "Xi");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var he = /* @__PURE__ */ __name(class {
      _map = /* @__PURE__ */ new Map();
      get(t) {
        return this._map.get(t)?.value;
      }
      set(t, r) {
        this._map.set(t, { value: r });
      }
      getOrCreate(t, r) {
        let n = this._map.get(t);
        if (n)
          return n.value;
        let i = r();
        return this.set(t, i), i;
      }
    }, "he");
    l();
    u();
    c();
    p();
    m();
    function Ie(e) {
      return e.substring(0, 1).toLowerCase() + e.substring(1);
    }
    __name(Ie, "Ie");
    l();
    u();
    c();
    p();
    m();
    function eo(e, t) {
      let r = {};
      for (let n of e) {
        let i = n[t];
        r[i] = n;
      }
      return r;
    }
    __name(eo, "eo");
    l();
    u();
    c();
    p();
    m();
    function St(e) {
      let t;
      return { get() {
        return t || (t = { value: e() }), t.value;
      } };
    }
    __name(St, "St");
    l();
    u();
    c();
    p();
    m();
    function to(e) {
      return { models: Cn(e.models), enums: Cn(e.enums), types: Cn(e.types) };
    }
    __name(to, "to");
    function Cn(e) {
      let t = {};
      for (let { name: r, ...n } of e)
        t[r] = n;
      return t;
    }
    __name(Cn, "Cn");
    var ke = require_dist();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var Sn;
    var ro;
    var no;
    var io;
    var oo = true;
    typeof g < "u" && ({ FORCE_COLOR: Sn, NODE_DISABLE_COLORS: ro, NO_COLOR: no, TERM: io } = g.env || {}, oo = g.stdout && g.stdout.isTTY);
    var bu = { enabled: !ro && no == null && io !== "dumb" && (Sn != null && Sn !== "0" || oo) };
    function U(e, t) {
      let r = new RegExp(`\\x1b\\[${t}m`, "g"), n = `\x1B[${e}m`, i = `\x1B[${t}m`;
      return function(o) {
        return !bu.enabled || o == null ? o : n + (~("" + o).indexOf(i) ? o.replace(r, i + n) : o) + i;
      };
    }
    __name(U, "U");
    var Jf = U(0, 0);
    var fr = U(1, 22);
    var gr = U(2, 22);
    var Wf = U(3, 23);
    var yr = U(4, 24);
    var Gf = U(7, 27);
    var Kf = U(8, 28);
    var zf = U(9, 29);
    var Zf = U(30, 39);
    var tt = U(31, 39);
    var so = U(32, 39);
    var ao = U(33, 39);
    var lo = U(34, 39);
    var Yf = U(35, 39);
    var uo = U(36, 39);
    var Xf = U(37, 39);
    var co = U(90, 39);
    var eg = U(90, 39);
    var tg = U(40, 49);
    var rg = U(41, 49);
    var ng = U(42, 49);
    var ig = U(43, 49);
    var og = U(44, 49);
    var sg = U(45, 49);
    var ag = U(46, 49);
    var lg = U(47, 49);
    l();
    u();
    c();
    p();
    m();
    var xu = 100;
    var po = ["green", "yellow", "blue", "magenta", "cyan", "red"];
    var Rt = [];
    var mo = Date.now();
    var Eu = 0;
    var Rn = typeof g < "u" ? g.env : {};
    globalThis.DEBUG ??= Rn.DEBUG ?? "";
    globalThis.DEBUG_COLORS ??= Rn.DEBUG_COLORS ? Rn.DEBUG_COLORS === "true" : true;
    var It = { enable(e) {
      typeof e == "string" && (globalThis.DEBUG = e);
    }, disable() {
      let e = globalThis.DEBUG;
      return globalThis.DEBUG = "", e;
    }, enabled(e) {
      let t = globalThis.DEBUG.split(",").map((i) => i.replace(/[.+?^${}()|[\]\\]/g, "\\$&")), r = t.some((i) => i === "" || i[0] === "-" ? false : e.match(RegExp(i.split("*").join(".*") + "$"))), n = t.some((i) => i === "" || i[0] !== "-" ? false : e.match(RegExp(i.slice(1).split("*").join(".*") + "$")));
      return r && !n;
    }, log: (...e) => {
      let [t, r, ...n] = e;
      (console.warn ?? console.log)(`${t} ${r}`, ...n);
    }, formatters: {} };
    function Tu(e) {
      let t = { color: po[Eu++ % po.length], enabled: It.enabled(e), namespace: e, log: It.log, extend: () => {
      } }, r = /* @__PURE__ */ __name((...n) => {
        let { enabled: i, namespace: o, color: s, log: a } = t;
        if (n.length !== 0 && Rt.push([o, ...n]), Rt.length > xu && Rt.shift(), It.enabled(o) || i) {
          let d = n.map((P) => typeof P == "string" ? P : Pu(P)), f = `+${Date.now() - mo}ms`;
          mo = Date.now(), a(o, ...d, f);
        }
      }, "r");
      return new Proxy(r, { get: (n, i) => t[i], set: (n, i, o) => t[i] = o });
    }
    __name(Tu, "Tu");
    var X = new Proxy(Tu, { get: (e, t) => It[t], set: (e, t, r) => It[t] = r });
    function Pu(e, t = 2) {
      let r = /* @__PURE__ */ new Set();
      return JSON.stringify(e, (n, i) => {
        if (typeof i == "object" && i !== null) {
          if (r.has(i))
            return "[Circular *]";
          r.add(i);
        } else if (typeof i == "bigint")
          return i.toString();
        return i;
      }, t);
    }
    __name(Pu, "Pu");
    function fo(e = 7500) {
      let t = Rt.map(([r, ...n]) => `${r} ${n.map((i) => typeof i == "string" ? i : JSON.stringify(i)).join(" ")}`).join(`
`);
      return t.length < e ? t : t.slice(-e);
    }
    __name(fo, "fo");
    function go() {
      Rt.length = 0;
    }
    __name(go, "go");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var xo = "prisma+postgres";
    var xr = `${xo}:`;
    function Eo(e) {
      return e?.toString().startsWith(`${xr}//`) ?? false;
    }
    __name(Eo, "Eo");
    function On(e) {
      if (!Eo(e))
        return false;
      let { host: t } = new URL(e);
      return t.includes("localhost") || t.includes("127.0.0.1") || t.includes("[::1]");
    }
    __name(On, "On");
    var Dt = {};
    Ye(Dt, { error: () => Su, info: () => Cu, log: () => Au, query: () => Ru, should: () => vo, tags: () => Mt, warn: () => kn });
    l();
    u();
    c();
    p();
    m();
    var Mt = { error: tt("prisma:error"), warn: ao("prisma:warn"), info: uo("prisma:info"), query: lo("prisma:query") };
    var vo = { warn: () => !g.env.PRISMA_DISABLE_WARNINGS };
    function Au(...e) {
      console.log(...e);
    }
    __name(Au, "Au");
    function kn(e, ...t) {
      vo.warn() && console.warn(`${Mt.warn} ${e}`, ...t);
    }
    __name(kn, "kn");
    function Cu(e, ...t) {
      console.info(`${Mt.info} ${e}`, ...t);
    }
    __name(Cu, "Cu");
    function Su(e, ...t) {
      console.error(`${Mt.error} ${e}`, ...t);
    }
    __name(Su, "Su");
    function Ru(e, ...t) {
      console.log(`${Mt.query} ${e}`, ...t);
    }
    __name(Ru, "Ru");
    l();
    u();
    c();
    p();
    m();
    function Ae(e, t) {
      throw new Error(t);
    }
    __name(Ae, "Ae");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function Mn({ onlyFirst: e = false } = {}) {
      let r = ["[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?(?:\\u0007|\\u001B\\u005C|\\u009C))", "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]))"].join("|");
      return new RegExp(r, e ? void 0 : "g");
    }
    __name(Mn, "Mn");
    var Iu = Mn();
    function nt(e) {
      if (typeof e != "string")
        throw new TypeError(`Expected a \`string\`, got \`${typeof e}\``);
      return e.replace(Iu, "");
    }
    __name(nt, "nt");
    l();
    u();
    c();
    p();
    m();
    function Dn(e, t) {
      return Object.prototype.hasOwnProperty.call(e, t);
    }
    __name(Dn, "Dn");
    l();
    u();
    c();
    p();
    m();
    function Tr(e, t) {
      let r = {};
      for (let n of Object.keys(e))
        r[n] = t(e[n], n);
      return r;
    }
    __name(Tr, "Tr");
    l();
    u();
    c();
    p();
    m();
    function Nn(e, t) {
      if (e.length === 0)
        return;
      let r = e[0];
      for (let n = 1; n < e.length; n++)
        t(r, e[n]) < 0 && (r = e[n]);
      return r;
    }
    __name(Nn, "Nn");
    l();
    u();
    c();
    p();
    m();
    function Nt(e, t) {
      Object.defineProperty(e, "name", { value: t, configurable: true });
    }
    __name(Nt, "Nt");
    l();
    u();
    c();
    p();
    m();
    var Co = /* @__PURE__ */ new Set();
    var Ln = /* @__PURE__ */ __name((e, t, ...r) => {
      Co.has(e) || (Co.add(e), kn(t, ...r));
    }, "Ln");
    l();
    u();
    c();
    p();
    m();
    function it(e) {
      return e instanceof Date || Object.prototype.toString.call(e) === "[object Date]";
    }
    __name(it, "it");
    function Pr(e) {
      return e.toString() !== "Invalid Date";
    }
    __name(Pr, "Pr");
    l();
    u();
    c();
    p();
    m();
    var So = require_dist();
    function ot(e) {
      return So.Decimal.isDecimal(e) ? true : e !== null && typeof e == "object" && typeof e.s == "number" && typeof e.e == "number" && typeof e.toFixed == "function" && Array.isArray(e.d);
    }
    __name(ot, "ot");
    l();
    u();
    c();
    p();
    m();
    var Jo = require_dist();
    l();
    u();
    c();
    p();
    m();
    var _t = {};
    Ye(_t, { ModelAction: () => Lt, datamodelEnumToSchemaEnum: () => Ou, datamodelSchemaEnumToSchemaEnum: () => ku });
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function Ou(e) {
      return { name: e.name, data: e.values.map((t) => ({ key: t.name, value: t.dbName ?? t.name })) };
    }
    __name(Ou, "Ou");
    function ku(e) {
      return { name: e.name, data: e.values.map((t) => ({ key: t, value: t })) };
    }
    __name(ku, "ku");
    l();
    u();
    c();
    p();
    m();
    var Lt = ((F) => (F.findUnique = "findUnique", F.findUniqueOrThrow = "findUniqueOrThrow", F.findFirst = "findFirst", F.findFirstOrThrow = "findFirstOrThrow", F.findMany = "findMany", F.create = "create", F.createMany = "createMany", F.createManyAndReturn = "createManyAndReturn", F.update = "update", F.updateMany = "updateMany", F.updateManyAndReturn = "updateManyAndReturn", F.upsert = "upsert", F.delete = "delete", F.deleteMany = "deleteMany", F.groupBy = "groupBy", F.count = "count", F.aggregate = "aggregate", F.findRaw = "findRaw", F.aggregateRaw = "aggregateRaw", F))(Lt || {});
    var Mu = Ue(Po());
    var Du = { red: tt, gray: co, dim: gr, bold: fr, underline: yr, highlightSource: (e) => e.highlight() };
    var Nu = { red: (e) => e, gray: (e) => e, dim: (e) => e, bold: (e) => e, underline: (e) => e, highlightSource: (e) => e };
    function Lu({ message: e, originalMethod: t, isPanic: r, callArguments: n }) {
      return { functionName: `prisma.${t}()`, message: e, isPanic: r ?? false, callArguments: n };
    }
    __name(Lu, "Lu");
    function _u({ functionName: e, location: t, message: r, isPanic: n, contextLines: i, callArguments: o }, s) {
      let a = [""], d = t ? " in" : ":";
      if (n ? (a.push(s.red(`Oops, an unknown error occurred! This is ${s.bold("on us")}, you did nothing wrong.`)), a.push(s.red(`It occurred in the ${s.bold(`\`${e}\``)} invocation${d}`))) : a.push(s.red(`Invalid ${s.bold(`\`${e}\``)} invocation${d}`)), t && a.push(s.underline(Fu(t))), i) {
        a.push("");
        let f = [i.toString()];
        o && (f.push(o), f.push(s.dim(")"))), a.push(f.join("")), o && a.push("");
      } else
        a.push(""), o && a.push(o), a.push("");
      return a.push(r), a.join(`
`);
    }
    __name(_u, "_u");
    function Fu(e) {
      let t = [e.fileName];
      return e.lineNumber && t.push(String(e.lineNumber)), e.columnNumber && t.push(String(e.columnNumber)), t.join(":");
    }
    __name(Fu, "Fu");
    function vr(e) {
      let t = e.showColors ? Du : Nu, r;
      return typeof $getTemplateParameters < "u" ? r = $getTemplateParameters(e, t) : r = Lu(e), _u(r, t);
    }
    __name(vr, "vr");
    l();
    u();
    c();
    p();
    m();
    var _o = Ue(_n());
    l();
    u();
    c();
    p();
    m();
    function ko(e, t, r) {
      let n = Mo(e), i = Uu(n), o = qu(i);
      o ? Ar(o, t, r) : t.addErrorMessage(() => "Unknown error");
    }
    __name(ko, "ko");
    function Mo(e) {
      return e.errors.flatMap((t) => t.kind === "Union" ? Mo(t) : [t]);
    }
    __name(Mo, "Mo");
    function Uu(e) {
      let t = /* @__PURE__ */ new Map(), r = [];
      for (let n of e) {
        if (n.kind !== "InvalidArgumentType") {
          r.push(n);
          continue;
        }
        let i = `${n.selectionPath.join(".")}:${n.argumentPath.join(".")}`, o = t.get(i);
        o ? t.set(i, { ...n, argument: { ...n.argument, typeNames: $u(o.argument.typeNames, n.argument.typeNames) } }) : t.set(i, n);
      }
      return r.push(...t.values()), r;
    }
    __name(Uu, "Uu");
    function $u(e, t) {
      return [...new Set(e.concat(t))];
    }
    __name($u, "$u");
    function qu(e) {
      return Nn(e, (t, r) => {
        let n = Io(t), i = Io(r);
        return n !== i ? n - i : Oo(t) - Oo(r);
      });
    }
    __name(qu, "qu");
    function Io(e) {
      let t = 0;
      return Array.isArray(e.selectionPath) && (t += e.selectionPath.length), Array.isArray(e.argumentPath) && (t += e.argumentPath.length), t;
    }
    __name(Io, "Io");
    function Oo(e) {
      switch (e.kind) {
        case "InvalidArgumentValue":
        case "ValueTooLarge":
          return 20;
        case "InvalidArgumentType":
          return 10;
        case "RequiredArgumentMissing":
          return -10;
        default:
          return 0;
      }
    }
    __name(Oo, "Oo");
    l();
    u();
    c();
    p();
    m();
    var ae = /* @__PURE__ */ __name(class {
      constructor(t, r) {
        this.name = t;
        this.value = r;
      }
      isRequired = false;
      makeRequired() {
        return this.isRequired = true, this;
      }
      write(t) {
        let { colors: { green: r } } = t.context;
        t.addMarginSymbol(r(this.isRequired ? "+" : "?")), t.write(r(this.name)), this.isRequired || t.write(r("?")), t.write(r(": ")), typeof this.value == "string" ? t.write(r(this.value)) : t.write(this.value);
      }
    }, "ae");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    No();
    l();
    u();
    c();
    p();
    m();
    var st = /* @__PURE__ */ __name(class {
      constructor(t = 0, r) {
        this.context = r;
        this.currentIndent = t;
      }
      lines = [];
      currentLine = "";
      currentIndent = 0;
      marginSymbol;
      afterNextNewLineCallback;
      write(t) {
        return typeof t == "string" ? this.currentLine += t : t.write(this), this;
      }
      writeJoined(t, r, n = (i, o) => o.write(i)) {
        let i = r.length - 1;
        for (let o = 0; o < r.length; o++)
          n(r[o], this), o !== i && this.write(t);
        return this;
      }
      writeLine(t) {
        return this.write(t).newLine();
      }
      newLine() {
        this.lines.push(this.indentedCurrentLine()), this.currentLine = "", this.marginSymbol = void 0;
        let t = this.afterNextNewLineCallback;
        return this.afterNextNewLineCallback = void 0, t?.(), this;
      }
      withIndent(t) {
        return this.indent(), t(this), this.unindent(), this;
      }
      afterNextNewline(t) {
        return this.afterNextNewLineCallback = t, this;
      }
      indent() {
        return this.currentIndent++, this;
      }
      unindent() {
        return this.currentIndent > 0 && this.currentIndent--, this;
      }
      addMarginSymbol(t) {
        return this.marginSymbol = t, this;
      }
      toString() {
        return this.lines.concat(this.indentedCurrentLine()).join(`
`);
      }
      getCurrentLineLength() {
        return this.currentLine.length;
      }
      indentedCurrentLine() {
        let t = this.currentLine.padStart(this.currentLine.length + 2 * this.currentIndent);
        return this.marginSymbol ? this.marginSymbol + t.slice(1) : t;
      }
    }, "st");
    Do();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var Cr = /* @__PURE__ */ __name(class {
      constructor(t) {
        this.value = t;
      }
      write(t) {
        t.write(this.value);
      }
      markAsError() {
        this.value.markAsError();
      }
    }, "Cr");
    l();
    u();
    c();
    p();
    m();
    var Sr = /* @__PURE__ */ __name((e) => e, "Sr");
    var Rr = { bold: Sr, red: Sr, green: Sr, dim: Sr, enabled: false };
    var Lo = { bold: fr, red: tt, green: so, dim: gr, enabled: true };
    var at = { write(e) {
      e.writeLine(",");
    } };
    l();
    u();
    c();
    p();
    m();
    var we = /* @__PURE__ */ __name(class {
      constructor(t) {
        this.contents = t;
      }
      isUnderlined = false;
      color = (t) => t;
      underline() {
        return this.isUnderlined = true, this;
      }
      setColor(t) {
        return this.color = t, this;
      }
      write(t) {
        let r = t.getCurrentLineLength();
        t.write(this.color(this.contents)), this.isUnderlined && t.afterNextNewline(() => {
          t.write(" ".repeat(r)).writeLine(this.color("~".repeat(this.contents.length)));
        });
      }
    }, "we");
    l();
    u();
    c();
    p();
    m();
    var Oe = /* @__PURE__ */ __name(class {
      hasError = false;
      markAsError() {
        return this.hasError = true, this;
      }
    }, "Oe");
    var lt = /* @__PURE__ */ __name(class extends Oe {
      items = [];
      addItem(t) {
        return this.items.push(new Cr(t)), this;
      }
      getField(t) {
        return this.items[t];
      }
      getPrintWidth() {
        return this.items.length === 0 ? 2 : Math.max(...this.items.map((r) => r.value.getPrintWidth())) + 2;
      }
      write(t) {
        if (this.items.length === 0) {
          this.writeEmpty(t);
          return;
        }
        this.writeWithItems(t);
      }
      writeEmpty(t) {
        let r = new we("[]");
        this.hasError && r.setColor(t.context.colors.red).underline(), t.write(r);
      }
      writeWithItems(t) {
        let { colors: r } = t.context;
        t.writeLine("[").withIndent(() => t.writeJoined(at, this.items).newLine()).write("]"), this.hasError && t.afterNextNewline(() => {
          t.writeLine(r.red("~".repeat(this.getPrintWidth())));
        });
      }
      asObject() {
      }
    }, "lt");
    var ut = /* @__PURE__ */ __name(class e extends Oe {
      fields = {};
      suggestions = [];
      addField(t) {
        this.fields[t.name] = t;
      }
      addSuggestion(t) {
        this.suggestions.push(t);
      }
      getField(t) {
        return this.fields[t];
      }
      getDeepField(t) {
        let [r, ...n] = t, i = this.getField(r);
        if (!i)
          return;
        let o = i;
        for (let s of n) {
          let a;
          if (o.value instanceof e ? a = o.value.getField(s) : o.value instanceof lt && (a = o.value.getField(Number(s))), !a)
            return;
          o = a;
        }
        return o;
      }
      getDeepFieldValue(t) {
        return t.length === 0 ? this : this.getDeepField(t)?.value;
      }
      hasField(t) {
        return !!this.getField(t);
      }
      removeAllFields() {
        this.fields = {};
      }
      removeField(t) {
        delete this.fields[t];
      }
      getFields() {
        return this.fields;
      }
      isEmpty() {
        return Object.keys(this.fields).length === 0;
      }
      getFieldValue(t) {
        return this.getField(t)?.value;
      }
      getDeepSubSelectionValue(t) {
        let r = this;
        for (let n of t) {
          if (!(r instanceof e))
            return;
          let i = r.getSubSelectionValue(n);
          if (!i)
            return;
          r = i;
        }
        return r;
      }
      getDeepSelectionParent(t) {
        let r = this.getSelectionParent();
        if (!r)
          return;
        let n = r;
        for (let i of t) {
          let o = n.value.getFieldValue(i);
          if (!o || !(o instanceof e))
            return;
          let s = o.getSelectionParent();
          if (!s)
            return;
          n = s;
        }
        return n;
      }
      getSelectionParent() {
        let t = this.getField("select")?.value.asObject();
        if (t)
          return { kind: "select", value: t };
        let r = this.getField("include")?.value.asObject();
        if (r)
          return { kind: "include", value: r };
      }
      getSubSelectionValue(t) {
        return this.getSelectionParent()?.value.fields[t].value;
      }
      getPrintWidth() {
        let t = Object.values(this.fields);
        return t.length == 0 ? 2 : Math.max(...t.map((n) => n.getPrintWidth())) + 2;
      }
      write(t) {
        let r = Object.values(this.fields);
        if (r.length === 0 && this.suggestions.length === 0) {
          this.writeEmpty(t);
          return;
        }
        this.writeWithContents(t, r);
      }
      asObject() {
        return this;
      }
      writeEmpty(t) {
        let r = new we("{}");
        this.hasError && r.setColor(t.context.colors.red).underline(), t.write(r);
      }
      writeWithContents(t, r) {
        t.writeLine("{").withIndent(() => {
          t.writeJoined(at, [...r, ...this.suggestions]).newLine();
        }), t.write("}"), this.hasError && t.afterNextNewline(() => {
          t.writeLine(t.context.colors.red("~".repeat(this.getPrintWidth())));
        });
      }
    }, "e");
    l();
    u();
    c();
    p();
    m();
    var K = /* @__PURE__ */ __name(class extends Oe {
      constructor(r) {
        super();
        this.text = r;
      }
      getPrintWidth() {
        return this.text.length;
      }
      write(r) {
        let n = new we(this.text);
        this.hasError && n.underline().setColor(r.context.colors.red), r.write(n);
      }
      asObject() {
      }
    }, "K");
    l();
    u();
    c();
    p();
    m();
    var Ft = /* @__PURE__ */ __name(class {
      fields = [];
      addField(t, r) {
        return this.fields.push({ write(n) {
          let { green: i, dim: o } = n.context.colors;
          n.write(i(o(`${t}: ${r}`))).addMarginSymbol(i(o("+")));
        } }), this;
      }
      write(t) {
        let { colors: { green: r } } = t.context;
        t.writeLine(r("{")).withIndent(() => {
          t.writeJoined(at, this.fields).newLine();
        }).write(r("}")).addMarginSymbol(r("+"));
      }
    }, "Ft");
    function Ar(e, t, r) {
      switch (e.kind) {
        case "MutuallyExclusiveFields":
          Vu(e, t);
          break;
        case "IncludeOnScalar":
          Bu(e, t);
          break;
        case "EmptySelection":
          ju(e, t, r);
          break;
        case "UnknownSelectionField":
          Wu(e, t);
          break;
        case "InvalidSelectionValue":
          Gu(e, t);
          break;
        case "UnknownArgument":
          Ku(e, t);
          break;
        case "UnknownInputField":
          zu(e, t);
          break;
        case "RequiredArgumentMissing":
          Zu(e, t);
          break;
        case "InvalidArgumentType":
          Yu(e, t);
          break;
        case "InvalidArgumentValue":
          Xu(e, t);
          break;
        case "ValueTooLarge":
          ec(e, t);
          break;
        case "SomeFieldsMissing":
          tc(e, t);
          break;
        case "TooManyFieldsGiven":
          rc(e, t);
          break;
        case "Union":
          ko(e, t, r);
          break;
        default:
          throw new Error("not implemented: " + e.kind);
      }
    }
    __name(Ar, "Ar");
    function Vu(e, t) {
      let r = t.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      r && (r.getField(e.firstField)?.markAsError(), r.getField(e.secondField)?.markAsError()), t.addErrorMessage((n) => `Please ${n.bold("either")} use ${n.green(`\`${e.firstField}\``)} or ${n.green(`\`${e.secondField}\``)}, but ${n.red("not both")} at the same time.`);
    }
    __name(Vu, "Vu");
    function Bu(e, t) {
      let [r, n] = ct(e.selectionPath), i = e.outputType, o = t.arguments.getDeepSelectionParent(r)?.value;
      if (o && (o.getField(n)?.markAsError(), i))
        for (let s of i.fields)
          s.isRelation && o.addSuggestion(new ae(s.name, "true"));
      t.addErrorMessage((s) => {
        let a = `Invalid scalar field ${s.red(`\`${n}\``)} for ${s.bold("include")} statement`;
        return i ? a += ` on model ${s.bold(i.name)}. ${Ut(s)}` : a += ".", a += `
Note that ${s.bold("include")} statements only accept relation fields.`, a;
      });
    }
    __name(Bu, "Bu");
    function ju(e, t, r) {
      let n = t.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      if (n) {
        let i = n.getField("omit")?.value.asObject();
        if (i) {
          Qu(e, t, i);
          return;
        }
        if (n.hasField("select")) {
          Hu(e, t);
          return;
        }
      }
      if (r?.[Ie(e.outputType.name)]) {
        Ju(e, t);
        return;
      }
      t.addErrorMessage(() => `Unknown field at "${e.selectionPath.join(".")} selection"`);
    }
    __name(ju, "ju");
    function Qu(e, t, r) {
      r.removeAllFields();
      for (let n of e.outputType.fields)
        r.addSuggestion(new ae(n.name, "false"));
      t.addErrorMessage((n) => `The ${n.red("omit")} statement includes every field of the model ${n.bold(e.outputType.name)}. At least one field must be included in the result`);
    }
    __name(Qu, "Qu");
    function Hu(e, t) {
      let r = e.outputType, n = t.arguments.getDeepSelectionParent(e.selectionPath)?.value, i = n?.isEmpty() ?? false;
      n && (n.removeAllFields(), $o(n, r)), t.addErrorMessage((o) => i ? `The ${o.red("`select`")} statement for type ${o.bold(r.name)} must not be empty. ${Ut(o)}` : `The ${o.red("`select`")} statement for type ${o.bold(r.name)} needs ${o.bold("at least one truthy value")}.`);
    }
    __name(Hu, "Hu");
    function Ju(e, t) {
      let r = new Ft();
      for (let i of e.outputType.fields)
        i.isRelation || r.addField(i.name, "false");
      let n = new ae("omit", r).makeRequired();
      if (e.selectionPath.length === 0)
        t.arguments.addSuggestion(n);
      else {
        let [i, o] = ct(e.selectionPath), a = t.arguments.getDeepSelectionParent(i)?.value.asObject()?.getField(o);
        if (a) {
          let d = a?.value.asObject() ?? new ut();
          d.addSuggestion(n), a.value = d;
        }
      }
      t.addErrorMessage((i) => `The global ${i.red("omit")} configuration excludes every field of the model ${i.bold(e.outputType.name)}. At least one field must be included in the result`);
    }
    __name(Ju, "Ju");
    function Wu(e, t) {
      let r = qo(e.selectionPath, t);
      if (r.parentKind !== "unknown") {
        r.field.markAsError();
        let n = r.parent;
        switch (r.parentKind) {
          case "select":
            $o(n, e.outputType);
            break;
          case "include":
            nc(n, e.outputType);
            break;
          case "omit":
            ic(n, e.outputType);
            break;
        }
      }
      t.addErrorMessage((n) => {
        let i = [`Unknown field ${n.red(`\`${r.fieldName}\``)}`];
        return r.parentKind !== "unknown" && i.push(`for ${n.bold(r.parentKind)} statement`), i.push(`on model ${n.bold(`\`${e.outputType.name}\``)}.`), i.push(Ut(n)), i.join(" ");
      });
    }
    __name(Wu, "Wu");
    function Gu(e, t) {
      let r = qo(e.selectionPath, t);
      r.parentKind !== "unknown" && r.field.value.markAsError(), t.addErrorMessage((n) => `Invalid value for selection field \`${n.red(r.fieldName)}\`: ${e.underlyingError}`);
    }
    __name(Gu, "Gu");
    function Ku(e, t) {
      let r = e.argumentPath[0], n = t.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      n && (n.getField(r)?.markAsError(), oc(n, e.arguments)), t.addErrorMessage((i) => Fo(i, r, e.arguments.map((o) => o.name)));
    }
    __name(Ku, "Ku");
    function zu(e, t) {
      let [r, n] = ct(e.argumentPath), i = t.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      if (i) {
        i.getDeepField(e.argumentPath)?.markAsError();
        let o = i.getDeepFieldValue(r)?.asObject();
        o && Vo(o, e.inputType);
      }
      t.addErrorMessage((o) => Fo(o, n, e.inputType.fields.map((s) => s.name)));
    }
    __name(zu, "zu");
    function Fo(e, t, r) {
      let n = [`Unknown argument \`${e.red(t)}\`.`], i = ac(t, r);
      return i && n.push(`Did you mean \`${e.green(i)}\`?`), r.length > 0 && n.push(Ut(e)), n.join(" ");
    }
    __name(Fo, "Fo");
    function Zu(e, t) {
      let r;
      t.addErrorMessage((d) => r?.value instanceof K && r.value.text === "null" ? `Argument \`${d.green(o)}\` must not be ${d.red("null")}.` : `Argument \`${d.green(o)}\` is missing.`);
      let n = t.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      if (!n)
        return;
      let [i, o] = ct(e.argumentPath), s = new Ft(), a = n.getDeepFieldValue(i)?.asObject();
      if (a) {
        if (r = a.getField(o), r && a.removeField(o), e.inputTypes.length === 1 && e.inputTypes[0].kind === "object") {
          for (let d of e.inputTypes[0].fields)
            s.addField(d.name, d.typeNames.join(" | "));
          a.addSuggestion(new ae(o, s).makeRequired());
        } else {
          let d = e.inputTypes.map(Uo).join(" | ");
          a.addSuggestion(new ae(o, d).makeRequired());
        }
        if (e.dependentArgumentPath) {
          n.getDeepField(e.dependentArgumentPath)?.markAsError();
          let [, d] = ct(e.dependentArgumentPath);
          t.addErrorMessage((f) => `Argument \`${f.green(o)}\` is required because argument \`${f.green(d)}\` was provided.`);
        }
      }
    }
    __name(Zu, "Zu");
    function Uo(e) {
      return e.kind === "list" ? `${Uo(e.elementType)}[]` : e.name;
    }
    __name(Uo, "Uo");
    function Yu(e, t) {
      let r = e.argument.name, n = t.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      n && n.getDeepFieldValue(e.argumentPath)?.markAsError(), t.addErrorMessage((i) => {
        let o = Ir("or", e.argument.typeNames.map((s) => i.green(s)));
        return `Argument \`${i.bold(r)}\`: Invalid value provided. Expected ${o}, provided ${i.red(e.inferredType)}.`;
      });
    }
    __name(Yu, "Yu");
    function Xu(e, t) {
      let r = e.argument.name, n = t.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      n && n.getDeepFieldValue(e.argumentPath)?.markAsError(), t.addErrorMessage((i) => {
        let o = [`Invalid value for argument \`${i.bold(r)}\``];
        if (e.underlyingError && o.push(`: ${e.underlyingError}`), o.push("."), e.argument.typeNames.length > 0) {
          let s = Ir("or", e.argument.typeNames.map((a) => i.green(a)));
          o.push(` Expected ${s}.`);
        }
        return o.join("");
      });
    }
    __name(Xu, "Xu");
    function ec(e, t) {
      let r = e.argument.name, n = t.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject(), i;
      if (n) {
        let s = n.getDeepField(e.argumentPath)?.value;
        s?.markAsError(), s instanceof K && (i = s.text);
      }
      t.addErrorMessage((o) => {
        let s = ["Unable to fit value"];
        return i && s.push(o.red(i)), s.push(`into a 64-bit signed integer for field \`${o.bold(r)}\``), s.join(" ");
      });
    }
    __name(ec, "ec");
    function tc(e, t) {
      let r = e.argumentPath[e.argumentPath.length - 1], n = t.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject();
      if (n) {
        let i = n.getDeepFieldValue(e.argumentPath)?.asObject();
        i && Vo(i, e.inputType);
      }
      t.addErrorMessage((i) => {
        let o = [`Argument \`${i.bold(r)}\` of type ${i.bold(e.inputType.name)} needs`];
        return e.constraints.minFieldCount === 1 ? e.constraints.requiredFields ? o.push(`${i.green("at least one of")} ${Ir("or", e.constraints.requiredFields.map((s) => `\`${i.bold(s)}\``))} arguments.`) : o.push(`${i.green("at least one")} argument.`) : o.push(`${i.green(`at least ${e.constraints.minFieldCount}`)} arguments.`), o.push(Ut(i)), o.join(" ");
      });
    }
    __name(tc, "tc");
    function rc(e, t) {
      let r = e.argumentPath[e.argumentPath.length - 1], n = t.arguments.getDeepSubSelectionValue(e.selectionPath)?.asObject(), i = [];
      if (n) {
        let o = n.getDeepFieldValue(e.argumentPath)?.asObject();
        o && (o.markAsError(), i = Object.keys(o.getFields()));
      }
      t.addErrorMessage((o) => {
        let s = [`Argument \`${o.bold(r)}\` of type ${o.bold(e.inputType.name)} needs`];
        return e.constraints.minFieldCount === 1 && e.constraints.maxFieldCount == 1 ? s.push(`${o.green("exactly one")} argument,`) : e.constraints.maxFieldCount == 1 ? s.push(`${o.green("at most one")} argument,`) : s.push(`${o.green(`at most ${e.constraints.maxFieldCount}`)} arguments,`), s.push(`but you provided ${Ir("and", i.map((a) => o.red(a)))}. Please choose`), e.constraints.maxFieldCount === 1 ? s.push("one.") : s.push(`${e.constraints.maxFieldCount}.`), s.join(" ");
      });
    }
    __name(rc, "rc");
    function $o(e, t) {
      for (let r of t.fields)
        e.hasField(r.name) || e.addSuggestion(new ae(r.name, "true"));
    }
    __name($o, "$o");
    function nc(e, t) {
      for (let r of t.fields)
        r.isRelation && !e.hasField(r.name) && e.addSuggestion(new ae(r.name, "true"));
    }
    __name(nc, "nc");
    function ic(e, t) {
      for (let r of t.fields)
        !e.hasField(r.name) && !r.isRelation && e.addSuggestion(new ae(r.name, "true"));
    }
    __name(ic, "ic");
    function oc(e, t) {
      for (let r of t)
        e.hasField(r.name) || e.addSuggestion(new ae(r.name, r.typeNames.join(" | ")));
    }
    __name(oc, "oc");
    function qo(e, t) {
      let [r, n] = ct(e), i = t.arguments.getDeepSubSelectionValue(r)?.asObject();
      if (!i)
        return { parentKind: "unknown", fieldName: n };
      let o = i.getFieldValue("select")?.asObject(), s = i.getFieldValue("include")?.asObject(), a = i.getFieldValue("omit")?.asObject(), d = o?.getField(n);
      return o && d ? { parentKind: "select", parent: o, field: d, fieldName: n } : (d = s?.getField(n), s && d ? { parentKind: "include", field: d, parent: s, fieldName: n } : (d = a?.getField(n), a && d ? { parentKind: "omit", field: d, parent: a, fieldName: n } : { parentKind: "unknown", fieldName: n }));
    }
    __name(qo, "qo");
    function Vo(e, t) {
      if (t.kind === "object")
        for (let r of t.fields)
          e.hasField(r.name) || e.addSuggestion(new ae(r.name, r.typeNames.join(" | ")));
    }
    __name(Vo, "Vo");
    function ct(e) {
      let t = [...e], r = t.pop();
      if (!r)
        throw new Error("unexpected empty path");
      return [t, r];
    }
    __name(ct, "ct");
    function Ut({ green: e, enabled: t }) {
      return "Available options are " + (t ? `listed in ${e("green")}` : "marked with ?") + ".";
    }
    __name(Ut, "Ut");
    function Ir(e, t) {
      if (t.length === 1)
        return t[0];
      let r = [...t], n = r.pop();
      return `${r.join(", ")} ${e} ${n}`;
    }
    __name(Ir, "Ir");
    var sc = 3;
    function ac(e, t) {
      let r = 1 / 0, n;
      for (let i of t) {
        let o = (0, _o.default)(e, i);
        o > sc || o < r && (r = o, n = i);
      }
      return n;
    }
    __name(ac, "ac");
    l();
    u();
    c();
    p();
    m();
    var jo = require_dist();
    l();
    u();
    c();
    p();
    m();
    var $t = /* @__PURE__ */ __name(class {
      modelName;
      name;
      typeName;
      isList;
      isEnum;
      constructor(t, r, n, i, o) {
        this.modelName = t, this.name = r, this.typeName = n, this.isList = i, this.isEnum = o;
      }
      _toGraphQLInputType() {
        let t = this.isList ? "List" : "", r = this.isEnum ? "Enum" : "";
        return `${t}${r}${this.typeName}FieldRefInput<${this.modelName}>`;
      }
    }, "$t");
    function pt(e) {
      return e instanceof $t;
    }
    __name(pt, "pt");
    l();
    u();
    c();
    p();
    m();
    var Bo = ": ";
    var Or = /* @__PURE__ */ __name(class {
      constructor(t, r) {
        this.name = t;
        this.value = r;
      }
      hasError = false;
      markAsError() {
        this.hasError = true;
      }
      getPrintWidth() {
        return this.name.length + this.value.getPrintWidth() + Bo.length;
      }
      write(t) {
        let r = new we(this.name);
        this.hasError && r.underline().setColor(t.context.colors.red), t.write(r).write(Bo).write(this.value);
      }
    }, "Or");
    var Un = /* @__PURE__ */ __name(class {
      arguments;
      errorMessages = [];
      constructor(t) {
        this.arguments = t;
      }
      write(t) {
        t.write(this.arguments);
      }
      addErrorMessage(t) {
        this.errorMessages.push(t);
      }
      renderAllMessages(t) {
        return this.errorMessages.map((r) => r(t)).join(`
`);
      }
    }, "Un");
    function mt(e) {
      return new Un(Qo(e));
    }
    __name(mt, "mt");
    function Qo(e) {
      let t = new ut();
      for (let [r, n] of Object.entries(e)) {
        let i = new Or(r, Ho(n));
        t.addField(i);
      }
      return t;
    }
    __name(Qo, "Qo");
    function Ho(e) {
      if (typeof e == "string")
        return new K(JSON.stringify(e));
      if (typeof e == "number" || typeof e == "boolean")
        return new K(String(e));
      if (typeof e == "bigint")
        return new K(`${e}n`);
      if (e === null)
        return new K("null");
      if (e === void 0)
        return new K("undefined");
      if (ot(e))
        return new K(`new Prisma.Decimal("${e.toFixed()}")`);
      if (e instanceof Uint8Array)
        return y.isBuffer(e) ? new K(`Buffer.alloc(${e.byteLength})`) : new K(`new Uint8Array(${e.byteLength})`);
      if (e instanceof Date) {
        let t = Pr(e) ? e.toISOString() : "Invalid Date";
        return new K(`new Date("${t}")`);
      }
      return e instanceof jo.ObjectEnumValue ? new K(`Prisma.${e._getName()}`) : pt(e) ? new K(`prisma.${Ie(e.modelName)}.$fields.${e.name}`) : Array.isArray(e) ? lc(e) : typeof e == "object" ? Qo(e) : new K(Object.prototype.toString.call(e));
    }
    __name(Ho, "Ho");
    function lc(e) {
      let t = new lt();
      for (let r of e)
        t.addItem(Ho(r));
      return t;
    }
    __name(lc, "lc");
    function kr(e, t) {
      let r = t === "pretty" ? Lo : Rr, n = e.renderAllMessages(r), i = new st(0, { colors: r }).write(e).toString();
      return { message: n, args: i };
    }
    __name(kr, "kr");
    function Mr({ args: e, errors: t, errorFormat: r, callsite: n, originalMethod: i, clientVersion: o, globalOmit: s }) {
      let a = mt(e);
      for (let v of t)
        Ar(v, a, s);
      let { message: d, args: f } = kr(a, r), P = vr({ message: d, callsite: n, originalMethod: i, showColors: r === "pretty", callArguments: f });
      throw new Jo.PrismaClientValidationError(P, { clientVersion: o });
    }
    __name(Mr, "Mr");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function be(e) {
      return e.replace(/^./, (t) => t.toLowerCase());
    }
    __name(be, "be");
    l();
    u();
    c();
    p();
    m();
    function Go(e, t, r) {
      let n = be(r);
      return !t.result || !(t.result.$allModels || t.result[n]) ? e : uc({ ...e, ...Wo(t.name, e, t.result.$allModels), ...Wo(t.name, e, t.result[n]) });
    }
    __name(Go, "Go");
    function uc(e) {
      let t = new he(), r = /* @__PURE__ */ __name((n, i) => t.getOrCreate(n, () => i.has(n) ? [n] : (i.add(n), e[n] ? e[n].needs.flatMap((o) => r(o, i)) : [n])), "r");
      return Tr(e, (n) => ({ ...n, needs: r(n.name, /* @__PURE__ */ new Set()) }));
    }
    __name(uc, "uc");
    function Wo(e, t, r) {
      return r ? Tr(r, ({ needs: n, compute: i }, o) => ({ name: o, needs: n ? Object.keys(n).filter((s) => n[s]) : [], compute: cc(t, o, i) })) : {};
    }
    __name(Wo, "Wo");
    function cc(e, t, r) {
      let n = e?.[t]?.compute;
      return n ? (i) => r({ ...i, [t]: n(i) }) : r;
    }
    __name(cc, "cc");
    function Ko(e, t) {
      if (!t)
        return e;
      let r = { ...e };
      for (let n of Object.values(t))
        if (e[n.name])
          for (let i of n.needs)
            r[i] = true;
      return r;
    }
    __name(Ko, "Ko");
    function zo(e, t) {
      if (!t)
        return e;
      let r = { ...e };
      for (let n of Object.values(t))
        if (!e[n.name])
          for (let i of n.needs)
            delete r[i];
      return r;
    }
    __name(zo, "zo");
    var Dr = /* @__PURE__ */ __name(class {
      constructor(t, r) {
        this.extension = t;
        this.previous = r;
      }
      computedFieldsCache = new he();
      modelExtensionsCache = new he();
      queryCallbacksCache = new he();
      clientExtensions = St(() => this.extension.client ? { ...this.previous?.getAllClientExtensions(), ...this.extension.client } : this.previous?.getAllClientExtensions());
      batchCallbacks = St(() => {
        let t = this.previous?.getAllBatchQueryCallbacks() ?? [], r = this.extension.query?.$__internalBatch;
        return r ? t.concat(r) : t;
      });
      getAllComputedFields(t) {
        return this.computedFieldsCache.getOrCreate(t, () => Go(this.previous?.getAllComputedFields(t), this.extension, t));
      }
      getAllClientExtensions() {
        return this.clientExtensions.get();
      }
      getAllModelExtensions(t) {
        return this.modelExtensionsCache.getOrCreate(t, () => {
          let r = be(t);
          return !this.extension.model || !(this.extension.model[r] || this.extension.model.$allModels) ? this.previous?.getAllModelExtensions(t) : { ...this.previous?.getAllModelExtensions(t), ...this.extension.model.$allModels, ...this.extension.model[r] };
        });
      }
      getAllQueryCallbacks(t, r) {
        return this.queryCallbacksCache.getOrCreate(`${t}:${r}`, () => {
          let n = this.previous?.getAllQueryCallbacks(t, r) ?? [], i = [], o = this.extension.query;
          return !o || !(o[t] || o.$allModels || o[r] || o.$allOperations) ? n : (o[t] !== void 0 && (o[t][r] !== void 0 && i.push(o[t][r]), o[t].$allOperations !== void 0 && i.push(o[t].$allOperations)), t !== "$none" && o.$allModels !== void 0 && (o.$allModels[r] !== void 0 && i.push(o.$allModels[r]), o.$allModels.$allOperations !== void 0 && i.push(o.$allModels.$allOperations)), o[r] !== void 0 && i.push(o[r]), o.$allOperations !== void 0 && i.push(o.$allOperations), n.concat(i));
        });
      }
      getAllBatchQueryCallbacks() {
        return this.batchCallbacks.get();
      }
    }, "Dr");
    var dt = /* @__PURE__ */ __name(class e {
      constructor(t) {
        this.head = t;
      }
      static empty() {
        return new e();
      }
      static single(t) {
        return new e(new Dr(t));
      }
      isEmpty() {
        return this.head === void 0;
      }
      append(t) {
        return new e(new Dr(t, this.head));
      }
      getAllComputedFields(t) {
        return this.head?.getAllComputedFields(t);
      }
      getAllClientExtensions() {
        return this.head?.getAllClientExtensions();
      }
      getAllModelExtensions(t) {
        return this.head?.getAllModelExtensions(t);
      }
      getAllQueryCallbacks(t, r) {
        return this.head?.getAllQueryCallbacks(t, r) ?? [];
      }
      getAllBatchQueryCallbacks() {
        return this.head?.getAllBatchQueryCallbacks() ?? [];
      }
    }, "e");
    l();
    u();
    c();
    p();
    m();
    var Nr = /* @__PURE__ */ __name(class {
      constructor(t) {
        this.name = t;
      }
    }, "Nr");
    function Zo(e) {
      return e instanceof Nr;
    }
    __name(Zo, "Zo");
    function Yo(e) {
      return new Nr(e);
    }
    __name(Yo, "Yo");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var Xo = Symbol();
    var qt = /* @__PURE__ */ __name(class {
      constructor(t) {
        if (t !== Xo)
          throw new Error("Skip instance can not be constructed directly");
      }
      ifUndefined(t) {
        return t === void 0 ? Lr : t;
      }
    }, "qt");
    var Lr = new qt(Xo);
    function xe(e) {
      return e instanceof qt;
    }
    __name(xe, "xe");
    var pc = { findUnique: "findUnique", findUniqueOrThrow: "findUniqueOrThrow", findFirst: "findFirst", findFirstOrThrow: "findFirstOrThrow", findMany: "findMany", count: "aggregate", create: "createOne", createMany: "createMany", createManyAndReturn: "createManyAndReturn", update: "updateOne", updateMany: "updateMany", updateManyAndReturn: "updateManyAndReturn", upsert: "upsertOne", delete: "deleteOne", deleteMany: "deleteMany", executeRaw: "executeRaw", queryRaw: "queryRaw", aggregate: "aggregate", groupBy: "groupBy", runCommandRaw: "runCommandRaw", findRaw: "findRaw", aggregateRaw: "aggregateRaw" };
    var es = "explicitly `undefined` values are not allowed";
    function _r({ modelName: e, action: t, args: r, runtimeDataModel: n, extensions: i = dt.empty(), callsite: o, clientMethod: s, errorFormat: a, clientVersion: d, previewFeatures: f, globalOmit: P }) {
      let v = new $n({ runtimeDataModel: n, modelName: e, action: t, rootArgs: r, callsite: o, extensions: i, selectionPath: [], argumentPath: [], originalMethod: s, errorFormat: a, clientVersion: d, previewFeatures: f, globalOmit: P });
      return { modelName: e, action: pc[t], query: Vt(r, v) };
    }
    __name(_r, "_r");
    function Vt({ select: e, include: t, ...r } = {}, n) {
      let i = r.omit;
      return delete r.omit, { arguments: rs(r, n), selection: mc(e, t, i, n) };
    }
    __name(Vt, "Vt");
    function mc(e, t, r, n) {
      return e ? (t ? n.throwValidationError({ kind: "MutuallyExclusiveFields", firstField: "include", secondField: "select", selectionPath: n.getSelectionPath() }) : r && n.throwValidationError({ kind: "MutuallyExclusiveFields", firstField: "omit", secondField: "select", selectionPath: n.getSelectionPath() }), yc(e, n)) : dc(n, t, r);
    }
    __name(mc, "mc");
    function dc(e, t, r) {
      let n = {};
      return e.modelOrType && !e.isRawAction() && (n.$composites = true, n.$scalars = true), t && fc(n, t, e), gc(n, r, e), n;
    }
    __name(dc, "dc");
    function fc(e, t, r) {
      for (let [n, i] of Object.entries(t)) {
        if (xe(i))
          continue;
        let o = r.nestSelection(n);
        if (qn(i, o), i === false || i === void 0) {
          e[n] = false;
          continue;
        }
        let s = r.findField(n);
        if (s && s.kind !== "object" && r.throwValidationError({ kind: "IncludeOnScalar", selectionPath: r.getSelectionPath().concat(n), outputType: r.getOutputTypeDescription() }), s) {
          e[n] = Vt(i === true ? {} : i, o);
          continue;
        }
        if (i === true) {
          e[n] = true;
          continue;
        }
        e[n] = Vt(i, o);
      }
    }
    __name(fc, "fc");
    function gc(e, t, r) {
      let n = r.getComputedFields(), i = { ...r.getGlobalOmit(), ...t }, o = zo(i, n);
      for (let [s, a] of Object.entries(o)) {
        if (xe(a))
          continue;
        qn(a, r.nestSelection(s));
        let d = r.findField(s);
        n?.[s] && !d || (e[s] = !a);
      }
    }
    __name(gc, "gc");
    function yc(e, t) {
      let r = {}, n = t.getComputedFields(), i = Ko(e, n);
      for (let [o, s] of Object.entries(i)) {
        if (xe(s))
          continue;
        let a = t.nestSelection(o);
        qn(s, a);
        let d = t.findField(o);
        if (!(n?.[o] && !d)) {
          if (s === false || s === void 0 || xe(s)) {
            r[o] = false;
            continue;
          }
          if (s === true) {
            d?.kind === "object" ? r[o] = Vt({}, a) : r[o] = true;
            continue;
          }
          r[o] = Vt(s, a);
        }
      }
      return r;
    }
    __name(yc, "yc");
    function ts(e, t) {
      if (e === null)
        return null;
      if (typeof e == "string" || typeof e == "number" || typeof e == "boolean")
        return e;
      if (typeof e == "bigint")
        return { $type: "BigInt", value: String(e) };
      if (it(e)) {
        if (Pr(e))
          return { $type: "DateTime", value: e.toISOString() };
        t.throwValidationError({ kind: "InvalidArgumentValue", selectionPath: t.getSelectionPath(), argumentPath: t.getArgumentPath(), argument: { name: t.getArgumentName(), typeNames: ["Date"] }, underlyingError: "Provided Date object is invalid" });
      }
      if (Zo(e))
        return { $type: "Param", value: e.name };
      if (pt(e))
        return { $type: "FieldRef", value: { _ref: e.name, _container: e.modelName } };
      if (Array.isArray(e))
        return hc(e, t);
      if (ArrayBuffer.isView(e)) {
        let { buffer: r, byteOffset: n, byteLength: i } = e;
        return { $type: "Bytes", value: y.from(r, n, i).toString("base64") };
      }
      if (wc(e))
        return e.values;
      if (ot(e))
        return { $type: "Decimal", value: e.toFixed() };
      if (e instanceof ke.ObjectEnumValue) {
        if (!(0, ke.isDbNull)(e) && !(0, ke.isJsonNull)(e) && !(0, ke.isAnyNull)(e))
          throw new Error("Invalid ObjectEnumValue");
        return { $type: "Enum", value: e._getName() };
      }
      if (bc(e))
        return e.toJSON();
      if (typeof e == "object")
        return rs(e, t);
      t.throwValidationError({ kind: "InvalidArgumentValue", selectionPath: t.getSelectionPath(), argumentPath: t.getArgumentPath(), argument: { name: t.getArgumentName(), typeNames: [] }, underlyingError: `We could not serialize ${Object.prototype.toString.call(e)} value. Serialize the object to JSON or implement a ".toJSON()" method on it` });
    }
    __name(ts, "ts");
    function rs(e, t) {
      if (e.$type)
        return { $type: "Raw", value: e };
      let r = {};
      for (let n in e) {
        let i = e[n], o = t.nestArgument(n);
        xe(i) || (i !== void 0 ? r[n] = ts(i, o) : t.isPreviewFeatureOn("strictUndefinedChecks") && t.throwValidationError({ kind: "InvalidArgumentValue", argumentPath: o.getArgumentPath(), selectionPath: t.getSelectionPath(), argument: { name: t.getArgumentName(), typeNames: [] }, underlyingError: es }));
      }
      return r;
    }
    __name(rs, "rs");
    function hc(e, t) {
      let r = [];
      for (let n = 0; n < e.length; n++) {
        let i = t.nestArgument(String(n)), o = e[n];
        if (o === void 0 || xe(o)) {
          let s = o === void 0 ? "undefined" : "Prisma.skip";
          t.throwValidationError({ kind: "InvalidArgumentValue", selectionPath: i.getSelectionPath(), argumentPath: i.getArgumentPath(), argument: { name: `${t.getArgumentName()}[${n}]`, typeNames: [] }, underlyingError: `Can not use \`${s}\` value within array. Use \`null\` or filter out \`${s}\` values` });
        }
        r.push(ts(o, i));
      }
      return r;
    }
    __name(hc, "hc");
    function wc(e) {
      return typeof e == "object" && e !== null && e.__prismaRawParameters__ === true;
    }
    __name(wc, "wc");
    function bc(e) {
      return typeof e == "object" && e !== null && typeof e.toJSON == "function";
    }
    __name(bc, "bc");
    function qn(e, t) {
      e === void 0 && t.isPreviewFeatureOn("strictUndefinedChecks") && t.throwValidationError({ kind: "InvalidSelectionValue", selectionPath: t.getSelectionPath(), underlyingError: es });
    }
    __name(qn, "qn");
    var $n = /* @__PURE__ */ __name(class e {
      constructor(t) {
        this.params = t;
        this.params.modelName && (this.modelOrType = this.params.runtimeDataModel.models[this.params.modelName] ?? this.params.runtimeDataModel.types[this.params.modelName]);
      }
      modelOrType;
      throwValidationError(t) {
        Mr({ errors: [t], originalMethod: this.params.originalMethod, args: this.params.rootArgs ?? {}, callsite: this.params.callsite, errorFormat: this.params.errorFormat, clientVersion: this.params.clientVersion, globalOmit: this.params.globalOmit });
      }
      getSelectionPath() {
        return this.params.selectionPath;
      }
      getArgumentPath() {
        return this.params.argumentPath;
      }
      getArgumentName() {
        return this.params.argumentPath[this.params.argumentPath.length - 1];
      }
      getOutputTypeDescription() {
        if (!(!this.params.modelName || !this.modelOrType))
          return { name: this.params.modelName, fields: this.modelOrType.fields.map((t) => ({ name: t.name, typeName: "boolean", isRelation: t.kind === "object" })) };
      }
      isRawAction() {
        return ["executeRaw", "queryRaw", "runCommandRaw", "findRaw", "aggregateRaw"].includes(this.params.action);
      }
      isPreviewFeatureOn(t) {
        return this.params.previewFeatures.includes(t);
      }
      getComputedFields() {
        if (this.params.modelName)
          return this.params.extensions.getAllComputedFields(this.params.modelName);
      }
      findField(t) {
        return this.modelOrType?.fields.find((r) => r.name === t);
      }
      nestSelection(t) {
        let r = this.findField(t), n = r?.kind === "object" ? r.type : void 0;
        return new e({ ...this.params, modelName: n, selectionPath: this.params.selectionPath.concat(t) });
      }
      getGlobalOmit() {
        return this.params.modelName && this.shouldApplyGlobalOmit() ? this.params.globalOmit?.[Ie(this.params.modelName)] ?? {} : {};
      }
      shouldApplyGlobalOmit() {
        switch (this.params.action) {
          case "findFirst":
          case "findFirstOrThrow":
          case "findUniqueOrThrow":
          case "findMany":
          case "upsert":
          case "findUnique":
          case "createManyAndReturn":
          case "create":
          case "update":
          case "updateManyAndReturn":
          case "delete":
            return true;
          case "executeRaw":
          case "aggregateRaw":
          case "runCommandRaw":
          case "findRaw":
          case "createMany":
          case "deleteMany":
          case "groupBy":
          case "updateMany":
          case "count":
          case "aggregate":
          case "queryRaw":
            return false;
          default:
            Ae(this.params.action, "Unknown action");
        }
      }
      nestArgument(t) {
        return new e({ ...this.params, argumentPath: this.params.argumentPath.concat(t) });
      }
    }, "e");
    l();
    u();
    c();
    p();
    m();
    function ns(e, t) {
      let r = St(() => xc(t));
      Object.defineProperty(e, "dmmf", { get: () => r.get() });
    }
    __name(ns, "ns");
    function xc(e) {
      throw new Error("Prisma.dmmf is not available when running in edge runtimes.");
    }
    __name(xc, "xc");
    l();
    u();
    c();
    p();
    m();
    var Bn = /* @__PURE__ */ new WeakMap();
    var Fr = "$$PrismaTypedSql";
    var Bt = /* @__PURE__ */ __name(class {
      constructor(t, r) {
        Bn.set(this, { sql: t, values: r }), Object.defineProperty(this, Fr, { value: Fr });
      }
      get sql() {
        return Bn.get(this).sql;
      }
      get values() {
        return Bn.get(this).values;
      }
    }, "Bt");
    function is(e) {
      return (...t) => new Bt(e, t);
    }
    __name(is, "is");
    function Ur(e) {
      return e != null && e[Fr] === Fr;
    }
    __name(Ur, "Ur");
    l();
    u();
    c();
    p();
    m();
    var Zl = require_dist();
    l();
    u();
    c();
    p();
    m();
    os();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function jt(e) {
      return { getKeys() {
        return Object.keys(e);
      }, getPropertyValue(t) {
        return e[t];
      } };
    }
    __name(jt, "jt");
    l();
    u();
    c();
    p();
    m();
    function te(e, t) {
      return { getKeys() {
        return [e];
      }, getPropertyValue() {
        return t();
      } };
    }
    __name(te, "te");
    l();
    u();
    c();
    p();
    m();
    function je(e) {
      let t = new he();
      return { getKeys() {
        return e.getKeys();
      }, getPropertyValue(r) {
        return t.getOrCreate(r, () => e.getPropertyValue(r));
      }, getPropertyDescriptor(r) {
        return e.getPropertyDescriptor?.(r);
      } };
    }
    __name(je, "je");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var qr = { enumerable: true, configurable: true, writable: true };
    function Vr(e) {
      let t = new Set(e);
      return { getPrototypeOf: () => Object.prototype, getOwnPropertyDescriptor: () => qr, has: (r, n) => t.has(n), set: (r, n, i) => t.add(n) && Reflect.set(r, n, i), ownKeys: () => [...t] };
    }
    __name(Vr, "Vr");
    var ss = Symbol.for("nodejs.util.inspect.custom");
    function pe(e, t) {
      let r = Ec(t), n = /* @__PURE__ */ new Set(), i = new Proxy(e, { get(o, s) {
        if (n.has(s))
          return o[s];
        let a = r.get(s);
        return a ? a.getPropertyValue(s) : o[s];
      }, has(o, s) {
        if (n.has(s))
          return true;
        let a = r.get(s);
        return a ? a.has?.(s) ?? true : Reflect.has(o, s);
      }, ownKeys(o) {
        let s = as(Reflect.ownKeys(o), r), a = as(Array.from(r.keys()), r);
        return [.../* @__PURE__ */ new Set([...s, ...a, ...n])];
      }, set(o, s, a) {
        return r.get(s)?.getPropertyDescriptor?.(s)?.writable === false ? false : (n.add(s), Reflect.set(o, s, a));
      }, getOwnPropertyDescriptor(o, s) {
        let a = Reflect.getOwnPropertyDescriptor(o, s);
        if (a && !a.configurable)
          return a;
        let d = r.get(s);
        return d ? d.getPropertyDescriptor ? { ...qr, ...d?.getPropertyDescriptor(s) } : qr : a;
      }, defineProperty(o, s, a) {
        return n.add(s), Reflect.defineProperty(o, s, a);
      }, getPrototypeOf: () => Object.prototype });
      return i[ss] = function() {
        let o = { ...this };
        return delete o[ss], o;
      }, i;
    }
    __name(pe, "pe");
    function Ec(e) {
      let t = /* @__PURE__ */ new Map();
      for (let r of e) {
        let n = r.getKeys();
        for (let i of n)
          t.set(i, r);
      }
      return t;
    }
    __name(Ec, "Ec");
    function as(e, t) {
      return e.filter((r) => t.get(r)?.has?.(r) ?? true);
    }
    __name(as, "as");
    l();
    u();
    c();
    p();
    m();
    function ft(e) {
      return { getKeys() {
        return e;
      }, has() {
        return false;
      }, getPropertyValue() {
      } };
    }
    __name(ft, "ft");
    l();
    u();
    c();
    p();
    m();
    function ls(e) {
      if (e === void 0)
        return "";
      let t = mt(e);
      return new st(0, { colors: Rr }).write(t).toString();
    }
    __name(ls, "ls");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var jn = /* @__PURE__ */ __name(class {
      getLocation() {
        return null;
      }
    }, "jn");
    function Me(e) {
      return typeof $EnabledCallSite == "function" && e !== "minimal" ? new $EnabledCallSite() : new jn();
    }
    __name(Me, "Me");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var us = { _avg: true, _count: true, _sum: true, _min: true, _max: true };
    function gt(e = {}) {
      let t = Pc(e);
      return Object.entries(t).reduce((n, [i, o]) => (us[i] !== void 0 ? n.select[i] = { select: o } : n[i] = o, n), { select: {} });
    }
    __name(gt, "gt");
    function Pc(e = {}) {
      return typeof e._count == "boolean" ? { ...e, _count: { _all: e._count } } : e;
    }
    __name(Pc, "Pc");
    function Br(e = {}) {
      return (t) => (typeof e._count == "boolean" && (t._count = t._count._all), t);
    }
    __name(Br, "Br");
    function cs(e, t) {
      let r = Br(e);
      return t({ action: "aggregate", unpacker: r, argsMapper: gt })(e);
    }
    __name(cs, "cs");
    l();
    u();
    c();
    p();
    m();
    function vc(e = {}) {
      let { select: t, ...r } = e;
      return typeof t == "object" ? gt({ ...r, _count: t }) : gt({ ...r, _count: { _all: true } });
    }
    __name(vc, "vc");
    function Ac(e = {}) {
      return typeof e.select == "object" ? (t) => Br(e)(t)._count : (t) => Br(e)(t)._count._all;
    }
    __name(Ac, "Ac");
    function ps(e, t) {
      return t({ action: "count", unpacker: Ac(e), argsMapper: vc })(e);
    }
    __name(ps, "ps");
    l();
    u();
    c();
    p();
    m();
    function Cc(e = {}) {
      let t = gt(e);
      if (Array.isArray(t.by))
        for (let r of t.by)
          typeof r == "string" && (t.select[r] = true);
      else
        typeof t.by == "string" && (t.select[t.by] = true);
      return t;
    }
    __name(Cc, "Cc");
    function Sc(e = {}) {
      return (t) => (typeof e?._count == "boolean" && t.forEach((r) => {
        r._count = r._count._all;
      }), t);
    }
    __name(Sc, "Sc");
    function ms(e, t) {
      return t({ action: "groupBy", unpacker: Sc(e), argsMapper: Cc })(e);
    }
    __name(ms, "ms");
    function ds(e, t, r) {
      if (t === "aggregate")
        return (n) => cs(n, r);
      if (t === "count")
        return (n) => ps(n, r);
      if (t === "groupBy")
        return (n) => ms(n, r);
    }
    __name(ds, "ds");
    l();
    u();
    c();
    p();
    m();
    function fs(e, t) {
      let r = t.fields.filter((i) => !i.relationName), n = eo(r, "name");
      return new Proxy({}, { get(i, o) {
        if (o in i || typeof o == "symbol")
          return i[o];
        let s = n[o];
        if (s)
          return new $t(e, o, s.type, s.isList, s.kind === "enum");
      }, ...Vr(Object.keys(n)) });
    }
    __name(fs, "fs");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var gs = /* @__PURE__ */ __name((e) => Array.isArray(e) ? e : e.split("."), "gs");
    var Qn = /* @__PURE__ */ __name((e, t) => gs(t).reduce((r, n) => r && r[n], e), "Qn");
    var ys = /* @__PURE__ */ __name((e, t, r) => gs(t).reduceRight((n, i, o, s) => Object.assign({}, Qn(e, s.slice(0, o)), { [i]: n }), r), "ys");
    function Rc(e, t) {
      return e === void 0 || t === void 0 ? [] : [...t, "select", e];
    }
    __name(Rc, "Rc");
    function Ic(e, t, r) {
      return t === void 0 ? e ?? {} : ys(t, r, e || true);
    }
    __name(Ic, "Ic");
    function Hn(e, t, r, n, i, o) {
      let a = e._runtimeDataModel.models[t].fields.reduce((d, f) => ({ ...d, [f.name]: f }), {});
      return (d) => {
        let f = Me(e._errorFormat), P = Rc(n, i), v = Ic(d, o, P), S = r({ dataPath: P, callsite: f })(v), C = Oc(e, t);
        return new Proxy(S, { get(M, R) {
          if (!C.includes(R))
            return M[R];
          let Pe = [a[R].type, r, R], re = [P, v];
          return Hn(e, ...Pe, ...re);
        }, ...Vr([...C, ...Object.getOwnPropertyNames(S)]) });
      };
    }
    __name(Hn, "Hn");
    function Oc(e, t) {
      return e._runtimeDataModel.models[t].fields.filter((r) => r.kind === "object").map((r) => r.name);
    }
    __name(Oc, "Oc");
    var kc = ["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "create", "update", "upsert", "delete"];
    var Mc = ["aggregate", "count", "groupBy"];
    function Jn(e, t) {
      let r = e._extensions.getAllModelExtensions(t) ?? {}, n = [Dc(e, t), Lc(e, t), jt(r), te("name", () => t), te("$name", () => t), te("$parent", () => e._appliedParent)];
      return pe({}, n);
    }
    __name(Jn, "Jn");
    function Dc(e, t) {
      let r = be(t), n = Object.keys(Lt).concat("count");
      return { getKeys() {
        return n;
      }, getPropertyValue(i) {
        let o = i, s = /* @__PURE__ */ __name((a) => (d) => {
          let f = Me(e._errorFormat);
          return e._createPrismaPromise((P) => {
            let v = { args: d, dataPath: [], action: o, model: t, clientMethod: `${r}.${i}`, jsModelName: r, transaction: P, callsite: f };
            return e._request({ ...v, ...a });
          }, { action: o, args: d, model: t });
        }, "s");
        return kc.includes(o) ? Hn(e, t, s) : Nc(i) ? ds(e, i, s) : s({});
      } };
    }
    __name(Dc, "Dc");
    function Nc(e) {
      return Mc.includes(e);
    }
    __name(Nc, "Nc");
    function Lc(e, t) {
      return je(te("fields", () => {
        let r = e._runtimeDataModel.models[t];
        return fs(t, r);
      }));
    }
    __name(Lc, "Lc");
    l();
    u();
    c();
    p();
    m();
    function hs(e) {
      return e.replace(/^./, (t) => t.toUpperCase());
    }
    __name(hs, "hs");
    var Wn = Symbol();
    function Qt(e) {
      let t = [_c(e), Fc(e), te(Wn, () => e), te("$parent", () => e._appliedParent)], r = e._extensions.getAllClientExtensions();
      return r && t.push(jt(r)), pe(e, t);
    }
    __name(Qt, "Qt");
    function _c(e) {
      let t = Object.getPrototypeOf(e._originalClient), r = [...new Set(Object.getOwnPropertyNames(t))];
      return { getKeys() {
        return r;
      }, getPropertyValue(n) {
        return e[n];
      } };
    }
    __name(_c, "_c");
    function Fc(e) {
      let t = Object.keys(e._runtimeDataModel.models), r = t.map(be), n = [...new Set(t.concat(r))];
      return je({ getKeys() {
        return n;
      }, getPropertyValue(i) {
        let o = hs(i);
        if (e._runtimeDataModel.models[o] !== void 0)
          return Jn(e, o);
        if (e._runtimeDataModel.models[i] !== void 0)
          return Jn(e, i);
      }, getPropertyDescriptor(i) {
        if (!r.includes(i))
          return { enumerable: false };
      } });
    }
    __name(Fc, "Fc");
    function ws(e) {
      return e[Wn] ? e[Wn] : e;
    }
    __name(ws, "ws");
    function bs(e) {
      if (typeof e == "function")
        return e(this);
      let t = Object.create(this._originalClient, { _extensions: { value: this._extensions.append(e) }, _appliedParent: { value: this, configurable: true }, $on: { value: void 0 } });
      return Qt(t);
    }
    __name(bs, "bs");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function xs({ result: e, modelName: t, select: r, omit: n, extensions: i }) {
      let o = i.getAllComputedFields(t);
      if (!o)
        return e;
      let s = [], a = [];
      for (let d of Object.values(o)) {
        if (n) {
          if (n[d.name])
            continue;
          let f = d.needs.filter((P) => n[P]);
          f.length > 0 && a.push(ft(f));
        } else if (r) {
          if (!r[d.name])
            continue;
          let f = d.needs.filter((P) => !r[P]);
          f.length > 0 && a.push(ft(f));
        }
        Uc(e, d.needs) && s.push($c(d, pe(e, s)));
      }
      return s.length > 0 || a.length > 0 ? pe(e, [...s, ...a]) : e;
    }
    __name(xs, "xs");
    function Uc(e, t) {
      return t.every((r) => Dn(e, r));
    }
    __name(Uc, "Uc");
    function $c(e, t) {
      return je(te(e.name, () => e.compute(t)));
    }
    __name($c, "$c");
    l();
    u();
    c();
    p();
    m();
    function jr({ visitor: e, result: t, args: r, runtimeDataModel: n, modelName: i }) {
      if (Array.isArray(t)) {
        for (let s = 0; s < t.length; s++)
          t[s] = jr({ result: t[s], args: r, modelName: i, runtimeDataModel: n, visitor: e });
        return t;
      }
      let o = e(t, i, r) ?? t;
      return r.include && Es({ includeOrSelect: r.include, result: o, parentModelName: i, runtimeDataModel: n, visitor: e }), r.select && Es({ includeOrSelect: r.select, result: o, parentModelName: i, runtimeDataModel: n, visitor: e }), o;
    }
    __name(jr, "jr");
    function Es({ includeOrSelect: e, result: t, parentModelName: r, runtimeDataModel: n, visitor: i }) {
      for (let [o, s] of Object.entries(e)) {
        if (!s || t[o] == null || xe(s))
          continue;
        let d = n.models[r].fields.find((P) => P.name === o);
        if (!d || d.kind !== "object" || !d.relationName)
          continue;
        let f = typeof s == "object" ? s : {};
        t[o] = jr({ visitor: i, result: t[o], args: f, modelName: d.type, runtimeDataModel: n });
      }
    }
    __name(Es, "Es");
    function Ts({ result: e, modelName: t, args: r, extensions: n, runtimeDataModel: i, globalOmit: o }) {
      return n.isEmpty() || e == null || typeof e != "object" || !i.models[t] ? e : jr({ result: e, args: r ?? {}, modelName: t, runtimeDataModel: i, visitor: (a, d, f) => {
        let P = be(d);
        return xs({ result: a, modelName: P, select: f.select, omit: f.select ? void 0 : { ...o?.[P], ...f.omit }, extensions: n });
      } });
    }
    __name(Ts, "Ts");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var Qe = require_dist();
    l();
    u();
    c();
    p();
    m();
    var qc = ["$connect", "$disconnect", "$on", "$transaction", "$extends"];
    var Ps = qc;
    function vs(e) {
      if (e instanceof Qe.Sql)
        return Vc(e);
      if (Ur(e))
        return Bc(e);
      if (Array.isArray(e)) {
        let r = [e[0]];
        for (let n = 1; n < e.length; n++)
          r[n] = Ht(e[n]);
        return r;
      }
      let t = {};
      for (let r in e)
        t[r] = Ht(e[r]);
      return t;
    }
    __name(vs, "vs");
    function Vc(e) {
      return new Qe.Sql(e.strings, e.values);
    }
    __name(Vc, "Vc");
    function Bc(e) {
      return new Bt(e.sql, e.values);
    }
    __name(Bc, "Bc");
    function Ht(e) {
      if (typeof e != "object" || e == null || e instanceof Qe.ObjectEnumValue || pt(e))
        return e;
      if (ot(e))
        return new Qe.Decimal(e.toFixed());
      if (it(e))
        return /* @__PURE__ */ new Date(+e);
      if (ArrayBuffer.isView(e))
        return e.slice(0);
      if (Array.isArray(e)) {
        let t = e.length, r;
        for (r = Array(t); t--; )
          r[t] = Ht(e[t]);
        return r;
      }
      if (typeof e == "object") {
        let t = {};
        for (let r in e)
          r === "__proto__" ? Object.defineProperty(t, r, { value: Ht(e[r]), configurable: true, enumerable: true, writable: true }) : t[r] = Ht(e[r]);
        return t;
      }
      Ae(e, "Unknown value");
    }
    __name(Ht, "Ht");
    function Cs(e, t, r, n = 0) {
      return e._createPrismaPromise((i) => {
        let o = t.customDataProxyFetch;
        return "transaction" in t && i !== void 0 && (t.transaction?.kind === "batch" && t.transaction.lock.then(), t.transaction = i), n === r.length ? e._executeRequest(t) : r[n]({ model: t.model, operation: t.model ? t.action : t.clientMethod, args: vs(t.args ?? {}), __internalParams: t, query: (s, a = t) => {
          let d = a.customDataProxyFetch;
          return a.customDataProxyFetch = Os(o, d), a.args = s, Cs(e, a, r, n + 1);
        } });
      });
    }
    __name(Cs, "Cs");
    function Ss(e, t) {
      let { jsModelName: r, action: n, clientMethod: i } = t, o = r ? n : i;
      if (e._extensions.isEmpty())
        return e._executeRequest(t);
      let s = e._extensions.getAllQueryCallbacks(r ?? "$none", o);
      return Cs(e, t, s);
    }
    __name(Ss, "Ss");
    function Rs(e) {
      return (t) => {
        let r = { requests: t }, n = t[0].extensions.getAllBatchQueryCallbacks();
        return n.length ? Is(r, n, 0, e) : e(r);
      };
    }
    __name(Rs, "Rs");
    function Is(e, t, r, n) {
      if (r === t.length)
        return n(e);
      let i = e.customDataProxyFetch, o = e.requests[0].transaction;
      return t[r]({ args: { queries: e.requests.map((s) => ({ model: s.modelName, operation: s.action, args: s.args })), transaction: o ? { isolationLevel: o.kind === "batch" ? o.isolationLevel : void 0 } : void 0 }, __internalParams: e, query(s, a = e) {
        let d = a.customDataProxyFetch;
        return a.customDataProxyFetch = Os(i, d), Is(a, t, r + 1, n);
      } });
    }
    __name(Is, "Is");
    var As = /* @__PURE__ */ __name((e) => e, "As");
    function Os(e = As, t = As) {
      return (r) => e(t(r));
    }
    __name(Os, "Os");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var _s = require_dist();
    l();
    u();
    c();
    p();
    m();
    var Jt = require_dist();
    function L(e, t) {
      throw new Error(t);
    }
    __name(L, "L");
    function Gn(e, t) {
      return e === t || e !== null && t !== null && typeof e == "object" && typeof t == "object" && Object.keys(e).length === Object.keys(t).length && Object.keys(e).every((r) => Gn(e[r], t[r]));
    }
    __name(Gn, "Gn");
    function yt(e, t) {
      let r = Object.keys(e), n = Object.keys(t);
      return (r.length < n.length ? r : n).every((o) => {
        if (typeof e[o] == typeof t[o] && typeof e[o] != "object")
          return e[o] === t[o];
        if (Jt.Decimal.isDecimal(e[o]) || Jt.Decimal.isDecimal(t[o])) {
          let s = ks(e[o]), a = ks(t[o]);
          return s && a && s.equals(a);
        } else if (e[o] instanceof Uint8Array || t[o] instanceof Uint8Array) {
          let s = Ms(e[o]), a = Ms(t[o]);
          return s && a && s.equals(a);
        } else {
          if (e[o] instanceof Date || t[o] instanceof Date)
            return Ds(e[o])?.getTime() === Ds(t[o])?.getTime();
          if (typeof e[o] == "bigint" || typeof t[o] == "bigint")
            return Ns(e[o]) === Ns(t[o]);
          if (typeof e[o] == "number" || typeof t[o] == "number")
            return Ls(e[o]) === Ls(t[o]);
        }
        return Gn(e[o], t[o]);
      });
    }
    __name(yt, "yt");
    function ks(e) {
      return Jt.Decimal.isDecimal(e) ? e : typeof e == "number" || typeof e == "string" ? new Jt.Decimal(e) : void 0;
    }
    __name(ks, "ks");
    function Ms(e) {
      return y.isBuffer(e) ? e : e instanceof Uint8Array ? y.from(e.buffer, e.byteOffset, e.byteLength) : typeof e == "string" ? y.from(e, "base64") : void 0;
    }
    __name(Ms, "Ms");
    function Ds(e) {
      return e instanceof Date ? e : typeof e == "string" || typeof e == "number" ? new Date(e) : void 0;
    }
    __name(Ds, "Ds");
    function Ns(e) {
      return typeof e == "bigint" ? e : typeof e == "number" || typeof e == "string" ? BigInt(e) : void 0;
    }
    __name(Ns, "Ns");
    function Ls(e) {
      return typeof e == "number" ? e : typeof e == "string" ? Number(e) : void 0;
    }
    __name(Ls, "Ls");
    function Wt(e) {
      return JSON.stringify(e, (t, r) => typeof r == "bigint" ? r.toString() : ArrayBuffer.isView(r) ? y.from(r.buffer, r.byteOffset, r.byteLength).toString("base64") : r);
    }
    __name(Wt, "Wt");
    function jc(e) {
      return e !== null && typeof e == "object" && typeof e.$type == "string";
    }
    __name(jc, "jc");
    function Qc(e, t) {
      let r = {};
      for (let n of Object.keys(e))
        r[n] = t(e[n], n);
      return r;
    }
    __name(Qc, "Qc");
    function De(e) {
      return e === null ? e : Array.isArray(e) ? e.map(De) : typeof e == "object" ? jc(e) ? Hc(e) : e.constructor !== null && e.constructor.name !== "Object" ? e : Qc(e, De) : e;
    }
    __name(De, "De");
    function Hc({ $type: e, value: t }) {
      switch (e) {
        case "BigInt":
          return BigInt(t);
        case "Bytes": {
          let { buffer: r, byteOffset: n, byteLength: i } = y.from(t, "base64");
          return new Uint8Array(r, n, i);
        }
        case "DateTime":
          return new Date(t);
        case "Decimal":
          return new _s.Decimal(t);
        case "Json":
          return JSON.parse(t);
        default:
          L(t, "Unknown tagged value");
      }
    }
    __name(Hc, "Hc");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function Qr(e) {
      return e.name === "DriverAdapterError" && typeof e.cause == "object";
    }
    __name(Qr, "Qr");
    l();
    u();
    c();
    p();
    m();
    var I = { Int32: 0, Int64: 1, Float: 2, Double: 3, Numeric: 4, Boolean: 5, Character: 6, Text: 7, Date: 8, Time: 9, DateTime: 10, Json: 11, Enum: 12, Bytes: 13, Set: 14, Uuid: 15, Int32Array: 64, Int64Array: 65, FloatArray: 66, DoubleArray: 67, NumericArray: 68, BooleanArray: 69, CharacterArray: 70, TextArray: 71, DateArray: 72, TimeArray: 73, DateTimeArray: 74, JsonArray: 75, EnumArray: 76, BytesArray: 77, UuidArray: 78, UnknownNumber: 128 };
    var z = /* @__PURE__ */ __name(class extends Error {
      name = "UserFacingError";
      code;
      meta;
      constructor(t, r, n) {
        super(t), this.code = r, this.meta = n ?? {};
      }
      toQueryResponseErrorObject() {
        return { error: this.message, user_facing_error: { is_panic: false, message: this.message, meta: this.meta, error_code: this.code } };
      }
    }, "z");
    function ht(e) {
      if (!Qr(e))
        throw e;
      let t = Jc(e), r = Fs(e);
      throw !t || !r ? e : new z(r, t, { driverAdapterError: e });
    }
    __name(ht, "ht");
    function zn(e) {
      throw Qr(e) ? new z(`Raw query failed. Code: \`${e.cause.originalCode ?? "N/A"}\`. Message: \`${e.cause.originalMessage ?? Fs(e)}\``, "P2010", { driverAdapterError: e }) : e;
    }
    __name(zn, "zn");
    function Jc(e) {
      switch (e.cause.kind) {
        case "AuthenticationFailed":
          return "P1000";
        case "DatabaseNotReachable":
          return "P1001";
        case "DatabaseDoesNotExist":
          return "P1003";
        case "SocketTimeout":
          return "P1008";
        case "DatabaseAlreadyExists":
          return "P1009";
        case "DatabaseAccessDenied":
          return "P1010";
        case "TlsConnectionError":
          return "P1011";
        case "ConnectionClosed":
          return "P1017";
        case "TransactionAlreadyClosed":
          return "P1018";
        case "LengthMismatch":
          return "P2000";
        case "UniqueConstraintViolation":
          return "P2002";
        case "ForeignKeyConstraintViolation":
          return "P2003";
        case "InvalidInputValue":
          return "P2007";
        case "UnsupportedNativeDataType":
          return "P2010";
        case "NullConstraintViolation":
          return "P2011";
        case "ValueOutOfRange":
          return "P2020";
        case "TableDoesNotExist":
          return "P2021";
        case "ColumnNotFound":
          return "P2022";
        case "InvalidIsolationLevel":
        case "InconsistentColumnData":
          return "P2023";
        case "MissingFullTextSearchIndex":
          return "P2030";
        case "TransactionWriteConflict":
          return "P2034";
        case "GenericJs":
          return "P2036";
        case "TooManyConnections":
          return "P2037";
        case "postgres":
        case "sqlite":
        case "mysql":
        case "mssql":
          return;
        default:
          L(e.cause, `Unknown error: ${e.cause}`);
      }
    }
    __name(Jc, "Jc");
    function Fs(e) {
      switch (e.cause.kind) {
        case "AuthenticationFailed":
          return `Authentication failed against the database server, the provided database credentials for \`${e.cause.user ?? "(not available)"}\` are not valid`;
        case "DatabaseNotReachable": {
          let t = e.cause.host && e.cause.port ? `${e.cause.host}:${e.cause.port}` : e.cause.host;
          return `Can't reach database server${t ? ` at ${t}` : ""}`;
        }
        case "DatabaseDoesNotExist":
          return `Database \`${e.cause.db ?? "(not available)"}\` does not exist on the database server`;
        case "SocketTimeout":
          return "Operation has timed out";
        case "DatabaseAlreadyExists":
          return `Database \`${e.cause.db ?? "(not available)"}\` already exists on the database server`;
        case "DatabaseAccessDenied":
          return `User was denied access on the database \`${e.cause.db ?? "(not available)"}\``;
        case "TlsConnectionError":
          return `Error opening a TLS connection: ${e.cause.reason}`;
        case "ConnectionClosed":
          return "Server has closed the connection.";
        case "TransactionAlreadyClosed":
          return e.cause.cause;
        case "LengthMismatch":
          return `The provided value for the column is too long for the column's type. Column: ${e.cause.column ?? "(not available)"}`;
        case "UniqueConstraintViolation":
          return `Unique constraint failed on the ${Kn(e.cause.constraint)}`;
        case "ForeignKeyConstraintViolation":
          return `Foreign key constraint violated on the ${Kn(e.cause.constraint)}`;
        case "UnsupportedNativeDataType":
          return `Failed to deserialize column of type '${e.cause.type}'. If you're using $queryRaw and this column is explicitly marked as \`Unsupported\` in your Prisma schema, try casting this column to any supported Prisma type such as \`String\`.`;
        case "NullConstraintViolation":
          return `Null constraint violation on the ${Kn(e.cause.constraint)}`;
        case "ValueOutOfRange":
          return `Value out of range for the type: ${e.cause.cause}`;
        case "TableDoesNotExist":
          return `The table \`${e.cause.table ?? "(not available)"}\` does not exist in the current database.`;
        case "ColumnNotFound":
          return `The column \`${e.cause.column ?? "(not available)"}\` does not exist in the current database.`;
        case "InvalidIsolationLevel":
          return `Error in connector: Conversion error: ${e.cause.level}`;
        case "InconsistentColumnData":
          return `Inconsistent column data: ${e.cause.cause}`;
        case "MissingFullTextSearchIndex":
          return "Cannot find a fulltext index to use for the native search, try adding a @@fulltext([Fields...]) to your schema";
        case "TransactionWriteConflict":
          return "Transaction failed due to a write conflict or a deadlock. Please retry your transaction";
        case "GenericJs":
          return `Error in external connector (id ${e.cause.id})`;
        case "TooManyConnections":
          return `Too many database connections opened: ${e.cause.cause}`;
        case "InvalidInputValue":
          return `Invalid input value: ${e.cause.message}`;
        case "sqlite":
        case "postgres":
        case "mysql":
        case "mssql":
          return;
        default:
          L(e.cause, `Unknown error: ${e.cause}`);
      }
    }
    __name(Fs, "Fs");
    function Kn(e) {
      return e && "fields" in e ? `fields: (${e.fields.map((t) => `\`${t}\``).join(", ")})` : e && "index" in e ? `constraint: \`${e.index}\`` : e && "foreignKey" in e ? "foreign key" : "(not available)";
    }
    __name(Kn, "Kn");
    function Us(e, t) {
      let r = e.map((i) => t.keys.reduce((o, s) => (o[s] = De(i[s]), o), {})), n = new Set(t.nestedSelection);
      return t.arguments.map((i) => {
        let o = r.findIndex((s) => yt(s, i));
        if (o === -1)
          return t.expectNonEmpty ? new z("An operation failed because it depends on one or more records that were required but not found", "P2025") : null;
        {
          let s = Object.entries(e[o]).filter(([a]) => n.has(a));
          return Object.fromEntries(s);
        }
      });
    }
    __name(Us, "Us");
    l();
    u();
    c();
    p();
    m();
    var qs = require_dist();
    var q = /* @__PURE__ */ __name(class extends z {
      name = "DataMapperError";
      constructor(t, r) {
        super(t, "P2023", r);
      }
    }, "q");
    function Vs(e, t, r) {
      switch (t.type) {
        case "affectedRows":
          if (typeof e != "number")
            throw new q(`Expected an affected rows count, got: ${typeof e} (${e})`);
          return { count: e };
        case "object":
          return Yn(e, t.fields, r, t.skipNulls);
        case "field":
          return Zn(e, "<result>", t.fieldType, r);
        default:
          L(t, `Invalid data mapping type: '${t.type}'`);
      }
    }
    __name(Vs, "Vs");
    function Yn(e, t, r, n) {
      if (e === null)
        return null;
      if (Array.isArray(e)) {
        let i = e;
        return n && (i = i.filter((o) => o !== null)), i.map((o) => $s(o, t, r));
      }
      if (typeof e == "object")
        return $s(e, t, r);
      if (typeof e == "string") {
        let i;
        try {
          i = JSON.parse(e);
        } catch (o) {
          throw new q("Expected an array or object, got a string that is not valid JSON", { cause: o });
        }
        return Yn(i, t, r, n);
      }
      throw new q(`Expected an array or an object, got: ${typeof e}`);
    }
    __name(Yn, "Yn");
    function $s(e, t, r) {
      if (typeof e != "object")
        throw new q(`Expected an object, but got '${typeof e}'`);
      let n = {};
      for (let [i, o] of Object.entries(t))
        switch (o.type) {
          case "affectedRows":
            throw new q(`Unexpected 'AffectedRows' node in data mapping for field '${i}'`);
          case "object": {
            if (o.serializedName !== null && !Object.hasOwn(e, o.serializedName))
              throw new q(`Missing data field (Object): '${i}'; node: ${JSON.stringify(o)}; data: ${JSON.stringify(e)}`);
            let s = o.serializedName !== null ? e[o.serializedName] : e;
            n[i] = Yn(s, o.fields, r, o.skipNulls);
            break;
          }
          case "field":
            {
              let s = o.dbName;
              if (Object.hasOwn(e, s))
                n[i] = Wc(e[s], s, o.fieldType, r);
              else
                throw new q(`Missing data field (Value): '${s}'; node: ${JSON.stringify(o)}; data: ${JSON.stringify(e)}`);
            }
            break;
          default:
            L(o, `DataMapper: Invalid data mapping node type: '${o.type}'`);
        }
      return n;
    }
    __name($s, "$s");
    function Wc(e, t, r, n) {
      return e === null ? r.arity === "list" ? [] : null : r.arity === "list" ? e.map((o, s) => Zn(o, `${t}[${s}]`, r, n)) : Zn(e, t, r, n);
    }
    __name(Wc, "Wc");
    function Zn(e, t, r, n) {
      switch (r.type) {
        case "unsupported":
          return e;
        case "string": {
          if (typeof e != "string")
            throw new q(`Expected a string in column '${t}', got ${typeof e}: ${e}`);
          return e;
        }
        case "int":
          switch (typeof e) {
            case "number":
              return Math.trunc(e);
            case "string": {
              let i = Math.trunc(Number(e));
              if (Number.isNaN(i) || !Number.isFinite(i))
                throw new q(`Expected an integer in column '${t}', got string: ${e}`);
              if (!Number.isSafeInteger(i))
                throw new q(`Integer value in column '${t}' is too large to represent as a JavaScript number without loss of precision, got: ${e}. Consider using BigInt type.`);
              return i;
            }
            default:
              throw new q(`Expected an integer in column '${t}', got ${typeof e}: ${e}`);
          }
        case "bigint": {
          if (typeof e != "number" && typeof e != "string")
            throw new q(`Expected a bigint in column '${t}', got ${typeof e}: ${e}`);
          return { $type: "BigInt", value: e };
        }
        case "float": {
          if (typeof e == "number")
            return e;
          if (typeof e == "string") {
            let i = Number(e);
            if (Number.isNaN(i) && !/^[-+]?nan$/.test(e.toLowerCase()))
              throw new q(`Expected a float in column '${t}', got string: ${e}`);
            return i;
          }
          throw new q(`Expected a float in column '${t}', got ${typeof e}: ${e}`);
        }
        case "boolean": {
          if (typeof e == "boolean")
            return e;
          if (typeof e == "number")
            return e === 1;
          if (typeof e == "string") {
            if (e === "true" || e === "TRUE" || e === "1")
              return true;
            if (e === "false" || e === "FALSE" || e === "0")
              return false;
            throw new q(`Expected a boolean in column '${t}', got ${typeof e}: ${e}`);
          }
          if (Array.isArray(e) || e instanceof Uint8Array) {
            for (let i of e)
              if (i !== 0)
                return true;
            return false;
          }
          throw new q(`Expected a boolean in column '${t}', got ${typeof e}: ${e}`);
        }
        case "decimal":
          if (typeof e != "number" && typeof e != "string" && !qs.Decimal.isDecimal(e))
            throw new q(`Expected a decimal in column '${t}', got ${typeof e}: ${e}`);
          return { $type: "Decimal", value: e };
        case "datetime": {
          if (typeof e == "string")
            return { $type: "DateTime", value: Kc(e) };
          if (typeof e == "number" || e instanceof Date)
            return { $type: "DateTime", value: e };
          throw new q(`Expected a date in column '${t}', got ${typeof e}: ${e}`);
        }
        case "object":
          return { $type: "Json", value: Wt(e) };
        case "json":
          return { $type: "Json", value: `${e}` };
        case "bytes": {
          switch (r.encoding) {
            case "base64":
              if (typeof e != "string")
                throw new q(`Expected a base64-encoded byte array in column '${t}', got ${typeof e}: ${e}`);
              return { $type: "Bytes", value: e };
            case "hex":
              if (typeof e != "string" || !e.startsWith("\\x"))
                throw new q(`Expected a hex-encoded byte array in column '${t}', got ${typeof e}: ${e}`);
              return { $type: "Bytes", value: y.from(e.slice(2), "hex").toString("base64") };
            case "array":
              if (Array.isArray(e))
                return { $type: "Bytes", value: y.from(e).toString("base64") };
              if (e instanceof Uint8Array)
                return { $type: "Bytes", value: y.from(e).toString("base64") };
              throw new q(`Expected a byte array in column '${t}', got ${typeof e}: ${e}`);
            default:
              L(r.encoding, `DataMapper: Unknown bytes encoding: ${r.encoding}`);
          }
          break;
        }
        case "enum": {
          let i = n[r.name];
          if (i === void 0)
            throw new q(`Unknown enum '${r.name}'`);
          let o = i[`${e}`];
          if (o === void 0)
            throw new q(`Value '${e}' not found in enum '${r.name}'`);
          return o;
        }
        default:
          L(r, `DataMapper: Unknown result type: ${r.type}`);
      }
    }
    __name(Zn, "Zn");
    var Gc = /\d{2}:\d{2}:\d{2}(?:\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/;
    function Kc(e) {
      let t = Gc.exec(e);
      if (t === null)
        return `${e}T00:00:00Z`;
      let r = e, [n, i, o] = t;
      if (i !== void 0 && i !== "Z" && o === void 0 ? r = `${e}:00` : i === void 0 && (r = `${e}Z`), n.length === e.length)
        return `1970-01-01T${r}`;
      let s = t.index - 1;
      return r[s] === " " && (r = `${r.slice(0, s)}T${r.slice(s + 1)}`), r;
    }
    __name(Kc, "Kc");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function zc(e) {
      let t = Object.entries(e);
      return t.length === 0 ? "" : (t.sort(([n], [i]) => n.localeCompare(i)), `/*${t.map(([n, i]) => {
        let o = encodeURIComponent(n), s = encodeURIComponent(i).replace(/'/g, "\\'");
        return `${o}='${s}'`;
      }).join(",")}*/`);
    }
    __name(zc, "zc");
    function Hr(e, t) {
      let r = {};
      for (let n of e) {
        let i = n(t);
        for (let [o, s] of Object.entries(i))
          s !== void 0 && (r[o] = s);
      }
      return r;
    }
    __name(Hr, "Hr");
    function Bs(e, t) {
      let r = Hr(e, t);
      return zc(r);
    }
    __name(Bs, "Bs");
    function js(e, t) {
      return t ? `${e} ${t}` : e;
    }
    __name(js, "js");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var Gt;
    (function(e) {
      e[e.INTERNAL = 0] = "INTERNAL", e[e.SERVER = 1] = "SERVER", e[e.CLIENT = 2] = "CLIENT", e[e.PRODUCER = 3] = "PRODUCER", e[e.CONSUMER = 4] = "CONSUMER";
    })(Gt || (Gt = {}));
    function Zc(e) {
      switch (e) {
        case "postgresql":
        case "postgres":
        case "prisma+postgres":
          return "postgresql";
        case "sqlserver":
          return "mssql";
        case "mysql":
        case "sqlite":
        case "cockroachdb":
        case "mongodb":
          return e;
        default:
          L(e, `Unknown provider: ${e}`);
      }
    }
    __name(Zc, "Zc");
    async function Jr({ query: e, tracingHelper: t, provider: r, onQuery: n, execute: i }) {
      return await t.runInChildSpan({ name: "db_query", kind: Gt.CLIENT, attributes: { "db.query.text": e.sql, "db.system.name": Zc(r) } }, async () => {
        let o = /* @__PURE__ */ new Date(), s = w.now(), a = await i(), d = w.now();
        return n?.({ timestamp: o, duration: d - s, query: e.sql, params: e.args }), a;
      });
    }
    __name(Jr, "Jr");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function He(e, t) {
      var r = "000000000" + e;
      return r.substr(r.length - t);
    }
    __name(He, "He");
    var Qs = Ue(ho(), 1);
    function Yc() {
      try {
        return Qs.default.hostname();
      } catch {
        return g.env._CLUSTER_NETWORK_NAME_ || g.env.COMPUTERNAME || "hostname";
      }
    }
    __name(Yc, "Yc");
    var Hs = 2;
    var Xc = He(g.pid.toString(36), Hs);
    var Js = Yc();
    var ep = Js.length;
    var tp = He(Js.split("").reduce(function(e, t) {
      return +e + t.charCodeAt(0);
    }, +ep + 36).toString(36), Hs);
    function Xn() {
      return Xc + tp;
    }
    __name(Xn, "Xn");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function Wr(e) {
      return typeof e == "string" && /^c[a-z0-9]{20,32}$/.test(e);
    }
    __name(Wr, "Wr");
    function ei(e) {
      let n = Math.pow(36, 4), i = 0;
      function o() {
        return He((Math.random() * n << 0).toString(36), 4);
      }
      __name(o, "o");
      function s() {
        return i = i < n ? i : 0, i++, i - 1;
      }
      __name(s, "s");
      function a() {
        var d = "c", f = (/* @__PURE__ */ new Date()).getTime().toString(36), P = He(s().toString(36), 4), v = e(), S = o() + o();
        return d + f + P + v + S;
      }
      __name(a, "a");
      return a.fingerprint = e, a.isCuid = Wr, a;
    }
    __name(ei, "ei");
    var rp = ei(Xn);
    var Ws = rp;
    var Qa = Ue(Fa());
    l();
    u();
    c();
    p();
    m();
    Be();
    l();
    u();
    c();
    p();
    m();
    var Ua = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
    var Bp = 128;
    var We;
    var xt;
    function jp(e) {
      !We || We.length < e ? (We = y.allocUnsafe(e * Bp), kt.getRandomValues(We), xt = 0) : xt + e > We.length && (kt.getRandomValues(We), xt = 0), xt += e;
    }
    __name(jp, "jp");
    function ui(e = 21) {
      jp(e |= 0);
      let t = "";
      for (let r = xt - e; r < xt; r++)
        t += Ua[We[r] & 63];
      return t;
    }
    __name(ui, "ui");
    l();
    u();
    c();
    p();
    m();
    Be();
    var qa = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    var er = 32;
    var Qp = 16;
    var Va = 10;
    var $a = 281474976710655;
    var Ge;
    (function(e) {
      e.Base32IncorrectEncoding = "B32_ENC_INVALID", e.DecodeTimeInvalidCharacter = "DEC_TIME_CHAR", e.DecodeTimeValueMalformed = "DEC_TIME_MALFORMED", e.EncodeTimeNegative = "ENC_TIME_NEG", e.EncodeTimeSizeExceeded = "ENC_TIME_SIZE_EXCEED", e.EncodeTimeValueMalformed = "ENC_TIME_MALFORMED", e.PRNGDetectFailure = "PRNG_DETECT", e.ULIDInvalid = "ULID_INVALID", e.Unexpected = "UNEXPECTED", e.UUIDInvalid = "UUID_INVALID";
    })(Ge || (Ge = {}));
    var Ke = /* @__PURE__ */ __name(class extends Error {
      constructor(t, r) {
        super(`${r} (${t})`), this.name = "ULIDError", this.code = t;
      }
    }, "Ke");
    function Hp(e) {
      let t = Math.floor(e() * er);
      return t === er && (t = er - 1), qa.charAt(t);
    }
    __name(Hp, "Hp");
    function Jp(e) {
      let t = Wp(), r = t && (t.crypto || t.msCrypto) || (typeof rt < "u" ? rt : null);
      if (typeof r?.getRandomValues == "function")
        return () => {
          let n = new Uint8Array(1);
          return r.getRandomValues(n), n[0] / 255;
        };
      if (typeof r?.randomBytes == "function")
        return () => r.randomBytes(1).readUInt8() / 255;
      if (rt?.randomBytes)
        return () => rt.randomBytes(1).readUInt8() / 255;
      throw new Ke(Ge.PRNGDetectFailure, "Failed to find a reliable PRNG");
    }
    __name(Jp, "Jp");
    function Wp() {
      return zp() ? self : typeof window < "u" ? window : typeof globalThis < "u" || typeof globalThis < "u" ? globalThis : null;
    }
    __name(Wp, "Wp");
    function Gp(e, t) {
      let r = "";
      for (; e > 0; e--)
        r = Hp(t) + r;
      return r;
    }
    __name(Gp, "Gp");
    function Kp(e, t = Va) {
      if (isNaN(e))
        throw new Ke(Ge.EncodeTimeValueMalformed, `Time must be a number: ${e}`);
      if (e > $a)
        throw new Ke(Ge.EncodeTimeSizeExceeded, `Cannot encode a time larger than ${$a}: ${e}`);
      if (e < 0)
        throw new Ke(Ge.EncodeTimeNegative, `Time must be positive: ${e}`);
      if (Number.isInteger(e) === false)
        throw new Ke(Ge.EncodeTimeValueMalformed, `Time must be an integer: ${e}`);
      let r, n = "";
      for (let i = t; i > 0; i--)
        r = e % er, n = qa.charAt(r) + n, e = (e - r) / er;
      return n;
    }
    __name(Kp, "Kp");
    function zp() {
      return typeof WorkerGlobalScope < "u" && self instanceof WorkerGlobalScope;
    }
    __name(zp, "zp");
    function Ba(e, t) {
      let r = t || Jp(), n = !e || isNaN(e) ? Date.now() : e;
      return Kp(n, Va) + Gp(Qp, r);
    }
    __name(Ba, "Ba");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var Z = [];
    for (let e = 0; e < 256; ++e)
      Z.push((e + 256).toString(16).slice(1));
    function Zr(e, t = 0) {
      return (Z[e[t + 0]] + Z[e[t + 1]] + Z[e[t + 2]] + Z[e[t + 3]] + "-" + Z[e[t + 4]] + Z[e[t + 5]] + "-" + Z[e[t + 6]] + Z[e[t + 7]] + "-" + Z[e[t + 8]] + Z[e[t + 9]] + "-" + Z[e[t + 10]] + Z[e[t + 11]] + Z[e[t + 12]] + Z[e[t + 13]] + Z[e[t + 14]] + Z[e[t + 15]]).toLowerCase();
    }
    __name(Zr, "Zr");
    l();
    u();
    c();
    p();
    m();
    Be();
    var Xr = new Uint8Array(256);
    var Yr = Xr.length;
    function Et() {
      return Yr > Xr.length - 16 && (wr(Xr), Yr = 0), Xr.slice(Yr, Yr += 16);
    }
    __name(Et, "Et");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    Be();
    var ci = { randomUUID: hr };
    function Zp(e, t, r) {
      if (ci.randomUUID && !t && !e)
        return ci.randomUUID();
      e = e || {};
      let n = e.random ?? e.rng?.() ?? Et();
      if (n.length < 16)
        throw new Error("Random bytes length must be >= 16");
      if (n[6] = n[6] & 15 | 64, n[8] = n[8] & 63 | 128, t) {
        if (r = r || 0, r < 0 || r + 16 > t.length)
          throw new RangeError(`UUID byte range ${r}:${r + 15} is out of buffer bounds`);
        for (let i = 0; i < 16; ++i)
          t[r + i] = n[i];
        return t;
      }
      return Zr(n);
    }
    __name(Zp, "Zp");
    var pi = Zp;
    l();
    u();
    c();
    p();
    m();
    var mi = {};
    function Yp(e, t, r) {
      let n;
      if (e)
        n = ja(e.random ?? e.rng?.() ?? Et(), e.msecs, e.seq, t, r);
      else {
        let i = Date.now(), o = Et();
        Xp(mi, i, o), n = ja(o, mi.msecs, mi.seq, t, r);
      }
      return t ?? Zr(n);
    }
    __name(Yp, "Yp");
    function Xp(e, t, r) {
      return e.msecs ??= -1 / 0, e.seq ??= 0, t > e.msecs ? (e.seq = r[6] << 23 | r[7] << 16 | r[8] << 8 | r[9], e.msecs = t) : (e.seq = e.seq + 1 | 0, e.seq === 0 && e.msecs++), e;
    }
    __name(Xp, "Xp");
    function ja(e, t, r, n, i = 0) {
      if (e.length < 16)
        throw new Error("Random bytes length must be >= 16");
      if (!n)
        n = new Uint8Array(16), i = 0;
      else if (i < 0 || i + 16 > n.length)
        throw new RangeError(`UUID byte range ${i}:${i + 15} is out of buffer bounds`);
      return t ??= Date.now(), r ??= e[6] * 127 << 24 | e[7] << 16 | e[8] << 8 | e[9], n[i++] = t / 1099511627776 & 255, n[i++] = t / 4294967296 & 255, n[i++] = t / 16777216 & 255, n[i++] = t / 65536 & 255, n[i++] = t / 256 & 255, n[i++] = t & 255, n[i++] = 112 | r >>> 28 & 15, n[i++] = r >>> 20 & 255, n[i++] = 128 | r >>> 14 & 63, n[i++] = r >>> 6 & 255, n[i++] = r << 2 & 255 | e[10] & 3, n[i++] = e[11], n[i++] = e[12], n[i++] = e[13], n[i++] = e[14], n[i++] = e[15], n;
    }
    __name(ja, "ja");
    var di = Yp;
    var en = /* @__PURE__ */ __name(class {
      #t = {};
      constructor() {
        this.register("uuid", new gi()), this.register("cuid", new yi()), this.register("ulid", new hi()), this.register("nanoid", new wi()), this.register("product", new bi());
      }
      snapshot() {
        return Object.create(this.#t, { now: { value: new fi() } });
      }
      register(t, r) {
        this.#t[t] = r;
      }
    }, "en");
    var fi = /* @__PURE__ */ __name(class {
      #t = /* @__PURE__ */ new Date();
      generate() {
        return this.#t.toISOString();
      }
    }, "fi");
    var gi = /* @__PURE__ */ __name(class {
      generate(t) {
        if (t === 4)
          return pi();
        if (t === 7)
          return di();
        throw new Error("Invalid UUID generator arguments");
      }
    }, "gi");
    var yi = /* @__PURE__ */ __name(class {
      generate(t) {
        if (t === 1)
          return Ws();
        if (t === 2)
          return (0, Qa.createId)();
        throw new Error("Invalid CUID generator arguments");
      }
    }, "yi");
    var hi = /* @__PURE__ */ __name(class {
      generate() {
        return Ba();
      }
    }, "hi");
    var wi = /* @__PURE__ */ __name(class {
      generate(t) {
        if (typeof t == "number")
          return ui(t);
        if (t === void 0)
          return ui();
        throw new Error("Invalid Nanoid generator arguments");
      }
    }, "wi");
    var bi = /* @__PURE__ */ __name(class {
      generate(t, r) {
        if (t === void 0 || r === void 0)
          throw new Error("Invalid Product generator arguments");
        return Array.isArray(t) && Array.isArray(r) ? t.flatMap((n) => r.map((i) => [n, i])) : Array.isArray(t) ? t.map((n) => [n, r]) : Array.isArray(r) ? r.map((n) => [t, n]) : [[t, r]];
      }
    }, "bi");
    l();
    u();
    c();
    p();
    m();
    function tn(e, t) {
      return e == null ? e : typeof e == "string" ? tn(JSON.parse(e), t) : Array.isArray(e) ? tm(e, t) : em(e, t);
    }
    __name(tn, "tn");
    function em(e, t) {
      if (t.pagination) {
        let { skip: r, take: n, cursor: i } = t.pagination;
        if (r !== null && r > 0 || n === 0 || i !== null && !yt(e, i))
          return null;
      }
      return Ja(e, t.nested);
    }
    __name(em, "em");
    function Ja(e, t) {
      for (let [r, n] of Object.entries(t))
        e[r] = tn(e[r], n);
      return e;
    }
    __name(Ja, "Ja");
    function tm(e, t) {
      if (t.distinct !== null) {
        let r = t.linkingFields !== null ? [...t.distinct, ...t.linkingFields] : t.distinct;
        e = rm(e, r);
      }
      return t.pagination && (e = nm(e, t.pagination, t.linkingFields)), t.reverse && e.reverse(), Object.keys(t.nested).length === 0 ? e : e.map((r) => Ja(r, t.nested));
    }
    __name(tm, "tm");
    function rm(e, t) {
      let r = /* @__PURE__ */ new Set(), n = [];
      for (let i of e) {
        let o = Tt(i, t);
        r.has(o) || (r.add(o), n.push(i));
      }
      return n;
    }
    __name(rm, "rm");
    function nm(e, t, r) {
      if (r === null)
        return Ha(e, t);
      let n = /* @__PURE__ */ new Map();
      for (let o of e) {
        let s = Tt(o, r);
        n.has(s) || n.set(s, []), n.get(s).push(o);
      }
      let i = Array.from(n.entries());
      return i.sort(([o], [s]) => o < s ? -1 : o > s ? 1 : 0), i.flatMap(([, o]) => Ha(o, t));
    }
    __name(nm, "nm");
    function Ha(e, { cursor: t, skip: r, take: n }) {
      let i = t !== null ? e.findIndex((a) => yt(a, t)) : 0;
      if (i === -1)
        return [];
      let o = i + (r ?? 0), s = n !== null ? o + n : e.length;
      return e.slice(o, s);
    }
    __name(Ha, "Ha");
    function Tt(e, t) {
      return JSON.stringify(t.map((r) => e[r]));
    }
    __name(Tt, "Tt");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function xi(e) {
      return typeof e == "object" && e !== null && e.prisma__type === "param";
    }
    __name(xi, "xi");
    function Ei(e) {
      return typeof e == "object" && e !== null && e.prisma__type === "generatorCall";
    }
    __name(Ei, "Ei");
    function vi(e, t, r, n) {
      let i = e.args.map((o) => me(o, t, r));
      switch (e.type) {
        case "rawSql":
          return [sm(e.sql, i, e.argTypes)];
        case "templateSql":
          return (e.chunkable ? lm(e.fragments, i, n) : [i]).map((s) => {
            if (n !== void 0 && s.length > n)
              throw new z("The query parameter limit supported by your database is exceeded.", "P2029");
            return im(e.fragments, e.placeholderFormat, s, e.argTypes);
          });
        default:
          L(e.type, "Invalid query type");
      }
    }
    __name(vi, "vi");
    function me(e, t, r) {
      for (; am(e); )
        if (xi(e)) {
          let n = t[e.prisma__value.name];
          if (n === void 0)
            throw new Error(`Missing value for query variable ${e.prisma__value.name}`);
          e = n;
        } else if (Ei(e)) {
          let { name: n, args: i } = e.prisma__value, o = r[n];
          if (!o)
            throw new Error(`Encountered an unknown generator '${n}'`);
          e = o.generate(...i.map((s) => me(s, t, r)));
        } else
          L(e, `Unexpected unevaluated value type: ${e}`);
      return Array.isArray(e) && (e = e.map((n) => me(n, t, r))), e;
    }
    __name(me, "me");
    function im(e, t, r, n) {
      let i = "", o = { placeholderNumber: 1 }, s = [], a = [];
      for (let d of Pi(e, r, n)) {
        if (i += om(d, t, o), d.type === "stringChunk")
          continue;
        let f = s.length, P = s.push(...Wa(d)) - f;
        if (d.argType.arity === "tuple") {
          if (P % d.argType.elements.length !== 0)
            throw new Error(`Malformed query template. Expected the number of parameters to match the tuple arity, but got ${P} parameters for a tuple of arity ${d.argType.elements.length}.`);
          for (let v = 0; v < P / d.argType.elements.length; v++)
            a.push(...d.argType.elements);
        } else
          for (let v = 0; v < P; v++)
            a.push(d.argType);
      }
      return { sql: i, args: s, argTypes: a };
    }
    __name(im, "im");
    function om(e, t, r) {
      let n = e.type;
      switch (n) {
        case "parameter":
          return Ti(t, r.placeholderNumber++);
        case "stringChunk":
          return e.chunk;
        case "parameterTuple":
          return `(${e.value.length == 0 ? "NULL" : e.value.map(() => Ti(t, r.placeholderNumber++)).join(",")})`;
        case "parameterTupleList":
          return e.value.map((i) => {
            let o = i.map(() => Ti(t, r.placeholderNumber++)).join(e.itemSeparator);
            return `${e.itemPrefix}${o}${e.itemSuffix}`;
          }).join(e.groupSeparator);
        default:
          L(n, "Invalid fragment type");
      }
    }
    __name(om, "om");
    function Ti(e, t) {
      return e.hasNumbering ? `${e.prefix}${t}` : e.prefix;
    }
    __name(Ti, "Ti");
    function sm(e, t, r) {
      return { sql: e, args: t, argTypes: r };
    }
    __name(sm, "sm");
    function am(e) {
      return xi(e) || Ei(e);
    }
    __name(am, "am");
    function* Pi(e, t, r) {
      let n = 0;
      for (let i of e)
        switch (i.type) {
          case "parameter": {
            if (n >= t.length)
              throw new Error(`Malformed query template. Fragments attempt to read over ${t.length} parameters.`);
            yield { ...i, value: t[n], argType: r?.[n] }, n++;
            break;
          }
          case "stringChunk": {
            yield i;
            break;
          }
          case "parameterTuple": {
            if (n >= t.length)
              throw new Error(`Malformed query template. Fragments attempt to read over ${t.length} parameters.`);
            let o = t[n];
            yield { ...i, value: Array.isArray(o) ? o : [o], argType: r?.[n] }, n++;
            break;
          }
          case "parameterTupleList": {
            if (n >= t.length)
              throw new Error(`Malformed query template. Fragments attempt to read over ${t.length} parameters.`);
            let o = t[n];
            if (!Array.isArray(o))
              throw new Error("Malformed query template. Tuple list expected.");
            if (o.length === 0)
              throw new Error("Malformed query template. Tuple list cannot be empty.");
            for (let s of o)
              if (!Array.isArray(s))
                throw new Error("Malformed query template. Tuple expected.");
            yield { ...i, value: o, argType: r?.[n] }, n++;
            break;
          }
        }
    }
    __name(Pi, "Pi");
    function* Wa(e) {
      switch (e.type) {
        case "parameter":
          yield e.value;
          break;
        case "stringChunk":
          break;
        case "parameterTuple":
          yield* e.value;
          break;
        case "parameterTupleList":
          for (let t of e.value)
            yield* t;
          break;
      }
    }
    __name(Wa, "Wa");
    function lm(e, t, r) {
      let n = 0, i = 0;
      for (let s of Pi(e, t, void 0)) {
        let a = 0;
        for (let d of Wa(s))
          a++;
        i = Math.max(i, a), n += a;
      }
      let o = [[]];
      for (let s of Pi(e, t, void 0))
        switch (s.type) {
          case "parameter": {
            for (let a of o)
              a.push(s.value);
            break;
          }
          case "stringChunk":
            break;
          case "parameterTuple": {
            let a = s.value.length, d = [];
            if (r && o.length === 1 && a === i && n > r && n - a < r) {
              let f = r - (n - a);
              d = um(s.value, f);
            } else
              d = [s.value];
            o = o.flatMap((f) => d.map((P) => [...f, P]));
            break;
          }
          case "parameterTupleList": {
            let a = s.value.reduce((v, S) => v + S.length, 0), d = [], f = [], P = 0;
            for (let v of s.value)
              r && o.length === 1 && a === i && f.length > 0 && n - a + P + v.length > r && (d.push(f), f = [], P = 0), f.push(v), P += v.length;
            f.length > 0 && d.push(f), o = o.flatMap((v) => d.map((S) => [...v, S]));
            break;
          }
        }
      return o;
    }
    __name(lm, "lm");
    function um(e, t) {
      let r = [];
      for (let n = 0; n < e.length; n += t)
        r.push(e.slice(n, n + t));
      return r;
    }
    __name(um, "um");
    l();
    u();
    c();
    p();
    m();
    function Ga(e) {
      return e.rows.map((t) => t.reduce((r, n, i) => (r[e.columnNames[i]] = n, r), {}));
    }
    __name(Ga, "Ga");
    function Ka(e) {
      return { columns: e.columnNames, types: e.columnTypes.map((t) => cm(t)), rows: e.rows.map((t) => t.map((r, n) => tr(r, e.columnTypes[n]))) };
    }
    __name(Ka, "Ka");
    function tr(e, t) {
      if (e === null)
        return null;
      switch (t) {
        case I.Int32:
          switch (typeof e) {
            case "number":
              return Math.trunc(e);
            case "string":
              return Math.trunc(Number(e));
            default:
              throw new Error(`Cannot serialize value of type ${typeof e} as Int32`);
          }
        case I.Int32Array:
          if (!Array.isArray(e))
            throw new Error(`Cannot serialize value of type ${typeof e} as Int32Array`);
          return e.map((r) => tr(r, I.Int32));
        case I.Int64:
          switch (typeof e) {
            case "number":
              return BigInt(Math.trunc(e));
            case "string":
              return e;
            default:
              throw new Error(`Cannot serialize value of type ${typeof e} as Int64`);
          }
        case I.Int64Array:
          if (!Array.isArray(e))
            throw new Error(`Cannot serialize value of type ${typeof e} as Int64Array`);
          return e.map((r) => tr(r, I.Int64));
        case I.Json:
          switch (typeof e) {
            case "string":
              return JSON.parse(e);
            default:
              throw new Error(`Cannot serialize value of type ${typeof e} as Json`);
          }
        case I.JsonArray:
          if (!Array.isArray(e))
            throw new Error(`Cannot serialize value of type ${typeof e} as JsonArray`);
          return e.map((r) => tr(r, I.Json));
        case I.Boolean:
          switch (typeof e) {
            case "boolean":
              return e;
            case "string":
              return e === "true" || e === "1";
            case "number":
              return e === 1;
            default:
              throw new Error(`Cannot serialize value of type ${typeof e} as Boolean`);
          }
        case I.BooleanArray:
          if (!Array.isArray(e))
            throw new Error(`Cannot serialize value of type ${typeof e} as BooleanArray`);
          return e.map((r) => tr(r, I.Boolean));
        default:
          return e;
      }
    }
    __name(tr, "tr");
    function cm(e) {
      switch (e) {
        case I.Int32:
          return "int";
        case I.Int64:
          return "bigint";
        case I.Float:
          return "float";
        case I.Double:
          return "double";
        case I.Text:
          return "string";
        case I.Enum:
          return "enum";
        case I.Bytes:
          return "bytes";
        case I.Boolean:
          return "bool";
        case I.Character:
          return "char";
        case I.Numeric:
          return "decimal";
        case I.Json:
          return "json";
        case I.Uuid:
          return "uuid";
        case I.DateTime:
          return "datetime";
        case I.Date:
          return "date";
        case I.Time:
          return "time";
        case I.Int32Array:
          return "int-array";
        case I.Int64Array:
          return "bigint-array";
        case I.FloatArray:
          return "float-array";
        case I.DoubleArray:
          return "double-array";
        case I.TextArray:
          return "string-array";
        case I.EnumArray:
          return "string-array";
        case I.BytesArray:
          return "bytes-array";
        case I.BooleanArray:
          return "bool-array";
        case I.CharacterArray:
          return "char-array";
        case I.NumericArray:
          return "decimal-array";
        case I.JsonArray:
          return "json-array";
        case I.UuidArray:
          return "uuid-array";
        case I.DateTimeArray:
          return "datetime-array";
        case I.DateArray:
          return "date-array";
        case I.TimeArray:
          return "time-array";
        case I.UnknownNumber:
          return "unknown";
        case I.Set:
          return "string";
        default:
          L(e, `Unexpected column type: ${e}`);
      }
    }
    __name(cm, "cm");
    l();
    u();
    c();
    p();
    m();
    function za(e, t, r) {
      if (!t.every((n) => Ai(e, n))) {
        let n = pm(e, r), i = mm(r);
        throw new z(n, i, r.context);
      }
    }
    __name(za, "za");
    function Ai(e, t) {
      switch (t.type) {
        case "rowCountEq":
          return Array.isArray(e) ? e.length === t.args : e === null ? t.args === 0 : t.args === 1;
        case "rowCountNeq":
          return Array.isArray(e) ? e.length !== t.args : e === null ? t.args !== 0 : t.args !== 1;
        case "affectedRowCountEq":
          return e === t.args;
        case "never":
          return false;
        default:
          L(t, `Unknown rule type: ${t.type}`);
      }
    }
    __name(Ai, "Ai");
    function pm(e, t) {
      switch (t.error_identifier) {
        case "RELATION_VIOLATION":
          return `The change you are trying to make would violate the required relation '${t.context.relation}' between the \`${t.context.modelA}\` and \`${t.context.modelB}\` models.`;
        case "MISSING_RECORD":
          return `An operation failed because it depends on one or more records that were required but not found. No record was found for ${t.context.operation}.`;
        case "MISSING_RELATED_RECORD": {
          let r = t.context.neededFor ? ` (needed to ${t.context.neededFor})` : "";
          return `An operation failed because it depends on one or more records that were required but not found. No '${t.context.model}' record${r} was found for ${t.context.operation} on ${t.context.relationType} relation '${t.context.relation}'.`;
        }
        case "INCOMPLETE_CONNECT_INPUT":
          return `An operation failed because it depends on one or more records that were required but not found. Expected ${t.context.expectedRows} records to be connected, found only ${Array.isArray(e) ? e.length : e}.`;
        case "INCOMPLETE_CONNECT_OUTPUT":
          return `The required connected records were not found. Expected ${t.context.expectedRows} records to be connected after connect operation on ${t.context.relationType} relation '${t.context.relation}', found ${Array.isArray(e) ? e.length : e}.`;
        case "RECORDS_NOT_CONNECTED":
          return `The records for relation \`${t.context.relation}\` between the \`${t.context.parent}\` and \`${t.context.child}\` models are not connected.`;
        default:
          L(t, `Unknown error identifier: ${t}`);
      }
    }
    __name(pm, "pm");
    function mm(e) {
      switch (e.error_identifier) {
        case "RELATION_VIOLATION":
          return "P2014";
        case "RECORDS_NOT_CONNECTED":
          return "P2017";
        case "INCOMPLETE_CONNECT_OUTPUT":
          return "P2018";
        case "MISSING_RECORD":
        case "MISSING_RELATED_RECORD":
        case "INCOMPLETE_CONNECT_INPUT":
          return "P2025";
        default:
          L(e, `Unknown error identifier: ${e}`);
      }
    }
    __name(mm, "mm");
    var rr = /* @__PURE__ */ __name(class e {
      #t;
      #e;
      #r;
      #n = new en();
      #l;
      #i;
      #s;
      #o;
      #u;
      #a;
      constructor({ transactionManager: t, placeholderValues: r, onQuery: n, tracingHelper: i, serializer: o, rawSerializer: s, provider: a, connectionInfo: d, sqlCommenter: f }) {
        this.#t = t, this.#e = r, this.#r = n, this.#l = i, this.#i = o, this.#s = s ?? o, this.#o = a, this.#u = d, this.#a = f;
      }
      static forSql(t) {
        return new e({ transactionManager: t.transactionManager, placeholderValues: t.placeholderValues, onQuery: t.onQuery, tracingHelper: t.tracingHelper, serializer: Ga, rawSerializer: Ka, provider: t.provider, connectionInfo: t.connectionInfo, sqlCommenter: t.sqlCommenter });
      }
      async run(t, r) {
        let { value: n } = await this.interpretNode(t, r, this.#e, this.#n.snapshot()).catch((i) => ht(i));
        return n;
      }
      async interpretNode(t, r, n, i) {
        switch (t.type) {
          case "value":
            return { value: me(t.args, n, i) };
          case "seq": {
            let o;
            for (let s of t.args)
              o = await this.interpretNode(s, r, n, i);
            return o ?? { value: void 0 };
          }
          case "get":
            return { value: n[t.args.name] };
          case "let": {
            let o = Object.create(n);
            for (let s of t.args.bindings) {
              let { value: a } = await this.interpretNode(s.expr, r, o, i);
              o[s.name] = a;
            }
            return this.interpretNode(t.args.expr, r, o, i);
          }
          case "getFirstNonEmpty": {
            for (let o of t.args.names) {
              let s = n[o];
              if (!Za(s))
                return { value: s };
            }
            return { value: [] };
          }
          case "concat": {
            let o = await Promise.all(t.args.map((s) => this.interpretNode(s, r, n, i).then((a) => a.value)));
            return { value: o.length > 0 ? o.reduce((s, a) => s.concat(Ci(a)), []) : [] };
          }
          case "sum": {
            let o = await Promise.all(t.args.map((s) => this.interpretNode(s, r, n, i).then((a) => a.value)));
            return { value: o.length > 0 ? o.reduce((s, a) => Ee(s) + Ee(a)) : 0 };
          }
          case "execute": {
            let o = vi(t.args, n, i, this.#c()), s = 0;
            for (let a of o) {
              let d = this.#d(a);
              s += await this.#m(d, r, () => r.executeRaw(d).catch((f) => t.args.type === "rawSql" ? zn(f) : ht(f)));
            }
            return { value: s };
          }
          case "query": {
            let o = vi(t.args, n, i, this.#c()), s;
            for (let a of o) {
              let d = this.#d(a), f = await this.#m(d, r, () => r.queryRaw(d).catch((P) => t.args.type === "rawSql" ? zn(P) : ht(P)));
              s === void 0 ? s = f : (s.rows.push(...f.rows), s.lastInsertId = f.lastInsertId);
            }
            return { value: t.args.type === "rawSql" ? this.#s(s) : this.#i(s), lastInsertId: s?.lastInsertId };
          }
          case "reverse": {
            let { value: o, lastInsertId: s } = await this.interpretNode(t.args, r, n, i);
            return { value: Array.isArray(o) ? o.reverse() : o, lastInsertId: s };
          }
          case "unique": {
            let { value: o, lastInsertId: s } = await this.interpretNode(t.args, r, n, i);
            if (!Array.isArray(o))
              return { value: o, lastInsertId: s };
            if (o.length > 1)
              throw new Error(`Expected zero or one element, got ${o.length}`);
            return { value: o[0] ?? null, lastInsertId: s };
          }
          case "required": {
            let { value: o, lastInsertId: s } = await this.interpretNode(t.args, r, n, i);
            if (Za(o))
              throw new Error("Required value is empty");
            return { value: o, lastInsertId: s };
          }
          case "mapField": {
            let { value: o, lastInsertId: s } = await this.interpretNode(t.args.records, r, n, i);
            return { value: Ya(o, t.args.field), lastInsertId: s };
          }
          case "join": {
            let { value: o, lastInsertId: s } = await this.interpretNode(t.args.parent, r, n, i);
            if (o === null)
              return { value: null, lastInsertId: s };
            let a = await Promise.all(t.args.children.map(async (d) => ({ joinExpr: d, childRecords: (await this.interpretNode(d.child, r, n, i)).value })));
            return { value: dm4(o, a), lastInsertId: s };
          }
          case "transaction": {
            if (!this.#t.enabled)
              return this.interpretNode(t.args, r, n, i);
            let o = this.#t.manager, s = await o.startInternalTransaction(), a = await o.getTransaction(s, "query");
            try {
              let d = await this.interpretNode(t.args, a, n, i);
              return await o.commitTransaction(s.id), d;
            } catch (d) {
              throw await o.rollbackTransaction(s.id), d;
            }
          }
          case "dataMap": {
            let { value: o, lastInsertId: s } = await this.interpretNode(t.args.expr, r, n, i);
            return { value: Vs(o, t.args.structure, t.args.enums), lastInsertId: s };
          }
          case "validate": {
            let { value: o, lastInsertId: s } = await this.interpretNode(t.args.expr, r, n, i);
            return za(o, t.args.rules, t.args), { value: o, lastInsertId: s };
          }
          case "if": {
            let { value: o } = await this.interpretNode(t.args.value, r, n, i);
            return Ai(o, t.args.rule) ? await this.interpretNode(t.args.then, r, n, i) : await this.interpretNode(t.args.else, r, n, i);
          }
          case "unit":
            return { value: void 0 };
          case "diff": {
            let { value: o } = await this.interpretNode(t.args.from, r, n, i), { value: s } = await this.interpretNode(t.args.to, r, n, i), a = /* @__PURE__ */ __name((f) => f !== null ? Tt(rn(f), t.args.fields) : null, "a"), d = new Set(Ci(s).map(a));
            return { value: Ci(o).filter((f) => !d.has(a(f))) };
          }
          case "process": {
            let { value: o, lastInsertId: s } = await this.interpretNode(t.args.expr, r, n, i);
            return { value: tn(o, t.args.operations), lastInsertId: s };
          }
          case "initializeRecord": {
            let { lastInsertId: o } = await this.interpretNode(t.args.expr, r, n, i), s = {};
            for (let [a, d] of Object.entries(t.args.fields))
              s[a] = fm(d, o, n, i);
            return { value: s, lastInsertId: o };
          }
          case "mapRecord": {
            let { value: o, lastInsertId: s } = await this.interpretNode(t.args.expr, r, n, i), a = o === null ? {} : rn(o);
            for (let [d, f] of Object.entries(t.args.fields))
              a[d] = gm(f, a[d], n, i);
            return { value: a, lastInsertId: s };
          }
          default:
            L(t, `Unexpected node type: ${t.type}`);
        }
      }
      #c() {
        return this.#u?.maxBindValues !== void 0 ? this.#u.maxBindValues : this.#p();
      }
      #p() {
        if (this.#o !== void 0)
          switch (this.#o) {
            case "cockroachdb":
            case "postgres":
            case "postgresql":
            case "prisma+postgres":
              return 32766;
            case "mysql":
              return 65535;
            case "sqlite":
              return 999;
            case "sqlserver":
              return 2098;
            case "mongodb":
              return;
            default:
              L(this.#o, `Unexpected provider: ${this.#o}`);
          }
      }
      #m(t, r, n) {
        return Jr({ query: t, execute: n, provider: this.#o ?? r.provider, tracingHelper: this.#l, onQuery: this.#r });
      }
      #d(t) {
        if (!this.#a || this.#a.plugins.length === 0)
          return t;
        let r = Bs(this.#a.plugins, { query: this.#a.queryInfo, sql: t.sql });
        return r ? { ...t, sql: js(t.sql, r) } : t;
      }
    }, "e");
    function Za(e) {
      return Array.isArray(e) ? e.length === 0 : e == null;
    }
    __name(Za, "Za");
    function Ci(e) {
      return Array.isArray(e) ? e : [e];
    }
    __name(Ci, "Ci");
    function Ee(e) {
      if (typeof e == "number")
        return e;
      if (typeof e == "string")
        return Number(e);
      throw new Error(`Expected number, got ${typeof e}`);
    }
    __name(Ee, "Ee");
    function rn(e) {
      if (typeof e == "object" && e !== null)
        return e;
      throw new Error(`Expected object, got ${typeof e}`);
    }
    __name(rn, "rn");
    function Ya(e, t) {
      return Array.isArray(e) ? e.map((r) => Ya(r, t)) : typeof e == "object" && e !== null ? e[t] ?? null : e;
    }
    __name(Ya, "Ya");
    function dm4(e, t) {
      for (let { joinExpr: r, childRecords: n } of t) {
        let i = r.on.map(([a]) => a), o = r.on.map(([, a]) => a), s = {};
        for (let a of Array.isArray(e) ? e : [e]) {
          let d = rn(a), f = Tt(d, i);
          s[f] || (s[f] = []), s[f].push(d), r.isRelationUnique ? d[r.parentField] = null : d[r.parentField] = [];
        }
        for (let a of Array.isArray(n) ? n : [n]) {
          if (a === null)
            continue;
          let d = Tt(rn(a), o);
          for (let f of s[d] ?? [])
            r.isRelationUnique ? f[r.parentField] = a : f[r.parentField].push(a);
        }
      }
      return e;
    }
    __name(dm4, "dm");
    function fm(e, t, r, n) {
      switch (e.type) {
        case "value":
          return me(e.value, r, n);
        case "lastInsertId":
          return t;
        default:
          L(e, `Unexpected field initializer type: ${e.type}`);
      }
    }
    __name(fm, "fm");
    function gm(e, t, r, n) {
      switch (e.type) {
        case "set":
          return me(e.value, r, n);
        case "add":
          return Ee(t) + Ee(me(e.value, r, n));
        case "subtract":
          return Ee(t) - Ee(me(e.value, r, n));
        case "multiply":
          return Ee(t) * Ee(me(e.value, r, n));
        case "divide": {
          let i = Ee(t), o = Ee(me(e.value, r, n));
          return o === 0 ? null : i / o;
        }
        default:
          L(e, `Unexpected field operation type: ${e.type}`);
      }
    }
    __name(gm, "gm");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    async function ym() {
      return globalThis.crypto ?? await Promise.resolve().then(() => (Be(), In));
    }
    __name(ym, "ym");
    async function Xa() {
      return (await ym()).randomUUID();
    }
    __name(Xa, "Xa");
    l();
    u();
    c();
    p();
    m();
    async function el(e, t) {
      return new Promise((r) => {
        e.addEventListener(t, r, { once: true });
      });
    }
    __name(el, "el");
    l();
    u();
    c();
    p();
    m();
    var ue = /* @__PURE__ */ __name(class extends z {
      name = "TransactionManagerError";
      constructor(t, r) {
        super("Transaction API error: " + t, "P2028", r);
      }
    }, "ue");
    var nr = /* @__PURE__ */ __name(class extends ue {
      constructor() {
        super("Transaction not found. Transaction ID is invalid, refers to an old closed transaction Prisma doesn't have information about anymore, or was obtained before disconnecting.");
      }
    }, "nr");
    var nn = /* @__PURE__ */ __name(class extends ue {
      constructor(t) {
        super(`Transaction already closed: A ${t} cannot be executed on a committed transaction.`);
      }
    }, "nn");
    var on2 = /* @__PURE__ */ __name(class extends ue {
      constructor(t) {
        super(`Transaction already closed: A ${t} cannot be executed on a transaction that was rolled back.`);
      }
    }, "on");
    var sn = /* @__PURE__ */ __name(class extends ue {
      constructor() {
        super("Unable to start a transaction in the given time.");
      }
    }, "sn");
    var an = /* @__PURE__ */ __name(class extends ue {
      constructor(t, { timeout: r, timeTaken: n }) {
        super(`A ${t} cannot be executed on an expired transaction. The timeout for this transaction was ${r} ms, however ${n} ms passed since the start of the transaction. Consider increasing the interactive transaction timeout or doing less work in the transaction.`, { operation: t, timeout: r, timeTaken: n });
      }
    }, "an");
    var Pt = /* @__PURE__ */ __name(class extends ue {
      constructor(t) {
        super(`Internal Consistency Error: ${t}`);
      }
    }, "Pt");
    var ln = /* @__PURE__ */ __name(class extends ue {
      constructor(t) {
        super(`Invalid isolation level: ${t}`, { isolationLevel: t });
      }
    }, "ln");
    var hm = 100;
    var vt = X("prisma:client:transactionManager");
    var wm = /* @__PURE__ */ __name(() => ({ sql: "COMMIT", args: [], argTypes: [] }), "wm");
    var bm = /* @__PURE__ */ __name(() => ({ sql: "ROLLBACK", args: [], argTypes: [] }), "bm");
    var xm = /* @__PURE__ */ __name(() => ({ sql: '-- Implicit "COMMIT" query via underlying driver', args: [], argTypes: [] }), "xm");
    var Em = /* @__PURE__ */ __name(() => ({ sql: '-- Implicit "ROLLBACK" query via underlying driver', args: [], argTypes: [] }), "Em");
    var ir = /* @__PURE__ */ __name(class {
      transactions = /* @__PURE__ */ new Map();
      closedTransactions = [];
      driverAdapter;
      transactionOptions;
      tracingHelper;
      #t;
      #e;
      constructor({ driverAdapter: t, transactionOptions: r, tracingHelper: n, onQuery: i, provider: o }) {
        this.driverAdapter = t, this.transactionOptions = r, this.tracingHelper = n, this.#t = i, this.#e = o;
      }
      async startInternalTransaction(t) {
        let r = t !== void 0 ? this.#s(t) : {};
        return await this.tracingHelper.runInChildSpan("start_transaction", () => this.#r(r));
      }
      async startTransaction(t) {
        let r = t !== void 0 ? this.#s(t) : this.transactionOptions;
        return await this.tracingHelper.runInChildSpan("start_transaction", () => this.#r(r));
      }
      async #r(t) {
        let r = { id: await Xa(), status: "waiting", timer: void 0, timeout: t.timeout, startedAt: Date.now(), transaction: void 0 }, n = new AbortController(), i = tl(() => n.abort(), t.maxWait);
        i?.unref?.();
        let o = this.driverAdapter.startTransaction(t.isolationLevel).catch(ht);
        switch (r.transaction = await Promise.race([o.finally(() => clearTimeout(i)), el(n.signal, "abort").then(() => {
        })]), this.transactions.set(r.id, r), r.status) {
          case "waiting":
            if (n.signal.aborted)
              throw o.then((s) => s.rollback()).catch((s) => vt("error in discarded transaction:", s)), await this.#i(r, "timed_out"), new sn();
            return r.status = "running", r.timer = this.#l(r.id, t.timeout), { id: r.id };
          case "timed_out":
          case "running":
          case "committed":
          case "rolled_back":
            throw new Pt(`Transaction in invalid state ${r.status} although it just finished startup.`);
          default:
            L(r.status, "Unknown transaction status.");
        }
      }
      async commitTransaction(t) {
        return await this.tracingHelper.runInChildSpan("commit_transaction", async () => {
          let r = this.#n(t, "commit");
          await this.#i(r, "committed");
        });
      }
      async rollbackTransaction(t) {
        return await this.tracingHelper.runInChildSpan("rollback_transaction", async () => {
          let r = this.#n(t, "rollback");
          await this.#i(r, "rolled_back");
        });
      }
      async getTransaction(t, r) {
        let n = this.#n(t.id, r);
        if (n.status === "closing" && (await n.closing, n = this.#n(t.id, r)), !n.transaction)
          throw new nr();
        return n.transaction;
      }
      #n(t, r) {
        let n = this.transactions.get(t);
        if (!n) {
          let i = this.closedTransactions.find((o) => o.id === t);
          if (i)
            switch (vt("Transaction already closed.", { transactionId: t, status: i.status }), i.status) {
              case "closing":
              case "waiting":
              case "running":
                throw new Pt("Active transaction found in closed transactions list.");
              case "committed":
                throw new nn(r);
              case "rolled_back":
                throw new on2(r);
              case "timed_out":
                throw new an(r, { timeout: i.timeout, timeTaken: Date.now() - i.startedAt });
            }
          else
            throw vt("Transaction not found.", t), new nr();
        }
        if (["committed", "rolled_back", "timed_out"].includes(n.status))
          throw new Pt("Closed transaction found in active transactions map.");
        return n;
      }
      async cancelAllTransactions() {
        await Promise.allSettled([...this.transactions.values()].map((t) => this.#i(t, "rolled_back")));
      }
      #l(t, r) {
        let n = Date.now(), i = tl(async () => {
          vt("Transaction timed out.", { transactionId: t, timeoutStartedAt: n, timeout: r });
          let o = this.transactions.get(t);
          o && ["running", "waiting"].includes(o.status) ? await this.#i(o, "timed_out") : vt("Transaction already committed or rolled back when timeout happened.", t);
        }, r);
        return i?.unref?.(), i;
      }
      async #i(t, r) {
        let n = /* @__PURE__ */ __name(async () => {
          vt("Closing transaction.", { transactionId: t.id, status: r });
          try {
            if (t.transaction && r === "committed")
              if (t.transaction.options.usePhantomQuery)
                await this.#o(xm(), t.transaction, () => t.transaction.commit());
              else {
                let i = wm();
                await this.#o(i, t.transaction, () => t.transaction.executeRaw(i)).then(() => t.transaction.commit(), (o) => {
                  let s = /* @__PURE__ */ __name(() => Promise.reject(o), "s");
                  return t.transaction.rollback().then(s, s);
                });
              }
            else if (t.transaction)
              if (t.transaction.options.usePhantomQuery)
                await this.#o(Em(), t.transaction, () => t.transaction.rollback());
              else {
                let i = bm();
                try {
                  await this.#o(i, t.transaction, () => t.transaction.executeRaw(i));
                } finally {
                  await t.transaction.rollback();
                }
              }
          } finally {
            t.status = r, clearTimeout(t.timer), t.timer = void 0, this.transactions.delete(t.id), this.closedTransactions.push(t), this.closedTransactions.length > hm && this.closedTransactions.shift();
          }
        }, "n");
        t.status === "closing" ? (await t.closing, this.#n(t.id, r === "committed" ? "commit" : "rollback")) : await Object.assign(t, { status: "closing", reason: r, closing: n() }).closing;
      }
      #s(t) {
        if (!t.timeout)
          throw new ue("timeout is required");
        if (!t.maxWait)
          throw new ue("maxWait is required");
        if (t.isolationLevel === "SNAPSHOT")
          throw new ln(t.isolationLevel);
        return { ...t, timeout: t.timeout, maxWait: t.maxWait };
      }
      #o(t, r, n) {
        return Jr({ query: t, execute: n, provider: this.#e ?? r.provider, tracingHelper: this.tracingHelper, onQuery: this.#t });
      }
    }, "ir");
    function tl(e, t) {
      return t !== void 0 ? setTimeout(e, t) : void 0;
    }
    __name(tl, "tl");
    var Y = require_dist();
    var un = "7.2.0";
    l();
    u();
    c();
    p();
    m();
    function rl(e, t) {
      return { batch: e, transaction: t?.kind === "batch" ? { isolationLevel: t.options.isolationLevel } : void 0 };
    }
    __name(rl, "rl");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    function nl(e) {
      return e ? e.replace(/".*"/g, '"X"').replace(/[\s:\[]([+-]?([0-9]*[.])?[0-9]+)/g, (t) => `${t[0]}5`) : "";
    }
    __name(nl, "nl");
    l();
    u();
    c();
    p();
    m();
    function il(e) {
      return e.split(`
`).map((t) => t.replace(/^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z)\s*/, "").replace(/\+\d+\s*ms$/, "")).join(`
`);
    }
    __name(il, "il");
    l();
    u();
    c();
    p();
    m();
    var ol = Ue(Ao());
    function sl({ title: e, user: t = "prisma", repo: r = "prisma", template: n = "bug_report.yml", body: i }) {
      return (0, ol.default)({ user: t, repo: r, template: n, title: e, body: i });
    }
    __name(sl, "sl");
    function al({ version: e, binaryTarget: t, title: r, description: n, engineVersion: i, database: o, query: s }) {
      let a = fo(6e3 - (s?.length ?? 0)), d = il(nt(a)), f = n ? `# Description
\`\`\`
${n}
\`\`\`` : "", P = nt(`Hi Prisma Team! My Prisma Client just crashed. This is the report:
## Versions

| Name            | Version            |
|-----------------|--------------------|
| Node            | ${g.version?.padEnd(19)}| 
| OS              | ${t?.padEnd(19)}|
| Prisma Client   | ${e?.padEnd(19)}|
| Query Engine    | ${i?.padEnd(19)}|
| Database        | ${o?.padEnd(19)}|

${f}

## Logs
\`\`\`
${d}
\`\`\`

## Client Snippet
\`\`\`ts
// PLEASE FILL YOUR CODE SNIPPET HERE
\`\`\`

## Schema
\`\`\`prisma
// PLEASE ADD YOUR SCHEMA HERE IF POSSIBLE
\`\`\`

## Prisma Engine Query
\`\`\`
${s ? nl(s) : ""}
\`\`\`
`), v = sl({ title: r, body: P });
      return `${r}

This is a non-recoverable error which probably happens when the Prisma Query Engine has a panic.

${yr(v)}

If you want the Prisma team to look into it, please open the link above \u{1F64F}
To increase the chance of success, please post your schema and a snippet of
how you used Prisma Client in the issue. 
`;
    }
    __name(al, "al");
    l();
    u();
    c();
    p();
    m();
    var cn = /* @__PURE__ */ __name(class e {
      #t;
      #e;
      #r;
      #n;
      constructor(t, r, n) {
        this.#t = t, this.#e = r, this.#r = n, this.#n = r.getConnectionInfo?.();
      }
      static async connect(t) {
        let r, n;
        try {
          r = await t.driverAdapterFactory.connect(), n = new ir({ driverAdapter: r, transactionOptions: t.transactionOptions, tracingHelper: t.tracingHelper, onQuery: t.onQuery, provider: t.provider });
        } catch (i) {
          throw await r?.dispose(), i;
        }
        return new e(t, r, n);
      }
      getConnectionInfo() {
        let t = this.#n ?? { supportsRelationJoins: false };
        return Promise.resolve({ provider: this.#e.provider, connectionInfo: t });
      }
      async execute({ plan: t, placeholderValues: r, transaction: n, batchIndex: i, queryInfo: o }) {
        let s = n ? await this.#r.getTransaction(n, i !== void 0 ? "batch query" : "query") : this.#e;
        return await rr.forSql({ transactionManager: n ? { enabled: false } : { enabled: true, manager: this.#r }, placeholderValues: r, onQuery: this.#t.onQuery, tracingHelper: this.#t.tracingHelper, provider: this.#t.provider, connectionInfo: this.#n, sqlCommenter: this.#t.sqlCommenters && { plugins: this.#t.sqlCommenters, queryInfo: o } }).run(t, s);
      }
      async startTransaction(t) {
        return { ...await this.#r.startTransaction(t), payload: void 0 };
      }
      async commitTransaction(t) {
        await this.#r.commitTransaction(t.id);
      }
      async rollbackTransaction(t) {
        await this.#r.rollbackTransaction(t.id);
      }
      async disconnect() {
        try {
          await this.#r.cancelAllTransactions();
        } finally {
          await this.#e.dispose();
        }
      }
      apiKey() {
        return null;
      }
    }, "e");
    l();
    u();
    c();
    p();
    m();
    var dl = require_dist();
    l();
    u();
    c();
    p();
    m();
    var pn = /^[\u0009\u0020-\u007E\u0080-\u00FF]+$/;
    function ll(e, t, r) {
      let n = r || {}, i = n.encode || encodeURIComponent;
      if (typeof i != "function")
        throw new TypeError("option encode is invalid");
      if (!pn.test(e))
        throw new TypeError("argument name is invalid");
      let o = i(t);
      if (o && !pn.test(o))
        throw new TypeError("argument val is invalid");
      let s = e + "=" + o;
      if (n.maxAge !== void 0 && n.maxAge !== null) {
        let a = n.maxAge - 0;
        if (Number.isNaN(a) || !Number.isFinite(a))
          throw new TypeError("option maxAge is invalid");
        s += "; Max-Age=" + Math.floor(a);
      }
      if (n.domain) {
        if (!pn.test(n.domain))
          throw new TypeError("option domain is invalid");
        s += "; Domain=" + n.domain;
      }
      if (n.path) {
        if (!pn.test(n.path))
          throw new TypeError("option path is invalid");
        s += "; Path=" + n.path;
      }
      if (n.expires) {
        if (!Pm(n.expires) || Number.isNaN(n.expires.valueOf()))
          throw new TypeError("option expires is invalid");
        s += "; Expires=" + n.expires.toUTCString();
      }
      if (n.httpOnly && (s += "; HttpOnly"), n.secure && (s += "; Secure"), n.priority)
        switch (typeof n.priority == "string" ? n.priority.toLowerCase() : n.priority) {
          case "low": {
            s += "; Priority=Low";
            break;
          }
          case "medium": {
            s += "; Priority=Medium";
            break;
          }
          case "high": {
            s += "; Priority=High";
            break;
          }
          default:
            throw new TypeError("option priority is invalid");
        }
      if (n.sameSite)
        switch (typeof n.sameSite == "string" ? n.sameSite.toLowerCase() : n.sameSite) {
          case true: {
            s += "; SameSite=Strict";
            break;
          }
          case "lax": {
            s += "; SameSite=Lax";
            break;
          }
          case "strict": {
            s += "; SameSite=Strict";
            break;
          }
          case "none": {
            s += "; SameSite=None";
            break;
          }
          default:
            throw new TypeError("option sameSite is invalid");
        }
      return n.partitioned && (s += "; Partitioned"), s;
    }
    __name(ll, "ll");
    function Pm(e) {
      return Object.prototype.toString.call(e) === "[object Date]" || e instanceof Date;
    }
    __name(Pm, "Pm");
    function ul(e, t) {
      let r = (e || "").split(";").filter((d) => typeof d == "string" && !!d.trim()), n = r.shift() || "", i = vm(n), o = i.name, s = i.value;
      try {
        s = t?.decode === false ? s : (t?.decode || decodeURIComponent)(s);
      } catch {
      }
      let a = { name: o, value: s };
      for (let d of r) {
        let f = d.split("="), P = (f.shift() || "").trimStart().toLowerCase(), v = f.join("=");
        switch (P) {
          case "expires": {
            a.expires = new Date(v);
            break;
          }
          case "max-age": {
            a.maxAge = Number.parseInt(v, 10);
            break;
          }
          case "secure": {
            a.secure = true;
            break;
          }
          case "httponly": {
            a.httpOnly = true;
            break;
          }
          case "samesite": {
            a.sameSite = v;
            break;
          }
          default:
            a[P] = v;
        }
      }
      return a;
    }
    __name(ul, "ul");
    function vm(e) {
      let t = "", r = "", n = e.split("=");
      return n.length > 1 ? (t = n.shift(), r = n.join("=")) : r = e, { name: t, value: r };
    }
    __name(vm, "vm");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var mn = /* @__PURE__ */ __name(class extends Error {
      clientVersion;
      cause;
      constructor(t, r) {
        super(t), this.clientVersion = r.clientVersion, this.cause = r.cause;
      }
      get [Symbol.toStringTag]() {
        return this.name;
      }
    }, "mn");
    var dn = /* @__PURE__ */ __name(class extends mn {
      isRetryable;
      constructor(t, r) {
        super(t, r), this.isRetryable = r.isRetryable ?? true;
      }
    }, "dn");
    l();
    u();
    c();
    p();
    m();
    function cl(e, t) {
      return { ...e, isRetryable: t };
    }
    __name(cl, "cl");
    var ze = /* @__PURE__ */ __name(class extends dn {
      name = "InvalidDatasourceError";
      code = "P6001";
      constructor(t, r) {
        super(t, cl(r, false));
      }
    }, "ze");
    Nt(ze, "InvalidDatasourceError");
    function pl(e) {
      let t = { clientVersion: e.clientVersion }, r;
      try {
        r = new URL(e.accelerateUrl);
      } catch (d) {
        let f = d.message;
        throw new ze(`Error validating \`accelerateUrl\`, the URL cannot be parsed, reason: ${f}`, t);
      }
      let { protocol: n, searchParams: i } = r;
      if (n !== "prisma:" && n !== xr)
        throw new ze("Error validating `accelerateUrl`: the URL must start with the protocol `prisma://` or `prisma+postgres://`", t);
      let o = i.get("api_key");
      if (o === null || o.length < 1)
        throw new ze("Error validating `accelerateUrl`: the URL must contain a valid API key", t);
      let s = On(r) ? "http:" : "https:";
      g.env.TEST_CLIENT_ENGINE_REMOTE_EXECUTOR && r.searchParams.has("use_http") && (s = "http:");
      let a = new URL(r.href.replace(n, s));
      return { apiKey: o, url: a };
    }
    __name(pl, "pl");
    l();
    u();
    c();
    p();
    m();
    var ml = Ue(bo());
    var fn = /* @__PURE__ */ __name(class {
      apiKey;
      tracingHelper;
      logLevel;
      logQueries;
      engineHash;
      constructor({ apiKey: t, tracingHelper: r, logLevel: n, logQueries: i, engineHash: o }) {
        this.apiKey = t, this.tracingHelper = r, this.logLevel = n, this.logQueries = i, this.engineHash = o;
      }
      build({ traceparent: t, transactionId: r } = {}) {
        let n = { Accept: "application/json", Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "Prisma-Engine-Hash": this.engineHash, "Prisma-Engine-Version": ml.enginesVersion };
        this.tracingHelper.isEnabled() && (n.traceparent = t ?? this.tracingHelper.getTraceParent()), r && (n["X-Transaction-Id"] = r);
        let i = this.#t();
        return i.length > 0 && (n["X-Capture-Telemetry"] = i.join(", ")), n;
      }
      #t() {
        let t = [];
        return this.tracingHelper.isEnabled() && t.push("tracing"), this.logLevel && t.push(this.logLevel), this.logQueries && t.push("query"), t;
      }
    }, "fn");
    l();
    u();
    c();
    p();
    m();
    function Am(e) {
      return e[0] * 1e3 + e[1] / 1e6;
    }
    __name(Am, "Am");
    function Si(e) {
      return new Date(Am(e));
    }
    __name(Si, "Si");
    var fl = X("prisma:client:clientEngine:remoteExecutor");
    var gn = /* @__PURE__ */ __name(class {
      #t;
      #e;
      #r;
      #n;
      #l;
      #i;
      constructor(t) {
        this.#t = t.clientVersion, this.#n = t.logEmitter, this.#l = t.tracingHelper, this.#i = t.sqlCommenters;
        let { url: r, apiKey: n } = pl({ clientVersion: t.clientVersion, accelerateUrl: t.accelerateUrl });
        this.#r = new Ri(r), this.#e = new fn({ apiKey: n, engineHash: t.clientVersion, logLevel: t.logLevel, logQueries: t.logQueries, tracingHelper: t.tracingHelper });
      }
      async getConnectionInfo() {
        return await this.#s({ path: "/connection-info", method: "GET" });
      }
      async execute({ plan: t, placeholderValues: r, batchIndex: n, model: i, operation: o, transaction: s, customFetch: a, queryInfo: d }) {
        let f = d && this.#i?.length ? Hr(this.#i, { query: d }) : void 0;
        return (await this.#s({ path: s ? `/transaction/${s.id}/query` : "/query", method: "POST", body: { model: i, operation: o, plan: t, params: r, comments: f && Object.keys(f).length > 0 ? f : void 0 }, batchRequestIdx: n, fetch: a })).data;
      }
      async startTransaction(t) {
        return { ...await this.#s({ path: "/transaction/start", method: "POST", body: t }), payload: void 0 };
      }
      async commitTransaction(t) {
        await this.#s({ path: `/transaction/${t.id}/commit`, method: "POST" });
      }
      async rollbackTransaction(t) {
        await this.#s({ path: `/transaction/${t.id}/rollback`, method: "POST" });
      }
      disconnect() {
        return Promise.resolve();
      }
      apiKey() {
        return this.#e.apiKey;
      }
      async #s({ path: t, method: r, body: n, fetch: i = globalThis.fetch, batchRequestIdx: o }) {
        let s = await this.#r.request({ method: r, path: t, headers: this.#e.build(), body: n, fetch: i });
        s.ok || await this.#o(s, o);
        let a = await s.json();
        return typeof a.extensions == "object" && a.extensions !== null && this.#u(a.extensions), a;
      }
      async #o(t, r) {
        let n = t.headers.get("Prisma-Error-Code"), i = await t.text(), o, s = i;
        try {
          o = JSON.parse(i);
        } catch {
          o = {};
        }
        typeof o.code == "string" && (n = o.code), typeof o.error == "string" ? s = o.error : typeof o.message == "string" ? s = o.message : typeof o.InvalidRequestError == "object" && o.InvalidRequestError !== null && typeof o.InvalidRequestError.reason == "string" && (s = o.InvalidRequestError.reason), s = s || `HTTP ${t.status}: ${t.statusText}`;
        let a = typeof o.meta == "object" && o.meta !== null ? o.meta : o;
        throw new dl.PrismaClientKnownRequestError(s, { clientVersion: this.#t, code: n ?? "P6000", batchRequestIdx: r, meta: a });
      }
      #u(t) {
        if (t.logs)
          for (let r of t.logs)
            this.#a(r);
        t.spans && this.#l.dispatchEngineSpans(t.spans);
      }
      #a(t) {
        switch (t.level) {
          case "debug":
          case "trace":
            fl(t);
            break;
          case "error":
          case "warn":
          case "info": {
            this.#n.emit(t.level, { timestamp: Si(t.timestamp), message: t.attributes.message ?? "", target: t.target ?? "RemoteExecutor" });
            break;
          }
          case "query": {
            this.#n.emit("query", { query: t.attributes.query ?? "", timestamp: Si(t.timestamp), duration: t.attributes.duration_ms ?? 0, params: t.attributes.params ?? "", target: t.target ?? "RemoteExecutor" });
            break;
          }
          default:
            throw new Error(`Unexpected log level: ${t.level}`);
        }
      }
    }, "gn");
    var Ri = /* @__PURE__ */ __name(class {
      #t;
      #e;
      #r;
      constructor(t) {
        this.#t = t, this.#e = /* @__PURE__ */ new Map();
      }
      async request({ method: t, path: r, headers: n, body: i, fetch: o }) {
        let s = new URL(r, this.#t), a = this.#n(s);
        a && (n.Cookie = a), this.#r && (n["Accelerate-Query-Engine-Jwt"] = this.#r);
        let d = await o(s.href, { method: t, body: i !== void 0 ? JSON.stringify(i) : void 0, headers: n });
        return fl(t, s, d.status, d.statusText), this.#r = d.headers.get("Accelerate-Query-Engine-Jwt") ?? void 0, this.#l(s, d), d;
      }
      #n(t) {
        let r = [], n = /* @__PURE__ */ new Date();
        for (let [i, o] of this.#e) {
          if (o.expires && o.expires < n) {
            this.#e.delete(i);
            continue;
          }
          let s = o.domain ?? t.hostname, a = o.path ?? "/";
          t.hostname.endsWith(s) && t.pathname.startsWith(a) && r.push(ll(o.name, o.value));
        }
        return r.length > 0 ? r.join("; ") : void 0;
      }
      #l(t, r) {
        let n = r.headers.getSetCookie?.() || [];
        if (n.length === 0) {
          let i = r.headers.get("Set-Cookie");
          i && n.push(i);
        }
        for (let i of n) {
          let o = ul(i), s = o.domain ?? t.hostname, a = o.path ?? "/", d = `${s}:${a}:${o.name}`;
          this.#e.set(d, { name: o.name, value: o.value, domain: s, path: a, expires: o.expires });
        }
      }
    }, "Ri");
    l();
    u();
    c();
    p();
    m();
    var Oi = require_dist();
    var Ii = {};
    var gl = { async loadQueryCompiler(e) {
      let { clientVersion: t, compilerWasm: r } = e;
      if (r === void 0)
        throw new Oi.PrismaClientInitializationError("WASM query compiler was unexpectedly `undefined`", t);
      let n;
      return e.activeProvider === void 0 || Ii[e.activeProvider] === void 0 ? (n = (async () => {
        let i = await r.getRuntime(), o = await r.getQueryCompilerWasmModule();
        if (o == null)
          throw new Oi.PrismaClientInitializationError("The loaded wasm module was unexpectedly `undefined` or `null` once loaded", t);
        let s = { "./query_compiler_bg.js": i }, a = new WebAssembly.Instance(o, s), d = a.exports.__wbindgen_start;
        return i.__wbg_set_wasm(a.exports), d(), i.QueryCompiler;
      })(), e.activeProvider !== void 0 && (Ii[e.activeProvider] = n)) : n = Ii[e.activeProvider], await n;
    } };
    var Cm = "P2038";
    var or = X("prisma:client:clientEngine");
    var hl = globalThis;
    hl.PRISMA_WASM_PANIC_REGISTRY = { set_message(e) {
      throw new Y.PrismaClientRustPanicError(e, un);
    } };
    var sr = /* @__PURE__ */ __name(class {
      name = "ClientEngine";
      #t;
      #e = { type: "disconnected" };
      #r;
      #n;
      config;
      datamodel;
      logEmitter;
      logQueries;
      logLevel;
      tracingHelper;
      #l;
      constructor(t, r) {
        if (t.accelerateUrl !== void 0)
          this.#n = { remote: true, accelerateUrl: t.accelerateUrl };
        else if (t.adapter)
          this.#n = { remote: false, driverAdapterFactory: t.adapter }, or("Using driver adapter: %O", t.adapter);
        else
          throw new Y.PrismaClientInitializationError("Missing configured driver adapter. Engine type `client` requires an active driver adapter. Please check your PrismaClient initialization code.", t.clientVersion, Cm);
        this.#r = r ?? gl, this.config = t, this.logQueries = t.logQueries ?? false, this.logLevel = t.logLevel ?? "error", this.logEmitter = t.logEmitter, this.datamodel = t.inlineSchema, this.tracingHelper = t.tracingHelper, t.enableDebugLogs && (this.logLevel = "debug"), this.logQueries && (this.#l = (n) => {
          this.logEmitter.emit("query", { ...n, params: Wt(n.params), target: "ClientEngine" });
        });
      }
      async #i() {
        switch (this.#e.type) {
          case "disconnected": {
            let t = this.tracingHelper.runInChildSpan("connect", async () => {
              let r, n;
              try {
                r = await this.#s(), n = await this.#o(r);
              } catch (o) {
                throw this.#e = { type: "disconnected" }, n?.free(), await r?.disconnect(), o;
              }
              let i = { executor: r, queryCompiler: n };
              return this.#e = { type: "connected", engine: i }, i;
            });
            return this.#e = { type: "connecting", promise: t }, await t;
          }
          case "connecting":
            return await this.#e.promise;
          case "connected":
            return this.#e.engine;
          case "disconnecting":
            return await this.#e.promise, await this.#i();
        }
      }
      async #s() {
        return this.#n.remote ? new gn({ clientVersion: this.config.clientVersion, accelerateUrl: this.#n.accelerateUrl, logEmitter: this.logEmitter, logLevel: this.logLevel, logQueries: this.logQueries, tracingHelper: this.tracingHelper, sqlCommenters: this.config.sqlCommenters }) : await cn.connect({ driverAdapterFactory: this.#n.driverAdapterFactory, tracingHelper: this.tracingHelper, transactionOptions: { ...this.config.transactionOptions, isolationLevel: this.#m(this.config.transactionOptions.isolationLevel) }, onQuery: this.#l, provider: this.config.activeProvider, sqlCommenters: this.config.sqlCommenters });
      }
      async #o(t) {
        let r = this.#t;
        r === void 0 && (r = await this.#r.loadQueryCompiler(this.config), this.#t = r);
        let { provider: n, connectionInfo: i } = await t.getConnectionInfo();
        try {
          return this.#p(() => new r({ datamodel: this.datamodel, provider: n, connectionInfo: i }), void 0, false);
        } catch (o) {
          throw this.#u(o);
        }
      }
      #u(t) {
        if (t instanceof Y.PrismaClientRustPanicError)
          return t;
        try {
          let r = JSON.parse(t.message);
          return new Y.PrismaClientInitializationError(r.message, this.config.clientVersion, r.error_code);
        } catch {
          return t;
        }
      }
      #a(t, r) {
        if (t instanceof Y.PrismaClientInitializationError)
          return t;
        if (t.code === "GenericFailure" && t.message?.startsWith("PANIC:"))
          return new Y.PrismaClientRustPanicError(yl(this, t.message, r), this.config.clientVersion);
        if (t instanceof z)
          return new Y.PrismaClientKnownRequestError(t.message, { code: t.code, meta: t.meta, clientVersion: this.config.clientVersion });
        try {
          let n = JSON.parse(t);
          return new Y.PrismaClientUnknownRequestError(`${n.message}
${n.backtrace}`, { clientVersion: this.config.clientVersion });
        } catch {
          return t;
        }
      }
      #c(t) {
        return t instanceof Y.PrismaClientRustPanicError ? t : typeof t.message == "string" && typeof t.code == "string" ? new Y.PrismaClientKnownRequestError(t.message, { code: t.code, meta: t.meta, clientVersion: this.config.clientVersion }) : typeof t.message == "string" ? new Y.PrismaClientUnknownRequestError(t.message, { clientVersion: this.config.clientVersion }) : t;
      }
      #p(t, r, n = true) {
        let i = hl.PRISMA_WASM_PANIC_REGISTRY.set_message, o;
        globalThis.PRISMA_WASM_PANIC_REGISTRY.set_message = (s) => {
          o = s;
        };
        try {
          return t();
        } finally {
          if (globalThis.PRISMA_WASM_PANIC_REGISTRY.set_message = i, o)
            throw this.#t = void 0, n && this.stop().catch((s) => or("failed to disconnect:", s)), new Y.PrismaClientRustPanicError(yl(this, o, r), this.config.clientVersion);
        }
      }
      onBeforeExit() {
        throw new Error('"beforeExit" hook is not applicable to the client engine, it is only relevant and implemented for the binary engine. Please add your event listener to the `process` object directly instead.');
      }
      async start() {
        await this.#i();
      }
      async stop() {
        switch (this.#e.type) {
          case "disconnected":
            return;
          case "connecting":
            return await this.#e.promise, await this.stop();
          case "connected": {
            let t = this.#e.engine, r = this.tracingHelper.runInChildSpan("disconnect", async () => {
              try {
                await t.executor.disconnect(), t.queryCompiler.free();
              } finally {
                this.#e = { type: "disconnected" };
              }
            });
            return this.#e = { type: "disconnecting", promise: r }, await r;
          }
          case "disconnecting":
            return await this.#e.promise;
        }
      }
      version() {
        return "unknown";
      }
      async transaction(t, r, n) {
        let i, { executor: o } = await this.#i();
        try {
          if (t === "start") {
            let s = n;
            i = await o.startTransaction({ ...s, isolationLevel: this.#m(s.isolationLevel) });
          } else if (t === "commit") {
            let s = n;
            await o.commitTransaction(s);
          } else if (t === "rollback") {
            let s = n;
            await o.rollbackTransaction(s);
          } else
            Ae(t, "Invalid transaction action.");
        } catch (s) {
          throw this.#a(s);
        }
        return i ? { id: i.id, payload: void 0 } : void 0;
      }
      async request(t, { interactiveTransaction: r, customDataProxyFetch: n }) {
        or("sending request");
        let i = JSON.stringify(t), { executor: o, queryCompiler: s } = await this.#i().catch((d) => {
          throw this.#a(d, i);
        }), a;
        try {
          a = this.#p(() => this.#d({ queries: [t], execute: () => s.compile(i) }));
        } catch (d) {
          throw this.#c(d);
        }
        try {
          or("query plan created", a);
          let d = {}, f = await o.execute({ plan: a, model: t.modelName, operation: t.action, placeholderValues: d, transaction: r, batchIndex: void 0, customFetch: n?.(globalThis.fetch), queryInfo: { type: "single", modelName: t.modelName, action: t.action, query: t.query } });
          return or("query plan executed"), { data: { [t.action]: f } };
        } catch (d) {
          throw this.#a(d, i);
        }
      }
      async requestBatch(t, { transaction: r, customDataProxyFetch: n }) {
        if (t.length === 0)
          return [];
        let i = t[0].action, o = t[0].modelName, s = JSON.stringify(rl(t, r)), { executor: a, queryCompiler: d } = await this.#i().catch((P) => {
          throw this.#a(P, s);
        }), f;
        try {
          f = this.#p(() => this.#d({ queries: t, execute: () => d.compileBatch(s) }));
        } catch (P) {
          throw this.#c(P);
        }
        try {
          let P;
          r?.kind === "itx" && (P = r.options);
          let v = {};
          switch (f.type) {
            case "multi": {
              if (r?.kind !== "itx") {
                let M = r?.options.isolationLevel ? { ...this.config.transactionOptions, isolationLevel: r.options.isolationLevel } : this.config.transactionOptions;
                P = await this.transaction("start", {}, M);
              }
              let S = [], C = false;
              for (let [M, R] of f.plans.entries())
                try {
                  let k = await a.execute({ plan: R, placeholderValues: v, model: t[M].modelName, operation: t[M].action, batchIndex: M, transaction: P, customFetch: n?.(globalThis.fetch), queryInfo: { type: "single", ...t[M] } });
                  S.push({ data: { [t[M].action]: k } });
                } catch (k) {
                  S.push(k), C = true;
                  break;
                }
              return P !== void 0 && r?.kind !== "itx" && (C ? await this.transaction("rollback", {}, P) : await this.transaction("commit", {}, P)), S;
            }
            case "compacted": {
              if (!t.every((M) => M.action === i && M.modelName === o)) {
                let M = t.map((k) => k.action).join(", "), R = t.map((k) => k.modelName).join(", ");
                throw new Error(`Internal error: All queries in a compacted batch must have the same action and model name, but received actions: [${M}] and model names: [${R}]. This indicates a bug in the client. Please report this issue to the Prisma team with your query details.`);
              }
              if (o === void 0)
                throw new Error("Internal error: A compacted batch cannot contain raw queries. This indicates a bug in the client. Please report this issue to the Prisma team with your query details.");
              let S = await a.execute({ plan: f.plan, placeholderValues: v, model: o, operation: i, batchIndex: void 0, transaction: P, customFetch: n?.(globalThis.fetch), queryInfo: { type: "compacted", action: i, modelName: o, queries: t } });
              return Us(S, f).map((M) => ({ data: { [i]: M } }));
            }
          }
        } catch (P) {
          throw this.#a(P, s);
        }
      }
      async apiKey() {
        let { executor: t } = await this.#i();
        return t.apiKey();
      }
      #m(t) {
        switch (t) {
          case void 0:
            return;
          case "ReadUncommitted":
            return "READ UNCOMMITTED";
          case "ReadCommitted":
            return "READ COMMITTED";
          case "RepeatableRead":
            return "REPEATABLE READ";
          case "Serializable":
            return "SERIALIZABLE";
          case "Snapshot":
            return "SNAPSHOT";
          default:
            throw new Y.PrismaClientKnownRequestError(`Inconsistent column data: Conversion failed: Invalid isolation level \`${t}\``, { code: "P2023", clientVersion: this.config.clientVersion, meta: { providedIsolationLevel: t } });
        }
      }
      #d({ queries: t, execute: r }) {
        return this.tracingHelper.runInChildSpan({ name: "compile", attributes: { models: t.map((n) => n.modelName).filter((n) => n !== void 0), actions: t.map((n) => n.action) } }, r);
      }
    }, "sr");
    function yl(e, t, r) {
      return al({ binaryTarget: void 0, title: t, version: e.config.clientVersion, engineVersion: "unknown", database: e.config.activeProvider, query: r });
    }
    __name(yl, "yl");
    function wl(e) {
      return new sr(e);
    }
    __name(wl, "wl");
    l();
    u();
    c();
    p();
    m();
    var bl = /* @__PURE__ */ __name((e) => ({ command: e }), "bl");
    l();
    u();
    c();
    p();
    m();
    var Sl = require_dist();
    l();
    u();
    c();
    p();
    m();
    var xl = /* @__PURE__ */ __name((e) => e.strings.reduce((t, r, n) => `${t}@P${n}${r}`), "xl");
    l();
    u();
    c();
    p();
    m();
    var Pl = require_dist();
    function At(e) {
      try {
        return El(e, "fast");
      } catch {
        return El(e, "slow");
      }
    }
    __name(At, "At");
    function El(e, t) {
      return JSON.stringify(e.map((r) => vl(r, t)));
    }
    __name(El, "El");
    function vl(e, t) {
      if (Array.isArray(e))
        return e.map((r) => vl(r, t));
      if (typeof e == "bigint")
        return { prisma__type: "bigint", prisma__value: e.toString() };
      if (it(e))
        return { prisma__type: "date", prisma__value: e.toJSON() };
      if (Pl.Decimal.isDecimal(e))
        return { prisma__type: "decimal", prisma__value: e.toJSON() };
      if (y.isBuffer(e))
        return { prisma__type: "bytes", prisma__value: e.toString("base64") };
      if (Sm(e))
        return { prisma__type: "bytes", prisma__value: y.from(e).toString("base64") };
      if (ArrayBuffer.isView(e)) {
        let { buffer: r, byteOffset: n, byteLength: i } = e;
        return { prisma__type: "bytes", prisma__value: y.from(r, n, i).toString("base64") };
      }
      return typeof e == "object" && t === "slow" ? Al(e) : e;
    }
    __name(vl, "vl");
    function Sm(e) {
      return e instanceof ArrayBuffer || e instanceof SharedArrayBuffer ? true : typeof e == "object" && e !== null ? e[Symbol.toStringTag] === "ArrayBuffer" || e[Symbol.toStringTag] === "SharedArrayBuffer" : false;
    }
    __name(Sm, "Sm");
    function Al(e) {
      if (typeof e != "object" || e === null)
        return e;
      if (typeof e.toJSON == "function")
        return e.toJSON();
      if (Array.isArray(e))
        return e.map(Tl);
      let t = {};
      for (let r of Object.keys(e))
        t[r] = Tl(e[r]);
      return t;
    }
    __name(Al, "Al");
    function Tl(e) {
      return typeof e == "bigint" ? e.toString() : Al(e);
    }
    __name(Tl, "Tl");
    var Rm = /^(\s*alter\s)/i;
    var Cl = X("prisma:client");
    function ki(e, t, r, n) {
      if (!(e !== "postgresql" && e !== "cockroachdb") && r.length > 0 && Rm.exec(t))
        throw new Error(`Running ALTER using ${n} is not supported
Using the example below you can still execute your query with Prisma, but please note that it is vulnerable to SQL injection attacks and requires you to take care of input sanitization.

Example:
  await prisma.$executeRawUnsafe(\`ALTER USER prisma WITH PASSWORD '\${password}'\`)

More Information: https://pris.ly/d/execute-raw
`);
    }
    __name(ki, "ki");
    var Mi = /* @__PURE__ */ __name(({ clientMethod: e, activeProvider: t }) => (r) => {
      let n = "", i;
      if (Ur(r))
        n = r.sql, i = { values: At(r.values), __prismaRawParameters__: true };
      else if (Array.isArray(r)) {
        let [o, ...s] = r;
        n = o, i = { values: At(s || []), __prismaRawParameters__: true };
      } else
        switch (t) {
          case "sqlite":
          case "mysql": {
            n = r.sql, i = { values: At(r.values), __prismaRawParameters__: true };
            break;
          }
          case "cockroachdb":
          case "postgresql":
          case "postgres": {
            n = r.text, i = { values: At(r.values), __prismaRawParameters__: true };
            break;
          }
          case "sqlserver": {
            n = xl(r), i = { values: At(r.values), __prismaRawParameters__: true };
            break;
          }
          default:
            throw new Error(`The ${t} provider does not support ${e}`);
        }
      return i?.values ? Cl(`prisma.${e}(${n}, ${i.values})`) : Cl(`prisma.${e}(${n})`), { query: n, parameters: i };
    }, "Mi");
    var Rl = { requestArgsToMiddlewareArgs(e) {
      return [e.strings, ...e.values];
    }, middlewareArgsToRequestArgs(e) {
      let [t, ...r] = e;
      return new Sl.Sql(t, r);
    } };
    var Il = { requestArgsToMiddlewareArgs(e) {
      return [e];
    }, middlewareArgsToRequestArgs(e) {
      return e[0];
    } };
    l();
    u();
    c();
    p();
    m();
    function Di(e) {
      return function(r, n) {
        let i, o = /* @__PURE__ */ __name((s = e) => {
          try {
            return s === void 0 || s?.kind === "itx" ? i ??= Ol(r(s)) : Ol(r(s));
          } catch (a) {
            return Promise.reject(a);
          }
        }, "o");
        return { get spec() {
          return n;
        }, then(s, a) {
          return o().then(s, a);
        }, catch(s) {
          return o().catch(s);
        }, finally(s) {
          return o().finally(s);
        }, requestTransaction(s) {
          let a = o(s);
          return a.requestTransaction ? a.requestTransaction(s) : a;
        }, [Symbol.toStringTag]: "PrismaPromise" };
      };
    }
    __name(Di, "Di");
    function Ol(e) {
      return typeof e.then == "function" ? e : Promise.resolve(e);
    }
    __name(Ol, "Ol");
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    l();
    u();
    c();
    p();
    m();
    var kl = { name: "@prisma/instrumentation-contract", version: "7.2.0", description: "Shared types and utilities for Prisma instrumentation", main: "dist/index.js", module: "dist/index.mjs", types: "dist/index.d.ts", exports: { ".": { require: { types: "./dist/index.d.ts", default: "./dist/index.js" }, import: { types: "./dist/index.d.mts", default: "./dist/index.mjs" } } }, license: "Apache-2.0", homepage: "https://www.prisma.io", repository: { type: "git", url: "https://github.com/prisma/prisma.git", directory: "packages/instrumentation-contract" }, bugs: "https://github.com/prisma/prisma/issues", scripts: { dev: "DEV=true tsx helpers/build.ts", build: "tsx helpers/build.ts", prepublishOnly: "pnpm run build", test: "vitest run" }, files: ["dist"], sideEffects: false, devDependencies: { "@opentelemetry/api": "1.9.0" }, peerDependencies: { "@opentelemetry/api": "^1.8" } };
    var Om = kl.version.split(".")[0];
    var km = "PRISMA_INSTRUMENTATION";
    var Mm = `V${Om}_PRISMA_INSTRUMENTATION`;
    var Ml = globalThis;
    function Dl() {
      let e = Ml[Mm];
      return e?.helper ? e.helper : Ml[km]?.helper;
    }
    __name(Dl, "Dl");
    var Dm = { isEnabled() {
      return false;
    }, getTraceParent() {
      return "00-10-10-00";
    }, dispatchEngineSpans() {
    }, getActiveContext() {
    }, runInChildSpan(e, t) {
      return t();
    } };
    var Ni = /* @__PURE__ */ __name(class {
      isEnabled() {
        return this.getTracingHelper().isEnabled();
      }
      getTraceParent(t) {
        return this.getTracingHelper().getTraceParent(t);
      }
      dispatchEngineSpans(t) {
        return this.getTracingHelper().dispatchEngineSpans(t);
      }
      getActiveContext() {
        return this.getTracingHelper().getActiveContext();
      }
      runInChildSpan(t, r) {
        return this.getTracingHelper().runInChildSpan(t, r);
      }
      getTracingHelper() {
        return Dl() ?? Dm;
      }
    }, "Ni");
    function Nl() {
      return new Ni();
    }
    __name(Nl, "Nl");
    l();
    u();
    c();
    p();
    m();
    function Ll(e, t = () => {
    }) {
      let r, n = new Promise((i) => r = i);
      return { then(i) {
        return --e === 0 && r(t()), i?.(n);
      } };
    }
    __name(Ll, "Ll");
    l();
    u();
    c();
    p();
    m();
    function _l(e) {
      return typeof e == "string" ? e : e.reduce((t, r) => {
        let n = typeof r == "string" ? r : r.level;
        return n === "query" ? t : t && (r === "info" || t === "info") ? "info" : n;
      }, void 0);
    }
    __name(_l, "_l");
    l();
    u();
    c();
    p();
    m();
    var $l = require_dist();
    l();
    u();
    c();
    p();
    m();
    function Fl(e) {
      if (e.action !== "findUnique" && e.action !== "findUniqueOrThrow")
        return;
      let t = [];
      return e.modelName && t.push(e.modelName), e.query.arguments && t.push(Li(e.query.arguments)), t.push(Li(e.query.selection)), t.join("");
    }
    __name(Fl, "Fl");
    function Li(e) {
      return `(${Object.keys(e).sort().map((r) => {
        let n = e[r];
        return typeof n == "object" && n !== null ? `(${r} ${Li(n)})` : r;
      }).join(" ")})`;
    }
    __name(Li, "Li");
    l();
    u();
    c();
    p();
    m();
    var Nm = { aggregate: false, aggregateRaw: false, createMany: true, createManyAndReturn: true, createOne: true, deleteMany: true, deleteOne: true, executeRaw: true, findFirst: false, findFirstOrThrow: false, findMany: false, findRaw: false, findUnique: false, findUniqueOrThrow: false, groupBy: false, queryRaw: false, runCommandRaw: true, updateMany: true, updateManyAndReturn: true, updateOne: true, upsertOne: true };
    function _i(e) {
      return Nm[e];
    }
    __name(_i, "_i");
    l();
    u();
    c();
    p();
    m();
    var yn = /* @__PURE__ */ __name(class {
      constructor(t) {
        this.options = t;
        this.batches = {};
      }
      batches;
      tickActive = false;
      request(t) {
        let r = this.options.batchBy(t);
        return r ? (this.batches[r] || (this.batches[r] = [], this.tickActive || (this.tickActive = true, g.nextTick(() => {
          this.dispatchBatches(), this.tickActive = false;
        }))), new Promise((n, i) => {
          this.batches[r].push({ request: t, resolve: n, reject: i });
        })) : this.options.singleLoader(t);
      }
      dispatchBatches() {
        for (let t in this.batches) {
          let r = this.batches[t];
          delete this.batches[t], r.length === 1 ? this.options.singleLoader(r[0].request).then((n) => {
            n instanceof Error ? r[0].reject(n) : r[0].resolve(n);
          }).catch((n) => {
            r[0].reject(n);
          }) : (r.sort((n, i) => this.options.batchOrder(n.request, i.request)), this.options.batchLoader(r.map((n) => n.request)).then((n) => {
            if (n instanceof Error)
              for (let i = 0; i < r.length; i++)
                r[i].reject(n);
            else
              for (let i = 0; i < r.length; i++) {
                let o = n[i];
                o instanceof Error ? r[i].reject(o) : r[i].resolve(o);
              }
          }).catch((n) => {
            for (let i = 0; i < r.length; i++)
              r[i].reject(n);
          }));
        }
      }
      get [Symbol.toStringTag]() {
        return "DataLoader";
      }
    }, "yn");
    l();
    u();
    c();
    p();
    m();
    var Ul = require_dist();
    function Ze(e, t) {
      if (t === null)
        return t;
      switch (e) {
        case "bigint":
          return BigInt(t);
        case "bytes": {
          let { buffer: r, byteOffset: n, byteLength: i } = y.from(t, "base64");
          return new Uint8Array(r, n, i);
        }
        case "decimal":
          return new Ul.Decimal(t);
        case "datetime":
        case "date":
          return new Date(t);
        case "time":
          return /* @__PURE__ */ new Date(`1970-01-01T${t}Z`);
        case "bigint-array":
          return t.map((r) => Ze("bigint", r));
        case "bytes-array":
          return t.map((r) => Ze("bytes", r));
        case "decimal-array":
          return t.map((r) => Ze("decimal", r));
        case "datetime-array":
          return t.map((r) => Ze("datetime", r));
        case "date-array":
          return t.map((r) => Ze("date", r));
        case "time-array":
          return t.map((r) => Ze("time", r));
        default:
          return t;
      }
    }
    __name(Ze, "Ze");
    function hn(e) {
      let t = [], r = Lm(e);
      for (let n = 0; n < e.rows.length; n++) {
        let i = e.rows[n], o = { ...r };
        for (let s = 0; s < i.length; s++)
          o[e.columns[s]] = Ze(e.types[s], i[s]);
        t.push(o);
      }
      return t;
    }
    __name(hn, "hn");
    function Lm(e) {
      let t = {};
      for (let r = 0; r < e.columns.length; r++)
        t[e.columns[r]] = null;
      return t;
    }
    __name(Lm, "Lm");
    var _m = X("prisma:client:request_handler");
    var wn = /* @__PURE__ */ __name(class {
      client;
      dataloader;
      logEmitter;
      constructor(t, r) {
        this.logEmitter = r, this.client = t, this.dataloader = new yn({ batchLoader: Rs(async ({ requests: n, customDataProxyFetch: i }) => {
          let { transaction: o, otelParentCtx: s } = n[0], a = n.map((v) => v.protocolQuery), d = this.client._tracingHelper.getTraceParent(s), f = n.some((v) => _i(v.protocolQuery.action));
          return (await this.client._engine.requestBatch(a, { traceparent: d, transaction: Fm(o), containsWrite: f, customDataProxyFetch: i })).map((v, S) => {
            if (v instanceof Error)
              return v;
            try {
              return this.mapQueryEngineResult(n[S], v);
            } catch (C) {
              return C;
            }
          });
        }), singleLoader: async (n) => {
          let i = n.transaction?.kind === "itx" ? ql(n.transaction) : void 0, o = await this.client._engine.request(n.protocolQuery, { traceparent: this.client._tracingHelper.getTraceParent(), interactiveTransaction: i, isWrite: _i(n.protocolQuery.action), customDataProxyFetch: n.customDataProxyFetch });
          return this.mapQueryEngineResult(n, o);
        }, batchBy: (n) => n.transaction?.id ? `transaction-${n.transaction.id}` : Fl(n.protocolQuery), batchOrder(n, i) {
          return n.transaction?.kind === "batch" && i.transaction?.kind === "batch" ? n.transaction.index - i.transaction.index : 0;
        } });
      }
      async request(t) {
        try {
          return await this.dataloader.request(t);
        } catch (r) {
          let { clientMethod: n, callsite: i, transaction: o, args: s, modelName: a } = t;
          this.handleAndLogRequestError({ error: r, clientMethod: n, callsite: i, transaction: o, args: s, modelName: a, globalOmit: t.globalOmit });
        }
      }
      mapQueryEngineResult({ dataPath: t, unpacker: r }, n) {
        let i = n?.data, o = this.unpack(i, t, r);
        return g.env.PRISMA_CLIENT_GET_TIME ? { data: o } : o;
      }
      handleAndLogRequestError(t) {
        try {
          this.handleRequestError(t);
        } catch (r) {
          throw this.logEmitter && this.logEmitter.emit("error", { message: r.message, target: t.clientMethod, timestamp: /* @__PURE__ */ new Date() }), r;
        }
      }
      handleRequestError({ error: t, clientMethod: r, callsite: n, transaction: i, args: o, modelName: s, globalOmit: a }) {
        if (_m(t), Um(t, i))
          throw t;
        if (t instanceof D.PrismaClientKnownRequestError && $m(t)) {
          let f = Vl(t.meta);
          Mr({ args: o, errors: [f], callsite: n, errorFormat: this.client._errorFormat, originalMethod: r, clientVersion: this.client._clientVersion, globalOmit: a });
        }
        let d = t.message;
        if (n && (d = vr({ callsite: n, originalMethod: r, isPanic: t.isPanic, showColors: this.client._errorFormat === "pretty", message: d })), d = this.sanitizeMessage(d), t.code) {
          let f = s ? { modelName: s, ...t.meta } : t.meta;
          throw new D.PrismaClientKnownRequestError(d, { code: t.code, clientVersion: this.client._clientVersion, meta: f, batchRequestIdx: t.batchRequestIdx });
        } else {
          if (t.isPanic)
            throw new D.PrismaClientRustPanicError(d, this.client._clientVersion);
          if (t instanceof D.PrismaClientUnknownRequestError)
            throw new D.PrismaClientUnknownRequestError(d, { clientVersion: this.client._clientVersion, batchRequestIdx: t.batchRequestIdx });
          if (t instanceof D.PrismaClientInitializationError)
            throw new D.PrismaClientInitializationError(d, this.client._clientVersion);
          if (t instanceof D.PrismaClientRustPanicError)
            throw new D.PrismaClientRustPanicError(d, this.client._clientVersion);
        }
        throw t.clientVersion = this.client._clientVersion, t;
      }
      sanitizeMessage(t) {
        return this.client._errorFormat && this.client._errorFormat !== "pretty" ? nt(t) : t;
      }
      unpack(t, r, n) {
        if (!t || (t.data && (t = t.data), !t))
          return t;
        let i = Object.keys(t)[0], o = Object.values(t)[0], s = r.filter((f) => f !== "select" && f !== "include"), a = Qn(o, s), d = i === "queryRaw" ? hn(a) : De(a);
        return n ? n(d) : d;
      }
      get [Symbol.toStringTag]() {
        return "RequestHandler";
      }
    }, "wn");
    function Fm(e) {
      if (e) {
        if (e.kind === "batch")
          return { kind: "batch", options: { isolationLevel: e.isolationLevel } };
        if (e.kind === "itx")
          return { kind: "itx", options: ql(e) };
        Ae(e, "Unknown transaction kind");
      }
    }
    __name(Fm, "Fm");
    function ql(e) {
      return { id: e.id, payload: e.payload };
    }
    __name(ql, "ql");
    function Um(e, t) {
      return (0, $l.hasBatchIndex)(e) && t?.kind === "batch" && e.batchRequestIdx !== t.index;
    }
    __name(Um, "Um");
    function $m(e) {
      return e.code === "P2009" || e.code === "P2012";
    }
    __name($m, "$m");
    function Vl(e) {
      if (e.kind === "Union")
        return { kind: "Union", errors: e.errors.map(Vl) };
      if (Array.isArray(e.selectionPath)) {
        let [, ...t] = e.selectionPath;
        return { ...e, selectionPath: t };
      }
      return e;
    }
    __name(Vl, "Vl");
    l();
    u();
    c();
    p();
    m();
    var Fi = un;
    l();
    u();
    c();
    p();
    m();
    var Jl = Ue(_n());
    l();
    u();
    c();
    p();
    m();
    var j = /* @__PURE__ */ __name(class extends Error {
      constructor(t) {
        super(t + `
Read more at https://pris.ly/d/client-constructor`), this.name = "PrismaClientConstructorValidationError";
      }
      get [Symbol.toStringTag]() {
        return "PrismaClientConstructorValidationError";
      }
    }, "j");
    Nt(j, "PrismaClientConstructorValidationError");
    var Bl = ["errorFormat", "adapter", "accelerateUrl", "log", "transactionOptions", "omit", "comments", "__internal"];
    var jl = ["pretty", "colorless", "minimal"];
    var Ql = ["info", "query", "warn", "error"];
    var qm = { adapter: () => {
    }, accelerateUrl: (e) => {
      if (e !== void 0) {
        if (typeof e != "string")
          throw new j(`Invalid value ${JSON.stringify(e)} for "accelerateUrl" provided to PrismaClient constructor.`);
        if (e.trim().length === 0)
          throw new j('"accelerateUrl" provided to PrismaClient constructor must be a non-empty string.');
      }
    }, errorFormat: (e) => {
      if (e) {
        if (typeof e != "string")
          throw new j(`Invalid value ${JSON.stringify(e)} for "errorFormat" provided to PrismaClient constructor.`);
        if (!jl.includes(e)) {
          let t = ar(e, jl);
          throw new j(`Invalid errorFormat ${e} provided to PrismaClient constructor.${t}`);
        }
      }
    }, log: (e) => {
      if (!e)
        return;
      if (!Array.isArray(e))
        throw new j(`Invalid value ${JSON.stringify(e)} for "log" provided to PrismaClient constructor.`);
      function t(r) {
        if (typeof r == "string" && !Ql.includes(r)) {
          let n = ar(r, Ql);
          throw new j(`Invalid log level "${r}" provided to PrismaClient constructor.${n}`);
        }
      }
      __name(t, "t");
      for (let r of e) {
        t(r);
        let n = { level: t, emit: (i) => {
          let o = ["stdout", "event"];
          if (!o.includes(i)) {
            let s = ar(i, o);
            throw new j(`Invalid value ${JSON.stringify(i)} for "emit" in logLevel provided to PrismaClient constructor.${s}`);
          }
        } };
        if (r && typeof r == "object")
          for (let [i, o] of Object.entries(r))
            if (n[i])
              n[i](o);
            else
              throw new j(`Invalid property ${i} for "log" provided to PrismaClient constructor`);
      }
    }, transactionOptions: (e) => {
      if (!e)
        return;
      let t = e.maxWait;
      if (t != null && t <= 0)
        throw new j(`Invalid value ${t} for maxWait in "transactionOptions" provided to PrismaClient constructor. maxWait needs to be greater than 0`);
      let r = e.timeout;
      if (r != null && r <= 0)
        throw new j(`Invalid value ${r} for timeout in "transactionOptions" provided to PrismaClient constructor. timeout needs to be greater than 0`);
    }, omit: (e, t) => {
      if (typeof e != "object")
        throw new j('"omit" option is expected to be an object.');
      if (e === null)
        throw new j('"omit" option can not be `null`');
      let r = [];
      for (let [n, i] of Object.entries(e)) {
        let o = jm(n, t.runtimeDataModel);
        if (!o) {
          r.push({ kind: "UnknownModel", modelKey: n });
          continue;
        }
        for (let [s, a] of Object.entries(i)) {
          let d = o.fields.find((f) => f.name === s);
          if (!d) {
            r.push({ kind: "UnknownField", modelKey: n, fieldName: s });
            continue;
          }
          if (d.relationName) {
            r.push({ kind: "RelationInOmit", modelKey: n, fieldName: s });
            continue;
          }
          typeof a != "boolean" && r.push({ kind: "InvalidFieldValue", modelKey: n, fieldName: s });
        }
      }
      if (r.length > 0)
        throw new j(Qm(e, r));
    }, comments: (e) => {
      if (e !== void 0) {
        if (!Array.isArray(e))
          throw new j(`Invalid value ${JSON.stringify(e)} for "comments" provided to PrismaClient constructor. Expected an array of SQL commenter plugins.`);
        for (let t = 0; t < e.length; t++)
          if (typeof e[t] != "function")
            throw new j(`Invalid value at index ${t} for "comments" provided to PrismaClient constructor. Each plugin must be a function.`);
      }
    }, __internal: (e) => {
      if (!e)
        return;
      let t = ["debug", "engine", "configOverride"];
      if (typeof e != "object")
        throw new j(`Invalid value ${JSON.stringify(e)} for "__internal" to PrismaClient constructor`);
      for (let [r] of Object.entries(e))
        if (!t.includes(r)) {
          let n = ar(r, t);
          throw new j(`Invalid property ${JSON.stringify(r)} for "__internal" provided to PrismaClient constructor.${n}`);
        }
    } };
    function Vm(e) {
      let t = e.adapter !== void 0, r = e.accelerateUrl !== void 0;
      if (t && r)
        throw new j('The "adapter" and "accelerateUrl" options are mutually exclusive. Please provide only one of them.');
      if (!t && !r)
        throw new j('Using engine type "client" requires either "adapter" or "accelerateUrl" to be provided to PrismaClient constructor.');
    }
    __name(Vm, "Vm");
    function Wl(e, t) {
      for (let [r, n] of Object.entries(e)) {
        if (!Bl.includes(r)) {
          let i = ar(r, Bl);
          throw new j(`Unknown property ${r} provided to PrismaClient constructor.${i}`);
        }
        qm[r](n, t);
      }
      Vm(e);
    }
    __name(Wl, "Wl");
    function ar(e, t) {
      if (t.length === 0 || typeof e != "string")
        return "";
      let r = Bm(e, t);
      return r ? ` Did you mean "${r}"?` : "";
    }
    __name(ar, "ar");
    function Bm(e, t) {
      if (t.length === 0)
        return null;
      let r = t.map((i) => ({ value: i, distance: (0, Jl.default)(e, i) }));
      r.sort((i, o) => i.distance < o.distance ? -1 : 1);
      let n = r[0];
      return n.distance < 3 ? n.value : null;
    }
    __name(Bm, "Bm");
    function jm(e, t) {
      return Hl(t.models, e) ?? Hl(t.types, e);
    }
    __name(jm, "jm");
    function Hl(e, t) {
      let r = Object.keys(e).find((n) => Ie(n) === t);
      if (r)
        return e[r];
    }
    __name(Hl, "Hl");
    function Qm(e, t) {
      let r = mt(e);
      for (let o of t)
        switch (o.kind) {
          case "UnknownModel":
            r.arguments.getField(o.modelKey)?.markAsError(), r.addErrorMessage(() => `Unknown model name: ${o.modelKey}.`);
            break;
          case "UnknownField":
            r.arguments.getDeepField([o.modelKey, o.fieldName])?.markAsError(), r.addErrorMessage(() => `Model "${o.modelKey}" does not have a field named "${o.fieldName}".`);
            break;
          case "RelationInOmit":
            r.arguments.getDeepField([o.modelKey, o.fieldName])?.markAsError(), r.addErrorMessage(() => 'Relations are already excluded by default and can not be specified in "omit".');
            break;
          case "InvalidFieldValue":
            r.arguments.getDeepFieldValue([o.modelKey, o.fieldName])?.markAsError(), r.addErrorMessage(() => "Omit field option value must be a boolean.");
            break;
        }
      let { message: n, args: i } = kr(r, "colorless");
      return `Error validating "omit" option:

${i}

${n}`;
    }
    __name(Qm, "Qm");
    l();
    u();
    c();
    p();
    m();
    var Gl = require_dist();
    function Kl(e) {
      return e.length === 0 ? Promise.resolve([]) : new Promise((t, r) => {
        let n = new Array(e.length), i = null, o = false, s = 0, a = /* @__PURE__ */ __name(() => {
          o || (s++, s === e.length && (o = true, i ? r(i) : t(n)));
        }, "a"), d = /* @__PURE__ */ __name((f) => {
          o || (o = true, r(f));
        }, "d");
        for (let f = 0; f < e.length; f++)
          e[f].then((P) => {
            n[f] = P, a();
          }, (P) => {
            if (!(0, Gl.hasBatchIndex)(P)) {
              d(P);
              return;
            }
            P.batchRequestIdx === f ? d(P) : (i || (i = P), a());
          });
      });
    }
    __name(Kl, "Kl");
    var lr = X("prisma:client");
    typeof globalThis == "object" && (globalThis.NODE_CLIENT = true);
    var Hm = { requestArgsToMiddlewareArgs: (e) => e, middlewareArgsToRequestArgs: (e) => e };
    var Jm = Symbol.for("prisma.client.transaction.id");
    var Wm = { id: 0, nextId() {
      return ++this.id;
    } };
    function Yl(e) {
      class t {
        _originalClient = this;
        _runtimeDataModel;
        _requestHandler;
        _connectionPromise;
        _disconnectionPromise;
        _engineConfig;
        _accelerateEngineConfig;
        _clientVersion;
        _errorFormat;
        _tracingHelper;
        _previewFeatures;
        _activeProvider;
        _globalOmit;
        _extensions;
        _engine;
        _appliedParent;
        _createPrismaPromise = Di();
        constructor(n) {
          if (!n)
            throw new D.PrismaClientInitializationError("`PrismaClient` needs to be constructed with a non-empty, valid `PrismaClientOptions`:\n\n```\nnew PrismaClient({\n  ...\n})\n```\n\nor\n\n```\nconstructor() {\n  super({ ... });\n}\n```\n          ", Fi);
          e = n.__internal?.configOverride?.(e) ?? e, Wl(n, e);
          let i = new $r().on("error", () => {
          });
          this._extensions = dt.empty(), this._previewFeatures = e.previewFeatures, this._clientVersion = e.clientVersion ?? Fi, this._activeProvider = e.activeProvider, this._globalOmit = n?.omit, this._tracingHelper = Nl();
          let o;
          if (n.adapter) {
            o = n.adapter;
            let s = e.activeProvider === "postgresql" || e.activeProvider === "cockroachdb" ? "postgres" : e.activeProvider;
            if (o.provider !== s)
              throw new D.PrismaClientInitializationError(`The Driver Adapter \`${o.adapterName}\`, based on \`${o.provider}\`, is not compatible with the provider \`${s}\` specified in the Prisma schema.`, this._clientVersion);
          }
          try {
            let s = n ?? {}, d = (s.__internal ?? {}).debug === true;
            if (d && X.enable("prisma:client"), s.errorFormat ? this._errorFormat = s.errorFormat : g.env.NODE_ENV === "production" ? this._errorFormat = "minimal" : g.env.NO_COLOR ? this._errorFormat = "colorless" : this._errorFormat = "colorless", this._runtimeDataModel = e.runtimeDataModel, this._engineConfig = { enableDebugLogs: d, logLevel: s.log && _l(s.log), logQueries: s.log && !!(typeof s.log == "string" ? s.log === "query" : s.log.find((f) => typeof f == "string" ? f === "query" : f.level === "query")), compilerWasm: e.compilerWasm, clientVersion: e.clientVersion, previewFeatures: this._previewFeatures, activeProvider: e.activeProvider, inlineSchema: e.inlineSchema, tracingHelper: this._tracingHelper, transactionOptions: { maxWait: s.transactionOptions?.maxWait ?? 2e3, timeout: s.transactionOptions?.timeout ?? 5e3, isolationLevel: s.transactionOptions?.isolationLevel }, logEmitter: i, adapter: o, accelerateUrl: s.accelerateUrl, sqlCommenters: s.comments }, this._accelerateEngineConfig = Object.create(this._engineConfig), this._accelerateEngineConfig.accelerateUtils = { resolveDatasourceUrl: () => {
              if (s.accelerateUrl)
                return s.accelerateUrl;
              throw new D.PrismaClientInitializationError(`\`accelerateUrl\` is required when using \`@prisma/extension-accelerate\`:

new PrismaClient({
  accelerateUrl: "prisma://...",
}).$extends(withAccelerate())
`, e.clientVersion);
            } }, lr("clientVersion", e.clientVersion), this._engine = wl(this._engineConfig), this._requestHandler = new wn(this, i), s.log)
              for (let f of s.log) {
                let P = typeof f == "string" ? f : f.emit === "stdout" ? f.level : null;
                P && this.$on(P, (v) => {
                  Dt.log(`${Dt.tags[P] ?? ""}`, v.message || v.query);
                });
              }
          } catch (s) {
            throw s.clientVersion = this._clientVersion, s;
          }
          return this._appliedParent = Qt(this);
        }
        get [Symbol.toStringTag]() {
          return "PrismaClient";
        }
        $on(n, i) {
          return n === "beforeExit" ? this._engine.onBeforeExit(i) : n && this._engineConfig.logEmitter.on(n, i), this;
        }
        $connect() {
          try {
            return this._engine.start();
          } catch (n) {
            throw n.clientVersion = this._clientVersion, n;
          }
        }
        async $disconnect() {
          try {
            await this._engine.stop();
          } catch (n) {
            throw n.clientVersion = this._clientVersion, n;
          } finally {
            go();
          }
        }
        $executeRawInternal(n, i, o, s) {
          let a = this._activeProvider;
          return this._request({ action: "executeRaw", args: o, transaction: n, clientMethod: i, argsMapper: Mi({ clientMethod: i, activeProvider: a }), callsite: Me(this._errorFormat), dataPath: [], middlewareArgsMapper: s });
        }
        $executeRaw(n, ...i) {
          return this._createPrismaPromise((o) => {
            if (n.raw !== void 0 || n.sql !== void 0) {
              let [s, a] = zl(n, i);
              return ki(this._activeProvider, s.text, s.values, Array.isArray(n) ? "prisma.$executeRaw`<SQL>`" : "prisma.$executeRaw(sql`<SQL>`)"), this.$executeRawInternal(o, "$executeRaw", s, a);
            }
            throw new D.PrismaClientValidationError("`$executeRaw` is a tag function, please use it like the following:\n```\nconst result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`\n```\n\nOr read our docs at https://www.prisma.io/docs/concepts/components/prisma-client/raw-database-access#executeraw\n", { clientVersion: this._clientVersion });
          });
        }
        $executeRawUnsafe(n, ...i) {
          return this._createPrismaPromise((o) => (ki(this._activeProvider, n, i, "prisma.$executeRawUnsafe(<SQL>, [...values])"), this.$executeRawInternal(o, "$executeRawUnsafe", [n, ...i])));
        }
        $runCommandRaw(n) {
          if (e.activeProvider !== "mongodb")
            throw new D.PrismaClientValidationError(`The ${e.activeProvider} provider does not support $runCommandRaw. Use the mongodb provider.`, { clientVersion: this._clientVersion });
          return this._createPrismaPromise((i) => this._request({ args: n, clientMethod: "$runCommandRaw", dataPath: [], action: "runCommandRaw", argsMapper: bl, callsite: Me(this._errorFormat), transaction: i }));
        }
        async $queryRawInternal(n, i, o, s) {
          let a = this._activeProvider;
          return this._request({ action: "queryRaw", args: o, transaction: n, clientMethod: i, argsMapper: Mi({ clientMethod: i, activeProvider: a }), callsite: Me(this._errorFormat), dataPath: [], middlewareArgsMapper: s });
        }
        $queryRaw(n, ...i) {
          return this._createPrismaPromise((o) => {
            if (n.raw !== void 0 || n.sql !== void 0)
              return this.$queryRawInternal(o, "$queryRaw", ...zl(n, i));
            throw new D.PrismaClientValidationError("`$queryRaw` is a tag function, please use it like the following:\n```\nconst result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`\n```\n\nOr read our docs at https://www.prisma.io/docs/concepts/components/prisma-client/raw-database-access#queryraw\n", { clientVersion: this._clientVersion });
          });
        }
        $queryRawTyped(n) {
          return this._createPrismaPromise((i) => {
            if (!this._hasPreviewFlag("typedSql"))
              throw new D.PrismaClientValidationError("`typedSql` preview feature must be enabled in order to access $queryRawTyped API", { clientVersion: this._clientVersion });
            return this.$queryRawInternal(i, "$queryRawTyped", n);
          });
        }
        $queryRawUnsafe(n, ...i) {
          return this._createPrismaPromise((o) => this.$queryRawInternal(o, "$queryRawUnsafe", [n, ...i]));
        }
        _transactionWithArray({ promises: n, options: i }) {
          let o = Wm.nextId(), s = Ll(n.length), a = n.map((d, f) => {
            if (d?.[Symbol.toStringTag] !== "PrismaPromise")
              throw new Error("All elements of the array need to be Prisma Client promises. Hint: Please make sure you are not awaiting the Prisma client calls you intended to pass in the $transaction function.");
            let P = i?.isolationLevel ?? this._engineConfig.transactionOptions.isolationLevel, v = { kind: "batch", id: o, index: f, isolationLevel: P, lock: s };
            return d.requestTransaction?.(v) ?? d;
          });
          return Kl(a);
        }
        async _transactionWithCallback({ callback: n, options: i }) {
          let o = { traceparent: this._tracingHelper.getTraceParent() }, s = { maxWait: i?.maxWait ?? this._engineConfig.transactionOptions.maxWait, timeout: i?.timeout ?? this._engineConfig.transactionOptions.timeout, isolationLevel: i?.isolationLevel ?? this._engineConfig.transactionOptions.isolationLevel }, a = await this._engine.transaction("start", o, s), d;
          try {
            let f = { kind: "itx", ...a };
            d = await n(this._createItxClient(f)), await this._engine.transaction("commit", o, a);
          } catch (f) {
            throw await this._engine.transaction("rollback", o, a).catch(() => {
            }), f;
          }
          return d;
        }
        _createItxClient(n) {
          return pe(Qt(pe(ws(this), [te("_appliedParent", () => this._appliedParent._createItxClient(n)), te("_createPrismaPromise", () => Di(n)), te(Jm, () => n.id)])), [ft(Ps)]);
        }
        $transaction(n, i) {
          let o;
          typeof n == "function" ? this._engineConfig.adapter?.adapterName === "@prisma/adapter-d1" ? o = /* @__PURE__ */ __name(() => {
            throw new Error("Cloudflare D1 does not support interactive transactions. We recommend you to refactor your queries with that limitation in mind, and use batch transactions with `prisma.$transactions([])` where applicable.");
          }, "o") : o = /* @__PURE__ */ __name(() => this._transactionWithCallback({ callback: n, options: i }), "o") : o = /* @__PURE__ */ __name(() => this._transactionWithArray({ promises: n, options: i }), "o");
          let s = { name: "transaction", attributes: { method: "$transaction" } };
          return this._tracingHelper.runInChildSpan(s, o);
        }
        _request(n) {
          n.otelParentCtx = this._tracingHelper.getActiveContext();
          let i = n.middlewareArgsMapper ?? Hm, o = { args: i.requestArgsToMiddlewareArgs(n.args), dataPath: n.dataPath, runInTransaction: !!n.transaction, action: n.action, model: n.model }, s = { operation: { name: "operation", attributes: { method: o.action, model: o.model, name: o.model ? `${o.model}.${o.action}` : o.action } } }, a = /* @__PURE__ */ __name(async (d) => {
            let { runInTransaction: f, args: P, ...v } = d, S = { ...n, ...v };
            P && (S.args = i.middlewareArgsToRequestArgs(P)), n.transaction !== void 0 && f === false && delete S.transaction;
            let C = await Ss(this, S);
            return S.model ? Ts({ result: C, modelName: S.model, args: S.args, extensions: this._extensions, runtimeDataModel: this._runtimeDataModel, globalOmit: this._globalOmit }) : C;
          }, "a");
          return this._tracingHelper.runInChildSpan(s.operation, () => a(o));
        }
        async _executeRequest({ args: n, clientMethod: i, dataPath: o, callsite: s, action: a, model: d, argsMapper: f, transaction: P, unpacker: v, otelParentCtx: S, customDataProxyFetch: C }) {
          try {
            n = f ? f(n) : n;
            let M = { name: "serialize" }, R = this._tracingHelper.runInChildSpan(M, () => _r({ modelName: d, runtimeDataModel: this._runtimeDataModel, action: a, args: n, clientMethod: i, callsite: s, extensions: this._extensions, errorFormat: this._errorFormat, clientVersion: this._clientVersion, previewFeatures: this._previewFeatures, globalOmit: this._globalOmit }));
            return X.enabled("prisma:client") && (lr("Prisma Client call:"), lr(`prisma.${i}(${ls(n)})`), lr("Generated request:"), lr(JSON.stringify(R, null, 2) + `
`)), P?.kind === "batch" && await P.lock, this._requestHandler.request({ protocolQuery: R, modelName: d, action: a, clientMethod: i, dataPath: o, callsite: s, args: n, extensions: this._extensions, transaction: P, unpacker: v, otelParentCtx: S, otelChildCtx: this._tracingHelper.getActiveContext(), globalOmit: this._globalOmit, customDataProxyFetch: C });
          } catch (M) {
            throw M.clientVersion = this._clientVersion, M;
          }
        }
        _hasPreviewFlag(n) {
          return !!this._engineConfig.previewFeatures?.includes(n);
        }
        $extends = bs;
      }
      __name(t, "t");
      return t;
    }
    __name(Yl, "Yl");
    function zl(e, t) {
      return Gm(e) ? [new Zl.Sql(e, t), Rl] : [e, Il];
    }
    __name(zl, "zl");
    function Gm(e) {
      return Array.isArray(e) && Array.isArray(e.raw);
    }
    __name(Gm, "Gm");
    l();
    u();
    c();
    p();
    m();
    var Km = /* @__PURE__ */ new Set(["toJSON", "$$typeof", "asymmetricMatch", Symbol.iterator, Symbol.toStringTag, Symbol.isConcatSpreadable, Symbol.toPrimitive]);
    function Xl(e) {
      return new Proxy(e, { get(t, r) {
        if (r in t)
          return t[r];
        if (!Km.has(r))
          throw new TypeError(`Invalid enum value: ${String(r)}`);
      } });
    }
    __name(Xl, "Xl");
    l();
    u();
    c();
    p();
    m();
    var zm = /* @__PURE__ */ __name(() => globalThis.process?.release?.name === "node", "zm");
    var Zm = /* @__PURE__ */ __name(() => !!globalThis.Bun || !!globalThis.process?.versions?.bun, "Zm");
    var Ym = /* @__PURE__ */ __name(() => !!globalThis.Deno, "Ym");
    var Xm = /* @__PURE__ */ __name(() => typeof globalThis.Netlify == "object", "Xm");
    var ed = /* @__PURE__ */ __name(() => typeof globalThis.EdgeRuntime == "object", "ed");
    var td = /* @__PURE__ */ __name(() => globalThis.navigator?.userAgent === "Cloudflare-Workers", "td");
    function rd() {
      return [[Xm, "netlify"], [ed, "edge-light"], [td, "workerd"], [Ym, "deno"], [Zm, "bun"], [zm, "node"]].flatMap((r) => r[0]() ? [r[1]] : []).at(0) ?? "";
    }
    __name(rd, "rd");
    var nd = { node: "Node.js", workerd: "Cloudflare Workers", deno: "Deno and Deno Deploy", netlify: "Netlify Edge Functions", "edge-light": "Edge Runtime (Vercel Edge Functions, Vercel Edge Middleware, Next.js (Pages Router) Edge API Routes, Next.js (App Router) Edge Route Handlers or Next.js Middleware)" };
    function eu() {
      let e = rd();
      return { id: e, prettyName: nd[e] || e, isEdge: ["workerd", "deno", "netlify", "edge-light"].includes(e) };
    }
    __name(eu, "eu");
    var D = require_dist();
    var Te = require_dist();
    var ee = require_dist();
    var tu = require_dist();
  }
});

// src/generated/prisma/query_compiler_bg.js
var require_query_compiler_bg = __commonJS({
  "src/generated/prisma/query_compiler_bg.js"(exports, module) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    var h = Object.defineProperty;
    var T = Object.getOwnPropertyDescriptor;
    var M = Object.getOwnPropertyNames;
    var j = Object.prototype.hasOwnProperty;
    var D = /* @__PURE__ */ __name((e, t) => {
      for (var n in t)
        h(e, n, { get: t[n], enumerable: true });
    }, "D");
    var O = /* @__PURE__ */ __name((e, t, n, _) => {
      if (t && typeof t == "object" || typeof t == "function")
        for (let r of M(t))
          !j.call(e, r) && r !== n && h(e, r, { get: () => t[r], enumerable: !(_ = T(t, r)) || _.enumerable });
      return e;
    }, "O");
    var B = /* @__PURE__ */ __name((e) => O(h({}, "__esModule", { value: true }), e), "B");
    var xe = {};
    D(xe, { QueryCompiler: () => F, __wbg_Error_e83987f665cf5504: () => q, __wbg_Number_bb48ca12f395cd08: () => C, __wbg_String_8f0eb39a4a4c2f66: () => k, __wbg___wbindgen_boolean_get_6d5a1ee65bab5f68: () => W, __wbg___wbindgen_debug_string_df47ffb5e35e6763: () => V, __wbg___wbindgen_in_bb933bd9e1b3bc0f: () => z, __wbg___wbindgen_is_object_c818261d21f283a4: () => L, __wbg___wbindgen_is_string_fbb76cb2940daafd: () => P, __wbg___wbindgen_is_undefined_2d472862bd29a478: () => Q, __wbg___wbindgen_jsval_loose_eq_b664b38a2f582147: () => Y, __wbg___wbindgen_number_get_a20bf9b85341449d: () => G, __wbg___wbindgen_string_get_e4f06c90489ad01b: () => J, __wbg___wbindgen_throw_b855445ff6a94295: () => X, __wbg_entries_e171b586f8f6bdbf: () => H, __wbg_getTime_14776bfb48a1bff9: () => K, __wbg_get_7bed016f185add81: () => Z, __wbg_get_with_ref_key_1dc361bd10053bfe: () => v, __wbg_instanceof_ArrayBuffer_70beb1189ca63b38: () => ee, __wbg_instanceof_Uint8Array_20c8e73002f7af98: () => te, __wbg_isSafeInteger_d216eda7911dde36: () => ne, __wbg_length_69bca3cb64fc8748: () => re, __wbg_length_cdd215e10d9dd507: () => _e, __wbg_new_0_f9740686d739025c: () => oe, __wbg_new_1acc0b6eea89d040: () => ce, __wbg_new_5a79be3ab53b8aa5: () => ie, __wbg_new_68651c719dcda04e: () => se, __wbg_new_e17d9f43105b08be: () => ue, __wbg_prototypesetcall_2a6620b6922694b2: () => fe, __wbg_set_3f1d0b984ed272ed: () => be, __wbg_set_907fb406c34a251d: () => de, __wbg_set_c213c871859d6500: () => ae, __wbg_set_message_82ae475bb413aa5c: () => ge, __wbg_set_wasm: () => N, __wbindgen_cast_2241b6af4c4b2941: () => le, __wbindgen_cast_4625c577ab2ec9ee: () => we, __wbindgen_cast_9ae0607507abb057: () => pe, __wbindgen_cast_d6cd19b81560fd6e: () => ye, __wbindgen_init_externref_table: () => me });
    module.exports = B(xe);
    var A = /* @__PURE__ */ __name(() => {
    }, "A");
    A.prototype = A;
    var o;
    function N(e) {
      o = e;
    }
    __name(N, "N");
    var p = null;
    function a() {
      return (p === null || p.byteLength === 0) && (p = new Uint8Array(o.memory.buffer)), p;
    }
    __name(a, "a");
    var y = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
    y.decode();
    var U = 2146435072;
    var S = 0;
    function R(e, t) {
      return S += t, S >= U && (y = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true }), y.decode(), S = t), y.decode(a().subarray(e, e + t));
    }
    __name(R, "R");
    function m(e, t) {
      return e = e >>> 0, R(e, t);
    }
    __name(m, "m");
    var f = 0;
    var g = new TextEncoder();
    "encodeInto" in g || (g.encodeInto = function(e, t) {
      const n = g.encode(e);
      return t.set(n), { read: e.length, written: n.length };
    });
    function l(e, t, n) {
      if (n === void 0) {
        const i = g.encode(e), d = t(i.length, 1) >>> 0;
        return a().subarray(d, d + i.length).set(i), f = i.length, d;
      }
      let _ = e.length, r = t(_, 1) >>> 0;
      const s = a();
      let c = 0;
      for (; c < _; c++) {
        const i = e.charCodeAt(c);
        if (i > 127)
          break;
        s[r + c] = i;
      }
      if (c !== _) {
        c !== 0 && (e = e.slice(c)), r = n(r, _, _ = c + e.length * 3, 1) >>> 0;
        const i = a().subarray(r + c, r + _), d = g.encodeInto(e, i);
        c += d.written, r = n(r, _, c, 1) >>> 0;
      }
      return f = c, r;
    }
    __name(l, "l");
    var b = null;
    function u() {
      return (b === null || b.buffer.detached === true || b.buffer.detached === void 0 && b.buffer !== o.memory.buffer) && (b = new DataView(o.memory.buffer)), b;
    }
    __name(u, "u");
    function x(e) {
      return e == null;
    }
    __name(x, "x");
    function I(e) {
      const t = typeof e;
      if (t == "number" || t == "boolean" || e == null)
        return `${e}`;
      if (t == "string")
        return `"${e}"`;
      if (t == "symbol") {
        const r = e.description;
        return r == null ? "Symbol" : `Symbol(${r})`;
      }
      if (t == "function") {
        const r = e.name;
        return typeof r == "string" && r.length > 0 ? `Function(${r})` : "Function";
      }
      if (Array.isArray(e)) {
        const r = e.length;
        let s = "[";
        r > 0 && (s += I(e[0]));
        for (let c = 1; c < r; c++)
          s += ", " + I(e[c]);
        return s += "]", s;
      }
      const n = /\[object ([^\]]+)\]/.exec(toString.call(e));
      let _;
      if (n && n.length > 1)
        _ = n[1];
      else
        return toString.call(e);
      if (_ == "Object")
        try {
          return "Object(" + JSON.stringify(e) + ")";
        } catch {
          return "Object";
        }
      return e instanceof Error ? `${e.name}: ${e.message}
${e.stack}` : _;
    }
    __name(I, "I");
    function $3(e, t) {
      return e = e >>> 0, a().subarray(e / 1, e / 1 + t);
    }
    __name($3, "$");
    function w(e) {
      const t = o.__wbindgen_externrefs.get(e);
      return o.__externref_table_dealloc(e), t;
    }
    __name(w, "w");
    var E = typeof FinalizationRegistry > "u" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((e) => o.__wbg_querycompiler_free(e >>> 0, 1));
    var F = class {
      __destroy_into_raw() {
        const t = this.__wbg_ptr;
        return this.__wbg_ptr = 0, E.unregister(this), t;
      }
      free() {
        const t = this.__destroy_into_raw();
        o.__wbg_querycompiler_free(t, 0);
      }
      compileBatch(t) {
        const n = l(t, o.__wbindgen_malloc, o.__wbindgen_realloc), _ = f, r = o.querycompiler_compileBatch(this.__wbg_ptr, n, _);
        if (r[2])
          throw w(r[1]);
        return w(r[0]);
      }
      constructor(t) {
        const n = o.querycompiler_new(t);
        if (n[2])
          throw w(n[1]);
        return this.__wbg_ptr = n[0] >>> 0, E.register(this, this.__wbg_ptr, this), this;
      }
      compile(t) {
        const n = l(t, o.__wbindgen_malloc, o.__wbindgen_realloc), _ = f, r = o.querycompiler_compile(this.__wbg_ptr, n, _);
        if (r[2])
          throw w(r[1]);
        return w(r[0]);
      }
    };
    __name(F, "F");
    Symbol.dispose && (F.prototype[Symbol.dispose] = F.prototype.free);
    function q(e, t) {
      return Error(m(e, t));
    }
    __name(q, "q");
    function C(e) {
      return Number(e);
    }
    __name(C, "C");
    function k(e, t) {
      const n = String(t), _ = l(n, o.__wbindgen_malloc, o.__wbindgen_realloc), r = f;
      u().setInt32(e + 4 * 1, r, true), u().setInt32(e + 4 * 0, _, true);
    }
    __name(k, "k");
    function W(e) {
      const t = e, n = typeof t == "boolean" ? t : void 0;
      return x(n) ? 16777215 : n ? 1 : 0;
    }
    __name(W, "W");
    function V(e, t) {
      const n = I(t), _ = l(n, o.__wbindgen_malloc, o.__wbindgen_realloc), r = f;
      u().setInt32(e + 4 * 1, r, true), u().setInt32(e + 4 * 0, _, true);
    }
    __name(V, "V");
    function z(e, t) {
      return e in t;
    }
    __name(z, "z");
    function L(e) {
      const t = e;
      return typeof t == "object" && t !== null;
    }
    __name(L, "L");
    function P(e) {
      return typeof e == "string";
    }
    __name(P, "P");
    function Q(e) {
      return e === void 0;
    }
    __name(Q, "Q");
    function Y(e, t) {
      return e == t;
    }
    __name(Y, "Y");
    function G(e, t) {
      const n = t, _ = typeof n == "number" ? n : void 0;
      u().setFloat64(e + 8 * 1, x(_) ? 0 : _, true), u().setInt32(e + 4 * 0, !x(_), true);
    }
    __name(G, "G");
    function J(e, t) {
      const n = t, _ = typeof n == "string" ? n : void 0;
      var r = x(_) ? 0 : l(_, o.__wbindgen_malloc, o.__wbindgen_realloc), s = f;
      u().setInt32(e + 4 * 1, s, true), u().setInt32(e + 4 * 0, r, true);
    }
    __name(J, "J");
    function X(e, t) {
      throw new Error(m(e, t));
    }
    __name(X, "X");
    function H(e) {
      return Object.entries(e);
    }
    __name(H, "H");
    function K(e) {
      return e.getTime();
    }
    __name(K, "K");
    function Z(e, t) {
      return e[t >>> 0];
    }
    __name(Z, "Z");
    function v(e, t) {
      return e[t];
    }
    __name(v, "v");
    function ee(e) {
      let t;
      try {
        t = e instanceof ArrayBuffer;
      } catch {
        t = false;
      }
      return t;
    }
    __name(ee, "ee");
    function te(e) {
      let t;
      try {
        t = e instanceof Uint8Array;
      } catch {
        t = false;
      }
      return t;
    }
    __name(te, "te");
    function ne(e) {
      return Number.isSafeInteger(e);
    }
    __name(ne, "ne");
    function re(e) {
      return e.length;
    }
    __name(re, "re");
    function _e(e) {
      return e.length;
    }
    __name(_e, "_e");
    function oe() {
      return /* @__PURE__ */ new Date();
    }
    __name(oe, "oe");
    function ce() {
      return new Object();
    }
    __name(ce, "ce");
    function ie(e) {
      return new Uint8Array(e);
    }
    __name(ie, "ie");
    function se() {
      return /* @__PURE__ */ new Map();
    }
    __name(se, "se");
    function ue() {
      return new Array();
    }
    __name(ue, "ue");
    function fe(e, t, n) {
      Uint8Array.prototype.set.call($3(e, t), n);
    }
    __name(fe, "fe");
    function be(e, t, n) {
      e[t] = n;
    }
    __name(be, "be");
    function de(e, t, n) {
      return e.set(t, n);
    }
    __name(de, "de");
    function ae(e, t, n) {
      e[t >>> 0] = n;
    }
    __name(ae, "ae");
    function ge(e, t) {
      global.PRISMA_WASM_PANIC_REGISTRY.set_message(m(e, t));
    }
    __name(ge, "ge");
    function le(e, t) {
      return m(e, t);
    }
    __name(le, "le");
    function we(e) {
      return BigInt.asUintN(64, e);
    }
    __name(we, "we");
    function pe(e) {
      return e;
    }
    __name(pe, "pe");
    function ye(e) {
      return e;
    }
    __name(ye, "ye");
    function me() {
      const e = o.__wbindgen_externrefs, t = e.grow(4);
      e.set(0, void 0), e.set(t + 0, void 0), e.set(t + 1, null), e.set(t + 2, true), e.set(t + 3, false);
    }
    __name(me, "me");
  }
});

// src/generated/prisma/wasm-worker-loader.mjs
var wasm_worker_loader_exports = {};
__export(wasm_worker_loader_exports, {
  default: () => wasm_worker_loader_default
});
var wasm_worker_loader_default;
var init_wasm_worker_loader = __esm({
  "src/generated/prisma/wasm-worker-loader.mjs"() {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    wasm_worker_loader_default = import("./183c07c621c0db8f37263b19eb7d4287b437ebbf-query_compiler_bg.wasm");
  }
});

// src/generated/prisma/edge.js
var require_edge = __commonJS({
  "src/generated/prisma/edge.js"(exports) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    Object.defineProperty(exports, "__esModule", { value: true });
    var {
      PrismaClientKnownRequestError: PrismaClientKnownRequestError2,
      PrismaClientUnknownRequestError: PrismaClientUnknownRequestError2,
      PrismaClientRustPanicError: PrismaClientRustPanicError2,
      PrismaClientInitializationError: PrismaClientInitializationError2,
      PrismaClientValidationError: PrismaClientValidationError2,
      getPrismaClient: getPrismaClient2,
      sqltag: sqltag2,
      empty: empty2,
      join: join2,
      raw: raw3,
      skip: skip2,
      Decimal: Decimal2,
      Debug: Debug3,
      DbNull: DbNull2,
      JsonNull: JsonNull2,
      AnyNull: AnyNull2,
      NullTypes: NullTypes2,
      makeStrictEnum: makeStrictEnum2,
      Extensions: Extensions2,
      warnOnce: warnOnce2,
      defineDmmfProperty: defineDmmfProperty2,
      Public: Public2,
      getRuntime: getRuntime2,
      createParam: createParam2
    } = require_wasm_compiler_edge();
    var Prisma = {};
    exports.Prisma = Prisma;
    exports.$Enums = {};
    Prisma.prismaVersion = {
      client: "7.2.0",
      engine: "0c8ef2ce45c83248ab3df073180d5eda9e8be7a3"
    };
    Prisma.PrismaClientKnownRequestError = PrismaClientKnownRequestError2;
    Prisma.PrismaClientUnknownRequestError = PrismaClientUnknownRequestError2;
    Prisma.PrismaClientRustPanicError = PrismaClientRustPanicError2;
    Prisma.PrismaClientInitializationError = PrismaClientInitializationError2;
    Prisma.PrismaClientValidationError = PrismaClientValidationError2;
    Prisma.Decimal = Decimal2;
    Prisma.sql = sqltag2;
    Prisma.empty = empty2;
    Prisma.join = join2;
    Prisma.raw = raw3;
    Prisma.validator = Public2.validator;
    Prisma.getExtensionContext = Extensions2.getExtensionContext;
    Prisma.defineExtension = Extensions2.defineExtension;
    Prisma.DbNull = DbNull2;
    Prisma.JsonNull = JsonNull2;
    Prisma.AnyNull = AnyNull2;
    Prisma.NullTypes = NullTypes2;
    exports.Prisma.TransactionIsolationLevel = makeStrictEnum2({
      Serializable: "Serializable"
    });
    exports.Prisma.ActorScalarFieldEnum = {
      apId: "apId",
      type: "type",
      preferredUsername: "preferredUsername",
      name: "name",
      summary: "summary",
      iconUrl: "iconUrl",
      headerUrl: "headerUrl",
      inbox: "inbox",
      outbox: "outbox",
      followersUrl: "followersUrl",
      followingUrl: "followingUrl",
      publicKeyPem: "publicKeyPem",
      privateKeyPem: "privateKeyPem",
      takosUserId: "takosUserId",
      followerCount: "followerCount",
      followingCount: "followingCount",
      postCount: "postCount",
      isPrivate: "isPrivate",
      role: "role",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports.Prisma.ActorCacheScalarFieldEnum = {
      apId: "apId",
      type: "type",
      preferredUsername: "preferredUsername",
      name: "name",
      summary: "summary",
      iconUrl: "iconUrl",
      inbox: "inbox",
      outbox: "outbox",
      followersUrl: "followersUrl",
      followingUrl: "followingUrl",
      sharedInbox: "sharedInbox",
      publicKeyId: "publicKeyId",
      publicKeyPem: "publicKeyPem",
      rawJson: "rawJson",
      lastFetchedAt: "lastFetchedAt",
      createdAt: "createdAt"
    };
    exports.Prisma.ObjectScalarFieldEnum = {
      apId: "apId",
      type: "type",
      attributedTo: "attributedTo",
      content: "content",
      summary: "summary",
      attachmentsJson: "attachmentsJson",
      inReplyTo: "inReplyTo",
      conversation: "conversation",
      visibility: "visibility",
      toJson: "toJson",
      ccJson: "ccJson",
      audienceJson: "audienceJson",
      communityApId: "communityApId",
      endTime: "endTime",
      likeCount: "likeCount",
      replyCount: "replyCount",
      announceCount: "announceCount",
      shareCount: "shareCount",
      published: "published",
      updated: "updated",
      isLocal: "isLocal",
      rawJson: "rawJson"
    };
    exports.Prisma.FollowScalarFieldEnum = {
      followerApId: "followerApId",
      followingApId: "followingApId",
      status: "status",
      activityApId: "activityApId",
      createdAt: "createdAt",
      acceptedAt: "acceptedAt"
    };
    exports.Prisma.LikeScalarFieldEnum = {
      actorApId: "actorApId",
      objectApId: "objectApId",
      activityApId: "activityApId",
      createdAt: "createdAt"
    };
    exports.Prisma.AnnounceScalarFieldEnum = {
      actorApId: "actorApId",
      objectApId: "objectApId",
      activityApId: "activityApId",
      createdAt: "createdAt"
    };
    exports.Prisma.BookmarkScalarFieldEnum = {
      actorApId: "actorApId",
      objectApId: "objectApId",
      createdAt: "createdAt"
    };
    exports.Prisma.BlockScalarFieldEnum = {
      blockerApId: "blockerApId",
      blockedApId: "blockedApId",
      createdAt: "createdAt"
    };
    exports.Prisma.MuteScalarFieldEnum = {
      muterApId: "muterApId",
      mutedApId: "mutedApId",
      createdAt: "createdAt"
    };
    exports.Prisma.ActivityScalarFieldEnum = {
      apId: "apId",
      type: "type",
      actorApId: "actorApId",
      objectApId: "objectApId",
      objectJson: "objectJson",
      targetApId: "targetApId",
      rawJson: "rawJson",
      direction: "direction",
      processed: "processed",
      createdAt: "createdAt"
    };
    exports.Prisma.DeliveryQueueScalarFieldEnum = {
      id: "id",
      activityApId: "activityApId",
      inboxUrl: "inboxUrl",
      attempts: "attempts",
      lastAttemptAt: "lastAttemptAt",
      nextAttemptAt: "nextAttemptAt",
      error: "error",
      createdAt: "createdAt"
    };
    exports.Prisma.CommunityScalarFieldEnum = {
      apId: "apId",
      type: "type",
      preferredUsername: "preferredUsername",
      name: "name",
      summary: "summary",
      iconUrl: "iconUrl",
      inbox: "inbox",
      outbox: "outbox",
      followersUrl: "followersUrl",
      visibility: "visibility",
      joinPolicy: "joinPolicy",
      postPolicy: "postPolicy",
      publicKeyPem: "publicKeyPem",
      privateKeyPem: "privateKeyPem",
      createdBy: "createdBy",
      memberCount: "memberCount",
      createdAt: "createdAt",
      lastMessageAt: "lastMessageAt"
    };
    exports.Prisma.CommunityMemberScalarFieldEnum = {
      communityApId: "communityApId",
      actorApId: "actorApId",
      role: "role",
      joinedAt: "joinedAt"
    };
    exports.Prisma.CommunityJoinRequestScalarFieldEnum = {
      communityApId: "communityApId",
      actorApId: "actorApId",
      status: "status",
      createdAt: "createdAt",
      processedAt: "processedAt"
    };
    exports.Prisma.CommunityInviteScalarFieldEnum = {
      id: "id",
      communityApId: "communityApId",
      invitedByApId: "invitedByApId",
      invitedApId: "invitedApId",
      createdAt: "createdAt",
      expiresAt: "expiresAt",
      usedAt: "usedAt",
      usedByApId: "usedByApId"
    };
    exports.Prisma.ObjectRecipientScalarFieldEnum = {
      objectApId: "objectApId",
      recipientApId: "recipientApId",
      type: "type",
      createdAt: "createdAt"
    };
    exports.Prisma.InboxScalarFieldEnum = {
      actorApId: "actorApId",
      activityApId: "activityApId",
      read: "read",
      createdAt: "createdAt"
    };
    exports.Prisma.SessionScalarFieldEnum = {
      id: "id",
      memberId: "memberId",
      accessToken: "accessToken",
      refreshToken: "refreshToken",
      expiresAt: "expiresAt",
      createdAt: "createdAt",
      provider: "provider",
      providerAccessToken: "providerAccessToken",
      providerRefreshToken: "providerRefreshToken",
      providerTokenExpiresAt: "providerTokenExpiresAt"
    };
    exports.Prisma.StoryViewScalarFieldEnum = {
      actorApId: "actorApId",
      storyApId: "storyApId",
      viewedAt: "viewedAt"
    };
    exports.Prisma.StoryVoteScalarFieldEnum = {
      id: "id",
      storyApId: "storyApId",
      actorApId: "actorApId",
      optionIndex: "optionIndex",
      createdAt: "createdAt"
    };
    exports.Prisma.StoryShareScalarFieldEnum = {
      id: "id",
      storyApId: "storyApId",
      actorApId: "actorApId",
      sharedAt: "sharedAt"
    };
    exports.Prisma.NotificationArchivedScalarFieldEnum = {
      actorApId: "actorApId",
      activityApId: "activityApId",
      archivedAt: "archivedAt"
    };
    exports.Prisma.InstanceActorScalarFieldEnum = {
      apId: "apId",
      preferredUsername: "preferredUsername",
      name: "name",
      summary: "summary",
      publicKeyPem: "publicKeyPem",
      privateKeyPem: "privateKeyPem",
      joinPolicy: "joinPolicy",
      postingPolicy: "postingPolicy",
      visibility: "visibility",
      createdAt: "createdAt",
      updatedAt: "updatedAt"
    };
    exports.Prisma.DmTypingScalarFieldEnum = {
      actorApId: "actorApId",
      recipientApId: "recipientApId",
      lastTypedAt: "lastTypedAt"
    };
    exports.Prisma.DmReadStatusScalarFieldEnum = {
      actorApId: "actorApId",
      conversationId: "conversationId",
      lastReadAt: "lastReadAt"
    };
    exports.Prisma.DmArchivedConversationScalarFieldEnum = {
      actorApId: "actorApId",
      conversationId: "conversationId",
      archivedAt: "archivedAt"
    };
    exports.Prisma.SortOrder = {
      asc: "asc",
      desc: "desc"
    };
    exports.Prisma.NullsOrder = {
      first: "first",
      last: "last"
    };
    exports.Prisma.ModelName = {
      Actor: "Actor",
      ActorCache: "ActorCache",
      Object: "Object",
      Follow: "Follow",
      Like: "Like",
      Announce: "Announce",
      Bookmark: "Bookmark",
      Block: "Block",
      Mute: "Mute",
      Activity: "Activity",
      DeliveryQueue: "DeliveryQueue",
      Community: "Community",
      CommunityMember: "CommunityMember",
      CommunityJoinRequest: "CommunityJoinRequest",
      CommunityInvite: "CommunityInvite",
      ObjectRecipient: "ObjectRecipient",
      Inbox: "Inbox",
      Session: "Session",
      StoryView: "StoryView",
      StoryVote: "StoryVote",
      StoryShare: "StoryShare",
      NotificationArchived: "NotificationArchived",
      InstanceActor: "InstanceActor",
      DmTyping: "DmTyping",
      DmReadStatus: "DmReadStatus",
      DmArchivedConversation: "DmArchivedConversation"
    };
    var config2 = {
      "previewFeatures": [],
      "clientVersion": "7.2.0",
      "engineVersion": "0c8ef2ce45c83248ab3df073180d5eda9e8be7a3",
      "activeProvider": "sqlite",
      "inlineSchema": `// Yurucommu Database Schema
// Prisma with SQLite/D1 support for multi-runtime

generator client {
  provider = "prisma-client-js"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "sqlite"
}

// ============================================================
// ACTORS (Local accounts - Person type)
// ============================================================
model Actor {
  apId              String  @id @map("ap_id")
  type              String  @default("Person")
  preferredUsername String  @unique @map("preferred_username")
  name              String?
  summary           String?
  iconUrl           String? @map("icon_url")
  headerUrl         String? @map("header_url")
  inbox             String
  outbox            String
  followersUrl      String  @map("followers_url")
  followingUrl      String  @map("following_url")
  publicKeyPem      String  @map("public_key_pem")
  privateKeyPem     String  @map("private_key_pem")
  takosUserId       String? @unique @map("takos_user_id")
  followerCount     Int     @default(0) @map("follower_count")
  followingCount    Int     @default(0) @map("following_count")
  postCount         Int     @default(0) @map("post_count")
  isPrivate         Int     @default(0) @map("is_private")
  role              String  @default("member")
  createdAt         String  @default(dbgenerated("datetime('now')")) @map("created_at")
  updatedAt         String  @default(dbgenerated("datetime('now')")) @map("updated_at")

  // Relations
  sessions              Session[]
  objectsAuthored       Object[]               @relation("AuthoredObjects")
  followsAsFollower     Follow[]               @relation("FollowerFollows")
  followsAsFollowing    Follow[]               @relation("FollowingFollows")
  likes                 Like[]
  announces             Announce[]
  bookmarks             Bookmark[]
  blocksAsBlocker       Block[]                @relation("BlockerBlocks")
  blocksAsBlocked       Block[]                @relation("BlockedBlocks")
  mutesAsMuter          Mute[]                 @relation("MuterMutes")
  mutesAsMuted          Mute[]                 @relation("MutedMutes")
  activities            Activity[]
  storyViews            StoryView[]
  storyVotes            StoryVote[]
  storyShares           StoryShare[]
  communityMemberships  CommunityMember[]
  communityJoinRequests CommunityJoinRequest[]
  communityInvites      CommunityInvite[]      @relation("InvitedByActor")
  inboxItems            Inbox[]
  objectRecipients      ObjectRecipient[]

  @@index([preferredUsername])
  @@index([takosUserId])
  @@map("actors")
}

// ============================================================
// ACTOR_CACHE (Remote actors - cached from federation)
// ============================================================
model ActorCache {
  apId              String  @id @map("ap_id")
  type              String  @default("Person")
  preferredUsername String? @map("preferred_username")
  name              String?
  summary           String?
  iconUrl           String? @map("icon_url")
  inbox             String
  outbox            String?
  followersUrl      String? @map("followers_url")
  followingUrl      String? @map("following_url")
  sharedInbox       String? @map("shared_inbox")
  publicKeyId       String? @map("public_key_id")
  publicKeyPem      String? @map("public_key_pem")
  rawJson           String  @map("raw_json")
  lastFetchedAt     String  @default(dbgenerated("datetime('now')")) @map("last_fetched_at")
  createdAt         String  @default(dbgenerated("datetime('now')")) @map("created_at")

  @@map("actor_cache")
}

// ============================================================
// OBJECTS (All AP objects - Note, Article, etc.)
// ============================================================
model Object {
  apId            String  @id @map("ap_id")
  type            String  @default("Note")
  attributedTo    String  @map("attributed_to")
  content         String  @default("")
  summary         String?
  attachmentsJson String  @default("[]") @map("attachments_json")
  inReplyTo       String? @map("in_reply_to")
  conversation    String?
  visibility      String  @default("public")
  toJson          String  @default("[]") @map("to_json")
  ccJson          String  @default("[]") @map("cc_json")
  audienceJson    String  @default("[]") @map("audience_json")
  communityApId   String? @map("community_ap_id")
  endTime         String? @map("end_time")
  likeCount       Int     @default(0) @map("like_count")
  replyCount      Int     @default(0) @map("reply_count")
  announceCount   Int     @default(0) @map("announce_count")
  shareCount      Int     @default(0) @map("share_count")
  published       String  @default(dbgenerated("datetime('now')"))
  updated         String?
  isLocal         Int     @default(1) @map("is_local")
  rawJson         String? @map("raw_json")

  // Relations
  author      Actor             @relation("AuthoredObjects", fields: [attributedTo], references: [apId], onDelete: Cascade)
  community   Community?        @relation(fields: [communityApId], references: [apId], onDelete: SetNull)
  likes       Like[]
  announces   Announce[]
  bookmarks   Bookmark[]
  storyViews  StoryView[]
  storyVotes  StoryVote[]
  storyShares StoryShare[]
  recipients  ObjectRecipient[]
  activities  Activity[]

  @@index([attributedTo])
  @@index([inReplyTo])
  @@index([communityApId])
  @@index([published(sort: Desc)])
  @@index([visibility])
  @@index([endTime])
  // Compound indexes for common query patterns
  @@index([attributedTo, published(sort: Desc)])
  @@index([visibility, published(sort: Desc)])
  @@index([type, visibility, published(sort: Desc)])
  @@map("objects")
}

// ============================================================
// FOLLOWS
// ============================================================
model Follow {
  followerApId  String  @map("follower_ap_id")
  followingApId String  @map("following_ap_id")
  status        String  @default("pending")
  activityApId  String? @map("activity_ap_id")
  createdAt     String  @default(dbgenerated("datetime('now')")) @map("created_at")
  acceptedAt    String? @map("accepted_at")

  // Relations
  follower  Actor @relation("FollowerFollows", fields: [followerApId], references: [apId], onDelete: Cascade)
  following Actor @relation("FollowingFollows", fields: [followingApId], references: [apId], onDelete: Cascade)

  @@id([followerApId, followingApId])
  @@index([followerApId, status])
  @@index([followingApId, status])
  @@map("follows")
}

// ============================================================
// LIKES
// ============================================================
model Like {
  actorApId    String  @map("actor_ap_id")
  objectApId   String  @map("object_ap_id")
  activityApId String? @map("activity_ap_id")
  createdAt    String  @default(dbgenerated("datetime('now')")) @map("created_at")

  // Relations
  actor  Actor  @relation(fields: [actorApId], references: [apId], onDelete: Cascade)
  object Object @relation(fields: [objectApId], references: [apId], onDelete: Cascade)

  @@id([actorApId, objectApId])
  @@index([objectApId])
  @@index([actorApId])
  @@map("likes")
}

// ============================================================
// ANNOUNCES (Reposts/Boosts)
// ============================================================
model Announce {
  actorApId    String  @map("actor_ap_id")
  objectApId   String  @map("object_ap_id")
  activityApId String? @map("activity_ap_id")
  createdAt    String  @default(dbgenerated("datetime('now')")) @map("created_at")

  // Relations
  actor  Actor  @relation(fields: [actorApId], references: [apId], onDelete: Cascade)
  object Object @relation(fields: [objectApId], references: [apId], onDelete: Cascade)

  @@id([actorApId, objectApId])
  @@index([objectApId])
  @@index([actorApId])
  @@map("announces")
}

// ============================================================
// BOOKMARKS
// ============================================================
model Bookmark {
  actorApId  String @map("actor_ap_id")
  objectApId String @map("object_ap_id")
  createdAt  String @default(dbgenerated("datetime('now')")) @map("created_at")

  // Relations
  actor  Actor  @relation(fields: [actorApId], references: [apId], onDelete: Cascade)
  object Object @relation(fields: [objectApId], references: [apId], onDelete: Cascade)

  @@id([actorApId, objectApId])
  @@index([actorApId])
  @@map("bookmarks")
}

// ============================================================
// BLOCKS
// ============================================================
model Block {
  blockerApId String @map("blocker_ap_id")
  blockedApId String @map("blocked_ap_id")
  createdAt   String @default(dbgenerated("datetime('now')")) @map("created_at")

  // Relations
  blocker Actor @relation("BlockerBlocks", fields: [blockerApId], references: [apId], onDelete: Cascade)
  blocked Actor @relation("BlockedBlocks", fields: [blockedApId], references: [apId], onDelete: Cascade)

  @@id([blockerApId, blockedApId])
  @@index([blockerApId])
  @@index([blockedApId])
  @@map("blocks")
}

// ============================================================
// MUTES
// ============================================================
model Mute {
  muterApId String @map("muter_ap_id")
  mutedApId String @map("muted_ap_id")
  createdAt String @default(dbgenerated("datetime('now')")) @map("created_at")

  // Relations
  muter Actor @relation("MuterMutes", fields: [muterApId], references: [apId], onDelete: Cascade)
  muted Actor @relation("MutedMutes", fields: [mutedApId], references: [apId], onDelete: Cascade)

  @@id([muterApId, mutedApId])
  @@index([muterApId])
  @@index([mutedApId])
  @@map("mutes")
}

// ============================================================
// ACTIVITIES
// ============================================================
model Activity {
  apId       String  @id @map("ap_id")
  type       String
  actorApId  String  @map("actor_ap_id")
  objectApId String? @map("object_ap_id")
  objectJson String? @map("object_json")
  targetApId String? @map("target_ap_id")
  rawJson    String  @map("raw_json")
  direction  String?
  processed  Int     @default(0)
  createdAt  String  @default(dbgenerated("datetime('now')")) @map("created_at")

  // Relations
  actor      Actor   @relation(fields: [actorApId], references: [apId], onDelete: Cascade)
  object     Object? @relation(fields: [objectApId], references: [apId], onDelete: SetNull)
  inboxItems Inbox[]

  @@index([actorApId])
  @@index([objectApId])
  @@index([type, createdAt(sort: Desc)])
  @@index([direction, processed])
  @@map("activities")
}

// ============================================================
// DELIVERY_QUEUE
// ============================================================
model DeliveryQueue {
  id            String  @id
  activityApId  String  @map("activity_ap_id")
  inboxUrl      String  @map("inbox_url")
  attempts      Int     @default(0)
  lastAttemptAt String? @map("last_attempt_at")
  nextAttemptAt String  @default(dbgenerated("datetime('now')")) @map("next_attempt_at")
  error         String?
  createdAt     String  @default(dbgenerated("datetime('now')")) @map("created_at")

  @@index([nextAttemptAt])
  @@map("delivery_queue")
}

// ============================================================
// COMMUNITIES
// ============================================================
model Community {
  apId              String  @id @map("ap_id")
  type              String  @default("Group")
  preferredUsername String  @unique @map("preferred_username")
  name              String
  summary           String?
  iconUrl           String? @map("icon_url")
  inbox             String
  outbox            String
  followersUrl      String  @map("followers_url")
  visibility        String  @default("public")
  joinPolicy        String  @default("open") @map("join_policy")
  postPolicy        String  @default("members") @map("post_policy")
  publicKeyPem      String  @map("public_key_pem")
  privateKeyPem     String  @map("private_key_pem")
  createdBy         String  @map("created_by")
  memberCount       Int     @default(0) @map("member_count")
  createdAt         String  @default(dbgenerated("datetime('now')")) @map("created_at")
  lastMessageAt     String? @map("last_message_at")

  // Relations
  members      CommunityMember[]
  objects      Object[]
  joinRequests CommunityJoinRequest[]
  invites      CommunityInvite[]

  @@map("communities")
}

// ============================================================
// COMMUNITY_MEMBERS
// ============================================================
model CommunityMember {
  communityApId String @map("community_ap_id")
  actorApId     String @map("actor_ap_id")
  role          String @default("member")
  joinedAt      String @default(dbgenerated("datetime('now')")) @map("joined_at")

  // Relations
  community Community @relation(fields: [communityApId], references: [apId], onDelete: Cascade)
  actor     Actor     @relation(fields: [actorApId], references: [apId], onDelete: Cascade)

  @@id([communityApId, actorApId])
  @@index([actorApId])
  @@map("community_members")
}

// ============================================================
// COMMUNITY_JOIN_REQUESTS
// ============================================================
model CommunityJoinRequest {
  communityApId String  @map("community_ap_id")
  actorApId     String  @map("actor_ap_id")
  status        String  @default("pending")
  createdAt     String  @default(dbgenerated("datetime('now')")) @map("created_at")
  processedAt   String? @map("processed_at")

  // Relations
  community Community @relation(fields: [communityApId], references: [apId], onDelete: Cascade)
  actor     Actor     @relation(fields: [actorApId], references: [apId], onDelete: Cascade)

  @@id([communityApId, actorApId])
  @@index([communityApId, status])
  @@index([actorApId])
  @@map("community_join_requests")
}

// ============================================================
// COMMUNITY_INVITES
// ============================================================
model CommunityInvite {
  id            String  @id
  communityApId String  @map("community_ap_id")
  invitedByApId String  @map("invited_by_ap_id")
  invitedApId   String? @map("invited_ap_id")
  createdAt     String  @default(dbgenerated("datetime('now')")) @map("created_at")
  expiresAt     String? @map("expires_at")
  usedAt        String? @map("used_at")
  usedByApId    String? @map("used_by_ap_id")

  // Relations
  community Community @relation(fields: [communityApId], references: [apId], onDelete: Cascade)
  invitedBy Actor     @relation("InvitedByActor", fields: [invitedByApId], references: [apId], onDelete: Cascade)

  @@index([communityApId])
  @@index([invitedByApId])
  @@map("community_invites")
}

// ============================================================
// OBJECT_RECIPIENTS
// ============================================================
model ObjectRecipient {
  objectApId    String @map("object_ap_id")
  recipientApId String @map("recipient_ap_id")
  type          String
  createdAt     String @default(dbgenerated("datetime('now')")) @map("created_at")

  // Relations
  object    Object @relation(fields: [objectApId], references: [apId], onDelete: Cascade)
  recipient Actor  @relation(fields: [recipientApId], references: [apId], onDelete: Cascade)

  @@id([objectApId, recipientApId])
  @@index([recipientApId, createdAt(sort: Desc)])
  @@map("object_recipients")
}

// ============================================================
// INBOX
// ============================================================
model Inbox {
  actorApId    String @map("actor_ap_id")
  activityApId String @map("activity_ap_id")
  read         Int    @default(0)
  createdAt    String @default(dbgenerated("datetime('now')")) @map("created_at")

  // Relations
  actor    Actor    @relation(fields: [actorApId], references: [apId], onDelete: Cascade)
  activity Activity @relation(fields: [activityApId], references: [apId], onDelete: Cascade)

  @@id([actorApId, activityApId])
  @@index([actorApId, read, createdAt(sort: Desc)])
  @@index([activityApId])
  @@map("inbox")
}

// ============================================================
// SESSIONS
// ============================================================
model Session {
  id                     String  @id
  memberId               String  @map("member_id")
  accessToken            String  @map("access_token")
  refreshToken           String? @map("refresh_token")
  expiresAt              String  @map("expires_at")
  createdAt              String  @default(dbgenerated("datetime('now')")) @map("created_at")
  provider               String?
  providerAccessToken    String? @map("provider_access_token")
  providerRefreshToken   String? @map("provider_refresh_token")
  providerTokenExpiresAt String? @map("provider_token_expires_at")

  // Relations
  member Actor @relation(fields: [memberId], references: [apId], onDelete: Cascade)

  @@index([memberId])
  @@index([provider])
  @@index([expiresAt])
  @@map("sessions")
}

// ============================================================
// STORY_VIEWS
// ============================================================
model StoryView {
  actorApId String @map("actor_ap_id")
  storyApId String @map("story_ap_id")
  viewedAt  String @default(dbgenerated("datetime('now')")) @map("viewed_at")

  // Relations
  actor Actor  @relation(fields: [actorApId], references: [apId], onDelete: Cascade)
  story Object @relation(fields: [storyApId], references: [apId], onDelete: Cascade)

  @@id([actorApId, storyApId])
  @@index([actorApId])
  @@index([storyApId])
  @@map("story_views")
}

// ============================================================
// STORY_VOTES
// ============================================================
model StoryVote {
  id          String @id
  storyApId   String @map("story_ap_id")
  actorApId   String @map("actor_ap_id")
  optionIndex Int    @map("option_index")
  createdAt   String @default(dbgenerated("datetime('now')")) @map("created_at")

  // Relations
  actor Actor  @relation(fields: [actorApId], references: [apId], onDelete: Cascade)
  story Object @relation(fields: [storyApId], references: [apId], onDelete: Cascade)

  @@unique([storyApId, actorApId])
  @@index([storyApId])
  @@index([actorApId])
  @@map("story_votes")
}

// ============================================================
// STORY_SHARES
// ============================================================
model StoryShare {
  id        String @id
  storyApId String @map("story_ap_id")
  actorApId String @map("actor_ap_id")
  sharedAt  String @default(dbgenerated("datetime('now')")) @map("shared_at")

  // Relations
  actor Actor  @relation(fields: [actorApId], references: [apId], onDelete: Cascade)
  story Object @relation(fields: [storyApId], references: [apId], onDelete: Cascade)

  @@unique([storyApId, actorApId])
  @@index([storyApId])
  @@index([actorApId])
  @@map("story_shares")
}

// ============================================================
// NOTIFICATION_ARCHIVED
// ============================================================
model NotificationArchived {
  actorApId    String @map("actor_ap_id")
  activityApId String @map("activity_ap_id")
  archivedAt   String @default(dbgenerated("datetime('now')")) @map("archived_at")

  @@id([actorApId, activityApId])
  @@index([actorApId])
  @@map("notification_archived")
}

// ============================================================
// INSTANCE_ACTOR
// ============================================================
model InstanceActor {
  apId              String  @id @map("ap_id")
  preferredUsername String  @map("preferred_username")
  name              String?
  summary           String?
  publicKeyPem      String  @map("public_key_pem")
  privateKeyPem     String  @map("private_key_pem")
  joinPolicy        String  @default("open") @map("join_policy")
  postingPolicy     String  @default("members") @map("posting_policy")
  visibility        String  @default("public")
  createdAt         String  @default(dbgenerated("datetime('now')")) @map("created_at")
  updatedAt         String  @default(dbgenerated("datetime('now')")) @map("updated_at")

  @@map("instance_actor")
}

// ============================================================
// DM_TYPING
// ============================================================
model DmTyping {
  actorApId     String @map("actor_ap_id")
  recipientApId String @map("recipient_ap_id")
  lastTypedAt   String @map("last_typed_at")

  @@id([actorApId, recipientApId])
  @@index([recipientApId, lastTypedAt(sort: Desc)])
  @@map("dm_typing")
}

// ============================================================
// DM_READ_STATUS
// ============================================================
model DmReadStatus {
  actorApId      String @map("actor_ap_id")
  conversationId String @map("conversation_id")
  lastReadAt     String @default(dbgenerated("datetime('now')")) @map("last_read_at")

  @@id([actorApId, conversationId])
  @@index([actorApId])
  @@index([actorApId, lastReadAt(sort: Desc)])
  @@map("dm_read_status")
}

// ============================================================
// DM_ARCHIVED_CONVERSATIONS
// ============================================================
model DmArchivedConversation {
  actorApId      String  @map("actor_ap_id")
  conversationId String  @map("conversation_id")
  archivedAt     String? @default(dbgenerated("datetime('now')")) @map("archived_at")

  @@id([actorApId, conversationId])
  @@index([actorApId])
  @@map("dm_archived_conversations")
}
`
    };
    config2.runtimeDataModel = JSON.parse('{"models":{"Actor":{"fields":[{"name":"apId","kind":"scalar","type":"String","dbName":"ap_id"},{"name":"type","kind":"scalar","type":"String"},{"name":"preferredUsername","kind":"scalar","type":"String","dbName":"preferred_username"},{"name":"name","kind":"scalar","type":"String"},{"name":"summary","kind":"scalar","type":"String"},{"name":"iconUrl","kind":"scalar","type":"String","dbName":"icon_url"},{"name":"headerUrl","kind":"scalar","type":"String","dbName":"header_url"},{"name":"inbox","kind":"scalar","type":"String"},{"name":"outbox","kind":"scalar","type":"String"},{"name":"followersUrl","kind":"scalar","type":"String","dbName":"followers_url"},{"name":"followingUrl","kind":"scalar","type":"String","dbName":"following_url"},{"name":"publicKeyPem","kind":"scalar","type":"String","dbName":"public_key_pem"},{"name":"privateKeyPem","kind":"scalar","type":"String","dbName":"private_key_pem"},{"name":"takosUserId","kind":"scalar","type":"String","dbName":"takos_user_id"},{"name":"followerCount","kind":"scalar","type":"Int","dbName":"follower_count"},{"name":"followingCount","kind":"scalar","type":"Int","dbName":"following_count"},{"name":"postCount","kind":"scalar","type":"Int","dbName":"post_count"},{"name":"isPrivate","kind":"scalar","type":"Int","dbName":"is_private"},{"name":"role","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"updatedAt","kind":"scalar","type":"String","dbName":"updated_at"},{"name":"sessions","kind":"object","type":"Session","relationName":"ActorToSession"},{"name":"objectsAuthored","kind":"object","type":"Object","relationName":"AuthoredObjects"},{"name":"followsAsFollower","kind":"object","type":"Follow","relationName":"FollowerFollows"},{"name":"followsAsFollowing","kind":"object","type":"Follow","relationName":"FollowingFollows"},{"name":"likes","kind":"object","type":"Like","relationName":"ActorToLike"},{"name":"announces","kind":"object","type":"Announce","relationName":"ActorToAnnounce"},{"name":"bookmarks","kind":"object","type":"Bookmark","relationName":"ActorToBookmark"},{"name":"blocksAsBlocker","kind":"object","type":"Block","relationName":"BlockerBlocks"},{"name":"blocksAsBlocked","kind":"object","type":"Block","relationName":"BlockedBlocks"},{"name":"mutesAsMuter","kind":"object","type":"Mute","relationName":"MuterMutes"},{"name":"mutesAsMuted","kind":"object","type":"Mute","relationName":"MutedMutes"},{"name":"activities","kind":"object","type":"Activity","relationName":"ActivityToActor"},{"name":"storyViews","kind":"object","type":"StoryView","relationName":"ActorToStoryView"},{"name":"storyVotes","kind":"object","type":"StoryVote","relationName":"ActorToStoryVote"},{"name":"storyShares","kind":"object","type":"StoryShare","relationName":"ActorToStoryShare"},{"name":"communityMemberships","kind":"object","type":"CommunityMember","relationName":"ActorToCommunityMember"},{"name":"communityJoinRequests","kind":"object","type":"CommunityJoinRequest","relationName":"ActorToCommunityJoinRequest"},{"name":"communityInvites","kind":"object","type":"CommunityInvite","relationName":"InvitedByActor"},{"name":"inboxItems","kind":"object","type":"Inbox","relationName":"ActorToInbox"},{"name":"objectRecipients","kind":"object","type":"ObjectRecipient","relationName":"ActorToObjectRecipient"}],"dbName":"actors"},"ActorCache":{"fields":[{"name":"apId","kind":"scalar","type":"String","dbName":"ap_id"},{"name":"type","kind":"scalar","type":"String"},{"name":"preferredUsername","kind":"scalar","type":"String","dbName":"preferred_username"},{"name":"name","kind":"scalar","type":"String"},{"name":"summary","kind":"scalar","type":"String"},{"name":"iconUrl","kind":"scalar","type":"String","dbName":"icon_url"},{"name":"inbox","kind":"scalar","type":"String"},{"name":"outbox","kind":"scalar","type":"String"},{"name":"followersUrl","kind":"scalar","type":"String","dbName":"followers_url"},{"name":"followingUrl","kind":"scalar","type":"String","dbName":"following_url"},{"name":"sharedInbox","kind":"scalar","type":"String","dbName":"shared_inbox"},{"name":"publicKeyId","kind":"scalar","type":"String","dbName":"public_key_id"},{"name":"publicKeyPem","kind":"scalar","type":"String","dbName":"public_key_pem"},{"name":"rawJson","kind":"scalar","type":"String","dbName":"raw_json"},{"name":"lastFetchedAt","kind":"scalar","type":"String","dbName":"last_fetched_at"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"}],"dbName":"actor_cache"},"Object":{"fields":[{"name":"apId","kind":"scalar","type":"String","dbName":"ap_id"},{"name":"type","kind":"scalar","type":"String"},{"name":"attributedTo","kind":"scalar","type":"String","dbName":"attributed_to"},{"name":"content","kind":"scalar","type":"String"},{"name":"summary","kind":"scalar","type":"String"},{"name":"attachmentsJson","kind":"scalar","type":"String","dbName":"attachments_json"},{"name":"inReplyTo","kind":"scalar","type":"String","dbName":"in_reply_to"},{"name":"conversation","kind":"scalar","type":"String"},{"name":"visibility","kind":"scalar","type":"String"},{"name":"toJson","kind":"scalar","type":"String","dbName":"to_json"},{"name":"ccJson","kind":"scalar","type":"String","dbName":"cc_json"},{"name":"audienceJson","kind":"scalar","type":"String","dbName":"audience_json"},{"name":"communityApId","kind":"scalar","type":"String","dbName":"community_ap_id"},{"name":"endTime","kind":"scalar","type":"String","dbName":"end_time"},{"name":"likeCount","kind":"scalar","type":"Int","dbName":"like_count"},{"name":"replyCount","kind":"scalar","type":"Int","dbName":"reply_count"},{"name":"announceCount","kind":"scalar","type":"Int","dbName":"announce_count"},{"name":"shareCount","kind":"scalar","type":"Int","dbName":"share_count"},{"name":"published","kind":"scalar","type":"String"},{"name":"updated","kind":"scalar","type":"String"},{"name":"isLocal","kind":"scalar","type":"Int","dbName":"is_local"},{"name":"rawJson","kind":"scalar","type":"String","dbName":"raw_json"},{"name":"author","kind":"object","type":"Actor","relationName":"AuthoredObjects"},{"name":"community","kind":"object","type":"Community","relationName":"CommunityToObject"},{"name":"likes","kind":"object","type":"Like","relationName":"LikeToObject"},{"name":"announces","kind":"object","type":"Announce","relationName":"AnnounceToObject"},{"name":"bookmarks","kind":"object","type":"Bookmark","relationName":"BookmarkToObject"},{"name":"storyViews","kind":"object","type":"StoryView","relationName":"ObjectToStoryView"},{"name":"storyVotes","kind":"object","type":"StoryVote","relationName":"ObjectToStoryVote"},{"name":"storyShares","kind":"object","type":"StoryShare","relationName":"ObjectToStoryShare"},{"name":"recipients","kind":"object","type":"ObjectRecipient","relationName":"ObjectToObjectRecipient"},{"name":"activities","kind":"object","type":"Activity","relationName":"ActivityToObject"}],"dbName":"objects"},"Follow":{"fields":[{"name":"followerApId","kind":"scalar","type":"String","dbName":"follower_ap_id"},{"name":"followingApId","kind":"scalar","type":"String","dbName":"following_ap_id"},{"name":"status","kind":"scalar","type":"String"},{"name":"activityApId","kind":"scalar","type":"String","dbName":"activity_ap_id"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"acceptedAt","kind":"scalar","type":"String","dbName":"accepted_at"},{"name":"follower","kind":"object","type":"Actor","relationName":"FollowerFollows"},{"name":"following","kind":"object","type":"Actor","relationName":"FollowingFollows"}],"dbName":"follows"},"Like":{"fields":[{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"objectApId","kind":"scalar","type":"String","dbName":"object_ap_id"},{"name":"activityApId","kind":"scalar","type":"String","dbName":"activity_ap_id"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"actor","kind":"object","type":"Actor","relationName":"ActorToLike"},{"name":"object","kind":"object","type":"Object","relationName":"LikeToObject"}],"dbName":"likes"},"Announce":{"fields":[{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"objectApId","kind":"scalar","type":"String","dbName":"object_ap_id"},{"name":"activityApId","kind":"scalar","type":"String","dbName":"activity_ap_id"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"actor","kind":"object","type":"Actor","relationName":"ActorToAnnounce"},{"name":"object","kind":"object","type":"Object","relationName":"AnnounceToObject"}],"dbName":"announces"},"Bookmark":{"fields":[{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"objectApId","kind":"scalar","type":"String","dbName":"object_ap_id"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"actor","kind":"object","type":"Actor","relationName":"ActorToBookmark"},{"name":"object","kind":"object","type":"Object","relationName":"BookmarkToObject"}],"dbName":"bookmarks"},"Block":{"fields":[{"name":"blockerApId","kind":"scalar","type":"String","dbName":"blocker_ap_id"},{"name":"blockedApId","kind":"scalar","type":"String","dbName":"blocked_ap_id"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"blocker","kind":"object","type":"Actor","relationName":"BlockerBlocks"},{"name":"blocked","kind":"object","type":"Actor","relationName":"BlockedBlocks"}],"dbName":"blocks"},"Mute":{"fields":[{"name":"muterApId","kind":"scalar","type":"String","dbName":"muter_ap_id"},{"name":"mutedApId","kind":"scalar","type":"String","dbName":"muted_ap_id"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"muter","kind":"object","type":"Actor","relationName":"MuterMutes"},{"name":"muted","kind":"object","type":"Actor","relationName":"MutedMutes"}],"dbName":"mutes"},"Activity":{"fields":[{"name":"apId","kind":"scalar","type":"String","dbName":"ap_id"},{"name":"type","kind":"scalar","type":"String"},{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"objectApId","kind":"scalar","type":"String","dbName":"object_ap_id"},{"name":"objectJson","kind":"scalar","type":"String","dbName":"object_json"},{"name":"targetApId","kind":"scalar","type":"String","dbName":"target_ap_id"},{"name":"rawJson","kind":"scalar","type":"String","dbName":"raw_json"},{"name":"direction","kind":"scalar","type":"String"},{"name":"processed","kind":"scalar","type":"Int"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"actor","kind":"object","type":"Actor","relationName":"ActivityToActor"},{"name":"object","kind":"object","type":"Object","relationName":"ActivityToObject"},{"name":"inboxItems","kind":"object","type":"Inbox","relationName":"ActivityToInbox"}],"dbName":"activities"},"DeliveryQueue":{"fields":[{"name":"id","kind":"scalar","type":"String"},{"name":"activityApId","kind":"scalar","type":"String","dbName":"activity_ap_id"},{"name":"inboxUrl","kind":"scalar","type":"String","dbName":"inbox_url"},{"name":"attempts","kind":"scalar","type":"Int"},{"name":"lastAttemptAt","kind":"scalar","type":"String","dbName":"last_attempt_at"},{"name":"nextAttemptAt","kind":"scalar","type":"String","dbName":"next_attempt_at"},{"name":"error","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"}],"dbName":"delivery_queue"},"Community":{"fields":[{"name":"apId","kind":"scalar","type":"String","dbName":"ap_id"},{"name":"type","kind":"scalar","type":"String"},{"name":"preferredUsername","kind":"scalar","type":"String","dbName":"preferred_username"},{"name":"name","kind":"scalar","type":"String"},{"name":"summary","kind":"scalar","type":"String"},{"name":"iconUrl","kind":"scalar","type":"String","dbName":"icon_url"},{"name":"inbox","kind":"scalar","type":"String"},{"name":"outbox","kind":"scalar","type":"String"},{"name":"followersUrl","kind":"scalar","type":"String","dbName":"followers_url"},{"name":"visibility","kind":"scalar","type":"String"},{"name":"joinPolicy","kind":"scalar","type":"String","dbName":"join_policy"},{"name":"postPolicy","kind":"scalar","type":"String","dbName":"post_policy"},{"name":"publicKeyPem","kind":"scalar","type":"String","dbName":"public_key_pem"},{"name":"privateKeyPem","kind":"scalar","type":"String","dbName":"private_key_pem"},{"name":"createdBy","kind":"scalar","type":"String","dbName":"created_by"},{"name":"memberCount","kind":"scalar","type":"Int","dbName":"member_count"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"lastMessageAt","kind":"scalar","type":"String","dbName":"last_message_at"},{"name":"members","kind":"object","type":"CommunityMember","relationName":"CommunityToCommunityMember"},{"name":"objects","kind":"object","type":"Object","relationName":"CommunityToObject"},{"name":"joinRequests","kind":"object","type":"CommunityJoinRequest","relationName":"CommunityToCommunityJoinRequest"},{"name":"invites","kind":"object","type":"CommunityInvite","relationName":"CommunityToCommunityInvite"}],"dbName":"communities"},"CommunityMember":{"fields":[{"name":"communityApId","kind":"scalar","type":"String","dbName":"community_ap_id"},{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"role","kind":"scalar","type":"String"},{"name":"joinedAt","kind":"scalar","type":"String","dbName":"joined_at"},{"name":"community","kind":"object","type":"Community","relationName":"CommunityToCommunityMember"},{"name":"actor","kind":"object","type":"Actor","relationName":"ActorToCommunityMember"}],"dbName":"community_members"},"CommunityJoinRequest":{"fields":[{"name":"communityApId","kind":"scalar","type":"String","dbName":"community_ap_id"},{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"status","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"processedAt","kind":"scalar","type":"String","dbName":"processed_at"},{"name":"community","kind":"object","type":"Community","relationName":"CommunityToCommunityJoinRequest"},{"name":"actor","kind":"object","type":"Actor","relationName":"ActorToCommunityJoinRequest"}],"dbName":"community_join_requests"},"CommunityInvite":{"fields":[{"name":"id","kind":"scalar","type":"String"},{"name":"communityApId","kind":"scalar","type":"String","dbName":"community_ap_id"},{"name":"invitedByApId","kind":"scalar","type":"String","dbName":"invited_by_ap_id"},{"name":"invitedApId","kind":"scalar","type":"String","dbName":"invited_ap_id"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"expiresAt","kind":"scalar","type":"String","dbName":"expires_at"},{"name":"usedAt","kind":"scalar","type":"String","dbName":"used_at"},{"name":"usedByApId","kind":"scalar","type":"String","dbName":"used_by_ap_id"},{"name":"community","kind":"object","type":"Community","relationName":"CommunityToCommunityInvite"},{"name":"invitedBy","kind":"object","type":"Actor","relationName":"InvitedByActor"}],"dbName":"community_invites"},"ObjectRecipient":{"fields":[{"name":"objectApId","kind":"scalar","type":"String","dbName":"object_ap_id"},{"name":"recipientApId","kind":"scalar","type":"String","dbName":"recipient_ap_id"},{"name":"type","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"object","kind":"object","type":"Object","relationName":"ObjectToObjectRecipient"},{"name":"recipient","kind":"object","type":"Actor","relationName":"ActorToObjectRecipient"}],"dbName":"object_recipients"},"Inbox":{"fields":[{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"activityApId","kind":"scalar","type":"String","dbName":"activity_ap_id"},{"name":"read","kind":"scalar","type":"Int"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"actor","kind":"object","type":"Actor","relationName":"ActorToInbox"},{"name":"activity","kind":"object","type":"Activity","relationName":"ActivityToInbox"}],"dbName":"inbox"},"Session":{"fields":[{"name":"id","kind":"scalar","type":"String"},{"name":"memberId","kind":"scalar","type":"String","dbName":"member_id"},{"name":"accessToken","kind":"scalar","type":"String","dbName":"access_token"},{"name":"refreshToken","kind":"scalar","type":"String","dbName":"refresh_token"},{"name":"expiresAt","kind":"scalar","type":"String","dbName":"expires_at"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"provider","kind":"scalar","type":"String"},{"name":"providerAccessToken","kind":"scalar","type":"String","dbName":"provider_access_token"},{"name":"providerRefreshToken","kind":"scalar","type":"String","dbName":"provider_refresh_token"},{"name":"providerTokenExpiresAt","kind":"scalar","type":"String","dbName":"provider_token_expires_at"},{"name":"member","kind":"object","type":"Actor","relationName":"ActorToSession"}],"dbName":"sessions"},"StoryView":{"fields":[{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"storyApId","kind":"scalar","type":"String","dbName":"story_ap_id"},{"name":"viewedAt","kind":"scalar","type":"String","dbName":"viewed_at"},{"name":"actor","kind":"object","type":"Actor","relationName":"ActorToStoryView"},{"name":"story","kind":"object","type":"Object","relationName":"ObjectToStoryView"}],"dbName":"story_views"},"StoryVote":{"fields":[{"name":"id","kind":"scalar","type":"String"},{"name":"storyApId","kind":"scalar","type":"String","dbName":"story_ap_id"},{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"optionIndex","kind":"scalar","type":"Int","dbName":"option_index"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"actor","kind":"object","type":"Actor","relationName":"ActorToStoryVote"},{"name":"story","kind":"object","type":"Object","relationName":"ObjectToStoryVote"}],"dbName":"story_votes"},"StoryShare":{"fields":[{"name":"id","kind":"scalar","type":"String"},{"name":"storyApId","kind":"scalar","type":"String","dbName":"story_ap_id"},{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"sharedAt","kind":"scalar","type":"String","dbName":"shared_at"},{"name":"actor","kind":"object","type":"Actor","relationName":"ActorToStoryShare"},{"name":"story","kind":"object","type":"Object","relationName":"ObjectToStoryShare"}],"dbName":"story_shares"},"NotificationArchived":{"fields":[{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"activityApId","kind":"scalar","type":"String","dbName":"activity_ap_id"},{"name":"archivedAt","kind":"scalar","type":"String","dbName":"archived_at"}],"dbName":"notification_archived"},"InstanceActor":{"fields":[{"name":"apId","kind":"scalar","type":"String","dbName":"ap_id"},{"name":"preferredUsername","kind":"scalar","type":"String","dbName":"preferred_username"},{"name":"name","kind":"scalar","type":"String"},{"name":"summary","kind":"scalar","type":"String"},{"name":"publicKeyPem","kind":"scalar","type":"String","dbName":"public_key_pem"},{"name":"privateKeyPem","kind":"scalar","type":"String","dbName":"private_key_pem"},{"name":"joinPolicy","kind":"scalar","type":"String","dbName":"join_policy"},{"name":"postingPolicy","kind":"scalar","type":"String","dbName":"posting_policy"},{"name":"visibility","kind":"scalar","type":"String"},{"name":"createdAt","kind":"scalar","type":"String","dbName":"created_at"},{"name":"updatedAt","kind":"scalar","type":"String","dbName":"updated_at"}],"dbName":"instance_actor"},"DmTyping":{"fields":[{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"recipientApId","kind":"scalar","type":"String","dbName":"recipient_ap_id"},{"name":"lastTypedAt","kind":"scalar","type":"String","dbName":"last_typed_at"}],"dbName":"dm_typing"},"DmReadStatus":{"fields":[{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"conversationId","kind":"scalar","type":"String","dbName":"conversation_id"},{"name":"lastReadAt","kind":"scalar","type":"String","dbName":"last_read_at"}],"dbName":"dm_read_status"},"DmArchivedConversation":{"fields":[{"name":"actorApId","kind":"scalar","type":"String","dbName":"actor_ap_id"},{"name":"conversationId","kind":"scalar","type":"String","dbName":"conversation_id"},{"name":"archivedAt","kind":"scalar","type":"String","dbName":"archived_at"}],"dbName":"dm_archived_conversations"}},"enums":{},"types":{}}');
    defineDmmfProperty2(exports.Prisma, config2.runtimeDataModel);
    config2.compilerWasm = {
      getRuntime: async () => require_query_compiler_bg(),
      getQueryCompilerWasmModule: async () => {
        const loader = (await Promise.resolve().then(() => (init_wasm_worker_loader(), wasm_worker_loader_exports))).default;
        const compiler = (await loader).default;
        return compiler;
      }
    };
    if (typeof globalThis !== "undefined" && globalThis["DEBUG"] || typeof process !== "undefined" && process.env && process.env.DEBUG || void 0) {
      Debug3.enable(typeof globalThis !== "undefined" && globalThis["DEBUG"] || typeof process !== "undefined" && process.env && process.env.DEBUG || void 0);
    }
    var PrismaClient2 = getPrismaClient2(config2);
    exports.PrismaClient = PrismaClient2;
    Object.assign(exports, Prisma);
  }
});

// src/generated/prisma/default.js
var require_default = __commonJS({
  "src/generated/prisma/default.js"(exports, module) {
    "use strict";
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    module.exports = { ...require_edge() };
  }
});

// node_modules/@prisma/debug/dist/index.mjs
function init(x, y) {
  let rgx = new RegExp(`\\x1b\\[${y}m`, "g");
  let open = `\x1B[${x}m`, close = `\x1B[${y}m`;
  return function(txt) {
    if (!$.enabled || txt == null)
      return txt;
    return open + (!!~("" + txt).indexOf(close) ? txt.replace(rgx, close + open) : txt) + close;
  };
}
function debugCreate(namespace) {
  const instanceProps = {
    color: COLORS[lastColor++ % COLORS.length],
    enabled: topProps.enabled(namespace),
    namespace,
    log: topProps.log,
    extend: () => {
    }
    // not implemented
  };
  const debugCall = /* @__PURE__ */ __name((...args) => {
    const { enabled, namespace: namespace2, color, log: log3 } = instanceProps;
    if (args.length !== 0) {
      argsHistory.push([namespace2, ...args]);
    }
    if (argsHistory.length > MAX_ARGS_HISTORY) {
      argsHistory.shift();
    }
    if (topProps.enabled(namespace2) || enabled) {
      const stringArgs = args.map((arg) => {
        if (typeof arg === "string") {
          return arg;
        }
        return safeStringify(arg);
      });
      const ms = `+${Date.now() - lastTimestamp}ms`;
      lastTimestamp = Date.now();
      if (globalThis.DEBUG_COLORS) {
        log3(colors_exports[color](bold(namespace2)), ...stringArgs, colors_exports[color](ms));
      } else {
        log3(namespace2, ...stringArgs, ms);
      }
    }
  }, "debugCall");
  return new Proxy(debugCall, {
    get: (_, prop) => instanceProps[prop],
    set: (_, prop, value) => instanceProps[prop] = value
  });
}
function safeStringify(value, indent = 2) {
  const cache = /* @__PURE__ */ new Set();
  return JSON.stringify(
    value,
    (key, value2) => {
      if (typeof value2 === "object" && value2 !== null) {
        if (cache.has(value2)) {
          return `[Circular *]`;
        }
        cache.add(value2);
      } else if (typeof value2 === "bigint") {
        return value2.toString();
      }
      return value2;
    },
    indent
  );
}
var __defProp2, __export2, colors_exports, FORCE_COLOR, NODE_DISABLE_COLORS, NO_COLOR, TERM, isTTY, $, reset, bold, dim, italic, underline, inverse, hidden, strikethrough, black, red, green, yellow, blue, magenta, cyan, white, gray, grey, bgBlack, bgRed, bgGreen, bgYellow, bgBlue, bgMagenta, bgCyan, bgWhite, MAX_ARGS_HISTORY, COLORS, argsHistory, lastTimestamp, lastColor, processEnv, topProps, Debug2;
var init_dist = __esm({
  "node_modules/@prisma/debug/dist/index.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    __defProp2 = Object.defineProperty;
    __export2 = /* @__PURE__ */ __name((target, all) => {
      for (var name2 in all)
        __defProp2(target, name2, { get: all[name2], enumerable: true });
    }, "__export");
    colors_exports = {};
    __export2(colors_exports, {
      $: () => $,
      bgBlack: () => bgBlack,
      bgBlue: () => bgBlue,
      bgCyan: () => bgCyan,
      bgGreen: () => bgGreen,
      bgMagenta: () => bgMagenta,
      bgRed: () => bgRed,
      bgWhite: () => bgWhite,
      bgYellow: () => bgYellow,
      black: () => black,
      blue: () => blue,
      bold: () => bold,
      cyan: () => cyan,
      dim: () => dim,
      gray: () => gray,
      green: () => green,
      grey: () => grey,
      hidden: () => hidden,
      inverse: () => inverse,
      italic: () => italic,
      magenta: () => magenta,
      red: () => red,
      reset: () => reset,
      strikethrough: () => strikethrough,
      underline: () => underline,
      white: () => white,
      yellow: () => yellow
    });
    isTTY = true;
    if (typeof process !== "undefined") {
      ({ FORCE_COLOR, NODE_DISABLE_COLORS, NO_COLOR, TERM } = process.env || {});
      isTTY = process.stdout && process.stdout.isTTY;
    }
    $ = {
      enabled: !NODE_DISABLE_COLORS && NO_COLOR == null && TERM !== "dumb" && (FORCE_COLOR != null && FORCE_COLOR !== "0" || isTTY)
    };
    __name(init, "init");
    reset = init(0, 0);
    bold = init(1, 22);
    dim = init(2, 22);
    italic = init(3, 23);
    underline = init(4, 24);
    inverse = init(7, 27);
    hidden = init(8, 28);
    strikethrough = init(9, 29);
    black = init(30, 39);
    red = init(31, 39);
    green = init(32, 39);
    yellow = init(33, 39);
    blue = init(34, 39);
    magenta = init(35, 39);
    cyan = init(36, 39);
    white = init(37, 39);
    gray = init(90, 39);
    grey = init(90, 39);
    bgBlack = init(40, 49);
    bgRed = init(41, 49);
    bgGreen = init(42, 49);
    bgYellow = init(43, 49);
    bgBlue = init(44, 49);
    bgMagenta = init(45, 49);
    bgCyan = init(46, 49);
    bgWhite = init(47, 49);
    MAX_ARGS_HISTORY = 100;
    COLORS = ["green", "yellow", "blue", "magenta", "cyan", "red"];
    argsHistory = [];
    lastTimestamp = Date.now();
    lastColor = 0;
    processEnv = typeof process !== "undefined" ? process.env : {};
    globalThis.DEBUG ??= processEnv.DEBUG ?? "";
    globalThis.DEBUG_COLORS ??= processEnv.DEBUG_COLORS ? processEnv.DEBUG_COLORS === "true" : true;
    topProps = {
      enable(namespace) {
        if (typeof namespace === "string") {
          globalThis.DEBUG = namespace;
        }
      },
      disable() {
        const prev = globalThis.DEBUG;
        globalThis.DEBUG = "";
        return prev;
      },
      // this is the core logic to check if logging should happen or not
      enabled(namespace) {
        const listenedNamespaces = globalThis.DEBUG.split(",").map((s) => {
          return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
        });
        const isListened = listenedNamespaces.some((listenedNamespace) => {
          if (listenedNamespace === "" || listenedNamespace[0] === "-")
            return false;
          return namespace.match(RegExp(listenedNamespace.split("*").join(".*") + "$"));
        });
        const isExcluded = listenedNamespaces.some((listenedNamespace) => {
          if (listenedNamespace === "" || listenedNamespace[0] !== "-")
            return false;
          return namespace.match(RegExp(listenedNamespace.slice(1).split("*").join(".*") + "$"));
        });
        return isListened && !isExcluded;
      },
      log: (...args) => {
        const [namespace, format, ...rest] = args;
        const logWithFormatting = console.warn ?? console.log;
        logWithFormatting(`${namespace} ${format}`, ...rest);
      },
      formatters: {}
      // not implemented
    };
    __name(debugCreate, "debugCreate");
    Debug2 = new Proxy(debugCreate, {
      get: (_, prop) => topProps[prop],
      set: (_, prop, value) => topProps[prop] = value
    });
    __name(safeStringify, "safeStringify");
  }
});

// node_modules/@prisma/driver-adapter-utils/dist/index.mjs
var DriverAdapterError, debug3, ColumnTypeEnum, mockAdapterErrors;
var init_dist2 = __esm({
  "node_modules/@prisma/driver-adapter-utils/dist/index.mjs"() {
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
    init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
    init_performance2();
    init_dist();
    DriverAdapterError = /* @__PURE__ */ __name(class extends Error {
      name = "DriverAdapterError";
      cause;
      constructor(payload) {
        super(typeof payload["message"] === "string" ? payload["message"] : payload.kind);
        this.cause = payload;
      }
    }, "DriverAdapterError");
    debug3 = Debug2("driver-adapter-utils");
    ColumnTypeEnum = {
      // Scalars
      Int32: 0,
      Int64: 1,
      Float: 2,
      Double: 3,
      Numeric: 4,
      Boolean: 5,
      Character: 6,
      Text: 7,
      Date: 8,
      Time: 9,
      DateTime: 10,
      Json: 11,
      Enum: 12,
      Bytes: 13,
      Set: 14,
      Uuid: 15,
      // Arrays
      Int32Array: 64,
      Int64Array: 65,
      FloatArray: 66,
      DoubleArray: 67,
      NumericArray: 68,
      BooleanArray: 69,
      CharacterArray: 70,
      TextArray: 71,
      DateArray: 72,
      TimeArray: 73,
      DateTimeArray: 74,
      JsonArray: 75,
      EnumArray: 76,
      BytesArray: 77,
      UuidArray: 78,
      // Custom
      UnknownNumber: 128
    };
    mockAdapterErrors = {
      queryRaw: new Error("Not implemented: queryRaw"),
      executeRaw: new Error("Not implemented: executeRaw"),
      startTransaction: new Error("Not implemented: startTransaction"),
      executeScript: new Error("Not implemented: executeScript"),
      dispose: new Error("Not implemented: dispose")
    };
  }
});

// src/backend/index.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/hono.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/hono-base.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/compose.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var compose = /* @__PURE__ */ __name((middleware, onError3, onNotFound) => {
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
          if (err instanceof Error && onError3) {
            context2.error = err;
            res = await onError3(err, context2);
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

// node_modules/hono/dist/context.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/request.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/http-exception.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/request/constants.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var GET_MATCH_RESULT = /* @__PURE__ */ Symbol();

// node_modules/hono/dist/utils/body.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
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

// node_modules/hono/dist/utils/url.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
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
  path = path.replace(/\{[^}]+\}/g, (match2, index) => {
    const mark = `@${index}`;
    groups.push([mark, match2]);
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
  const match2 = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match2) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match2[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match2[1], new RegExp(`^${match2[2]}(?=/${next})`)] : [label, match2[1], new RegExp(`^${match2[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match2[1], true];
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
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match2) => {
      try {
        return decoder(match2);
      } catch {
        return match2;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
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
    let keyIndex2 = url.indexOf("?", 8);
    if (keyIndex2 === -1) {
      return void 0;
    }
    if (!url.startsWith(key, keyIndex2 + 1)) {
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
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
    let name2 = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name2 = _decodeURI(name2);
    }
    keyIndex = nextKeyIndex;
    if (name2 === "") {
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
      if (!(results[name2] && Array.isArray(results[name2]))) {
        results[name2] = [];
      }
      ;
      results[name2].push(value);
    } else {
      results[name2] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = /* @__PURE__ */ __name(class {
  /**
   * `.raw` can get the raw Request object.
   *
   * @see {@link https://hono.dev/docs/api/request#raw}
   *
   * @example
   * ```ts
   * // For Cloudflare Workers
   * app.post('/', async (c) => {
   *   const metadata = c.req.raw.cf?.hostMetadata?
   *   ...
   * })
   * ```
   */
  raw;
  #validatedData;
  // Short name of validatedData
  #matchResult;
  routeIndex = 0;
  /**
   * `.path` can get the pathname of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#path}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const pathname = c.req.path // `/about/me`
   * })
   * ```
   */
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
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
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
  header(name2) {
    if (name2) {
      return this.raw.headers.get(name2) ?? void 0;
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
  #cachedBody = (key) => {
    const { bodyCache, raw: raw3 } = this;
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
    return bodyCache[key] = raw3[key]();
  };
  /**
   * `.json()` can parse Request body of type `application/json`
   *
   * @see {@link https://hono.dev/docs/api/request#json}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.json()
   * })
   * ```
   */
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  /**
   * `.text()` can parse Request body of type `text/plain`
   *
   * @see {@link https://hono.dev/docs/api/request#text}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.text()
   * })
   * ```
   */
  text() {
    return this.#cachedBody("text");
  }
  /**
   * `.arrayBuffer()` parse Request body as an `ArrayBuffer`
   *
   * @see {@link https://hono.dev/docs/api/request#arraybuffer}
   *
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.arrayBuffer()
   * })
   * ```
   */
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  /**
   * Parses the request body as a `Blob`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.blob();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#blob
   */
  blob() {
    return this.#cachedBody("blob");
  }
  /**
   * Parses the request body as `FormData`.
   * @example
   * ```ts
   * app.post('/entry', async (c) => {
   *   const body = await c.req.formData();
   * });
   * ```
   * @see https://hono.dev/docs/api/request#formdata
   */
  formData() {
    return this.#cachedBody("formData");
  }
  /**
   * Adds validated data to the request.
   *
   * @param target - The target of the validation.
   * @param data - The validated data to add.
   */
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  /**
   * `.url()` can get the request url strings.
   *
   * @see {@link https://hono.dev/docs/api/request#url}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const url = c.req.url // `http://localhost:8787/about/me`
   *   ...
   * })
   * ```
   */
  get url() {
    return this.raw.url;
  }
  /**
   * `.method()` can get the method name of the request.
   *
   * @see {@link https://hono.dev/docs/api/request#method}
   *
   * @example
   * ```ts
   * app.get('/about/me', (c) => {
   *   const method = c.req.method // `GET`
   * })
   * ```
   */
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  /**
   * `.matchedRoutes()` can return a matched route in the handler
   *
   * @deprecated
   *
   * Use matchedRoutes helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#matchedroutes}
   *
   * @example
   * ```ts
   * app.use('*', async function logger(c, next) {
   *   await next()
   *   c.req.matchedRoutes.forEach(({ handler, method, path }, i) => {
   *     const name = handler.name || (handler.length < 2 ? '[handler]' : '[middleware]')
   *     console.log(
   *       method,
   *       ' ',
   *       path,
   *       ' '.repeat(Math.max(10 - path.length, 0)),
   *       name,
   *       i === c.req.routeIndex ? '<- respond from here' : ''
   *     )
   *   })
   * })
   * ```
   */
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  /**
   * `routePath()` can retrieve the path registered within the handler
   *
   * @deprecated
   *
   * Use routePath helper defined in "hono/route" instead.
   *
   * @see {@link https://hono.dev/docs/api/request#routepath}
   *
   * @example
   * ```ts
   * app.get('/posts/:id', (c) => {
   *   return c.json({ path: c.req.routePath })
   * })
   * ```
   */
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
}, "HonoRequest");

// node_modules/hono/dist/utils/html.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw2 = /* @__PURE__ */ __name((value, callbacks) => {
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
    return raw2(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var Context = /* @__PURE__ */ __name(class {
  #rawRequest;
  #req;
  /**
   * `.env` can get bindings (environment variables, secrets, KV namespaces, D1 database, R2 bucket etc.) in Cloudflare Workers.
   *
   * @see {@link https://hono.dev/docs/api/context#env}
   *
   * @example
   * ```ts
   * // Environment object for Cloudflare Workers
   * app.get('*', async c => {
   *   const counter = c.env.COUNTER
   * })
   * ```
   */
  env = {};
  #var;
  finalized = false;
  /**
   * `.error` can get the error object from the middleware if the Handler throws an error.
   *
   * @see {@link https://hono.dev/docs/api/context#error}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   await next()
   *   if (c.error) {
   *     // do something...
   *   }
   * })
   * ```
   */
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
  /**
   * Creates an instance of the Context class.
   *
   * @param req - The Request object.
   * @param options - Optional configuration options for the context.
   */
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
  /**
   * `.req` is the instance of {@link HonoRequest}.
   */
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#event}
   * The FetchEvent associated with the current request.
   *
   * @throws Will throw an error if the context does not have a FetchEvent.
   */
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#executionctx}
   * The ExecutionContext associated with the current request.
   *
   * @throws Will throw an error if the context does not have an ExecutionContext.
   */
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  /**
   * @see {@link https://hono.dev/docs/api/context#res}
   * The Response object for the current request.
   */
  get res() {
    return this.#res ||= new Response(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  /**
   * Sets the Response object for the current request.
   *
   * @param _res - The Response object to set.
   */
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
  /**
   * `.render()` can create a response within a layout.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   return c.render('Hello!')
   * })
   * ```
   */
  render = (...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  };
  /**
   * Sets the layout for the response.
   *
   * @param layout - The layout to set.
   * @returns The layout function.
   */
  setLayout = (layout) => this.#layout = layout;
  /**
   * Gets the current layout for the response.
   *
   * @returns The current layout function.
   */
  getLayout = () => this.#layout;
  /**
   * `.setRenderer()` can set the layout in the custom middleware.
   *
   * @see {@link https://hono.dev/docs/api/context#render-setrenderer}
   *
   * @example
   * ```tsx
   * app.use('*', async (c, next) => {
   *   c.setRenderer((content) => {
   *     return c.html(
   *       <html>
   *         <body>
   *           <p>{content}</p>
   *         </body>
   *       </html>
   *     )
   *   })
   *   await next()
   * })
   * ```
   */
  setRenderer = (renderer) => {
    this.#renderer = renderer;
  };
  /**
   * `.header()` can set headers.
   *
   * @see {@link https://hono.dev/docs/api/context#header}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  header = (name2, value, options) => {
    if (this.finalized) {
      this.#res = new Response(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name2);
    } else if (options?.append) {
      headers.append(name2, value);
    } else {
      headers.set(name2, value);
    }
  };
  status = (status) => {
    this.#status = status;
  };
  /**
   * `.set()` can set the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.use('*', async (c, next) => {
   *   c.set('message', 'Hono is hot!!')
   *   await next()
   * })
   * ```
   */
  set = (key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  };
  /**
   * `.get()` can use the value specified by the key.
   *
   * @see {@link https://hono.dev/docs/api/context#set-get}
   *
   * @example
   * ```ts
   * app.get('/', (c) => {
   *   const message = c.get('message')
   *   return c.text(`The message is "${message}"`)
   * })
   * ```
   */
  get = (key) => {
    return this.#var ? this.#var.get(key) : void 0;
  };
  /**
   * `.var` can access the value of a variable.
   *
   * @see {@link https://hono.dev/docs/api/context#var}
   *
   * @example
   * ```ts
   * const result = c.var.client.oneMethod()
   * ```
   */
  // c.var.propName is a read-only
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
  newResponse = (...args) => this.#newResponse(...args);
  /**
   * `.body()` can return the HTTP response.
   * You can set headers with `.header()` and set HTTP status code with `.status`.
   * This can also be set in `.text()`, `.json()` and so on.
   *
   * @see {@link https://hono.dev/docs/api/context#body}
   *
   * @example
   * ```ts
   * app.get('/welcome', (c) => {
   *   // Set headers
   *   c.header('X-Message', 'Hello!')
   *   c.header('Content-Type', 'text/plain')
   *   // Set HTTP status code
   *   c.status(201)
   *
   *   // Return the response body
   *   return c.body('Thank you for coming')
   * })
   * ```
   */
  body = (data, arg, headers) => this.#newResponse(data, arg, headers);
  /**
   * `.text()` can render text as `Content-Type:text/plain`.
   *
   * @see {@link https://hono.dev/docs/api/context#text}
   *
   * @example
   * ```ts
   * app.get('/say', (c) => {
   *   return c.text('Hello!')
   * })
   * ```
   */
  text = (text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  };
  /**
   * `.json()` can render JSON as `Content-Type:application/json`.
   *
   * @see {@link https://hono.dev/docs/api/context#json}
   *
   * @example
   * ```ts
   * app.get('/api', (c) => {
   *   return c.json({ message: 'Hello!' })
   * })
   * ```
   */
  json = (object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  };
  html = (html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  };
  /**
   * `.redirect()` can Redirect, default status code is 302.
   *
   * @see {@link https://hono.dev/docs/api/context#redirect}
   *
   * @example
   * ```ts
   * app.get('/redirect', (c) => {
   *   return c.redirect('/')
   * })
   * app.get('/redirect-permanently', (c) => {
   *   return c.redirect('/', 301)
   * })
   * ```
   */
  redirect = (location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      // Multibyes should be encoded
      // eslint-disable-next-line no-control-regex
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  };
  /**
   * `.notFound()` can return the Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/context#notfound}
   *
   * @example
   * ```ts
   * app.get('/notfound', (c) => {
   *   return c.notFound()
   * })
   * ```
   */
  notFound = () => {
    this.#notFoundHandler ??= () => new Response();
    return this.#notFoundHandler(this);
  };
}, "Context");

// node_modules/hono/dist/router.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = /* @__PURE__ */ __name(class extends Error {
}, "UnsupportedPathError");

// node_modules/hono/dist/utils/constants.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
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
var Hono = /* @__PURE__ */ __name(class _Hono {
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  /*
    This class is like an abstract class and does not have a router.
    To use it, inherit the class and implement router in the constructor.
  */
  router;
  getPath;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
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
    const clone = new _Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  // Cannot use `#` because it requires visibility at JavaScript runtime.
  errorHandler = errorHandler;
  /**
   * `.route()` allows grouping other Hono instance in routes.
   *
   * @see {@link https://hono.dev/docs/api/routing#grouping}
   *
   * @param {string} path - base Path
   * @param {Hono} app - other Hono instance
   * @returns {Hono} routed Hono instance
   *
   * @example
   * ```ts
   * const app = new Hono()
   * const app2 = new Hono()
   *
   * app2.get("/user", (c) => c.text("user"))
   * app.route("/api", app2) // GET /api/user
   * ```
   */
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  /**
   * `.basePath()` allows base paths to be specified.
   *
   * @see {@link https://hono.dev/docs/api/routing#base-path}
   *
   * @param {string} path - base Path
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * const api = new Hono().basePath('/api')
   * ```
   */
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  /**
   * `.onError()` handles an error and returns a customized Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#error-handling}
   *
   * @param {ErrorHandler} handler - request Handler for error
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.onError((err, c) => {
   *   console.error(`${err}`)
   *   return c.text('Custom Error Message', 500)
   * })
   * ```
   */
  onError = (handler) => {
    this.errorHandler = handler;
    return this;
  };
  /**
   * `.notFound()` allows you to customize a Not Found Response.
   *
   * @see {@link https://hono.dev/docs/api/hono#not-found}
   *
   * @param {NotFoundHandler} handler - request handler for not-found
   * @returns {Hono} changed Hono instance
   *
   * @example
   * ```ts
   * app.notFound((c) => {
   *   return c.text('Custom 404 Message', 404)
   * })
   * ```
   */
  notFound = (handler) => {
    this.#notFoundHandler = handler;
    return this;
  };
  /**
   * `.mount()` allows you to mount applications built with other frameworks into your Hono application.
   *
   * @see {@link https://hono.dev/docs/api/hono#mount}
   *
   * @param {string} path - base Path
   * @param {Function} applicationHandler - other Request Handler
   * @param {MountOptions} [options] - options of `.mount()`
   * @returns {Hono} mounted Hono instance
   *
   * @example
   * ```ts
   * import { Router as IttyRouter } from 'itty-router'
   * import { Hono } from 'hono'
   * // Create itty-router application
   * const ittyRouter = IttyRouter()
   * // GET /itty-router/hello
   * ittyRouter.get('/hello', () => new Response('Hello from itty-router'))
   *
   * const app = new Hono()
   * app.mount('/itty-router', ittyRouter.handle)
   * ```
   *
   * @example
   * ```ts
   * const app = new Hono()
   * // Send the request to another application without modification.
   * app.mount('/app', anotherApp, {
   *   replaceRequest: (req) => req,
   * })
   * ```
   */
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
  /**
   * `.fetch()` will be entry point of your app.
   *
   * @see {@link https://hono.dev/docs/api/hono#fetch}
   *
   * @param {Request} request - request Object of request
   * @param {Env} Env - env Object
   * @param {ExecutionContext} - context of execution
   * @returns {Response | Promise<Response>} response of request
   *
   */
  fetch = (request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  };
  /**
   * `.request()` is a useful method for testing.
   * You can pass a URL or pathname to send a GET request.
   * app will return a Response object.
   * ```ts
   * test('GET /hello is ok', async () => {
   *   const res = await app.request('/hello')
   *   expect(res.status).toBe(200)
   * })
   * ```
   * @see https://hono.dev/docs/api/hono#request
   */
  request = (input, requestInit, Env, executionCtx) => {
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
  };
  /**
   * `.fire()` automatically adds a global fetch event listener.
   * This can be useful for environments that adhere to the Service Worker API, such as non-ES module Cloudflare Workers.
   * @deprecated
   * Use `fire` from `hono/service-worker` instead.
   * ```ts
   * import { Hono } from 'hono'
   * import { fire } from 'hono/service-worker'
   *
   * const app = new Hono()
   * // ...
   * fire(app)
   * ```
   * @see https://hono.dev/docs/api/hono#fire
   * @see https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
   * @see https://developers.cloudflare.com/workers/reference/migrate-to-module-workers/
   */
  fire = () => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  };
}, "_Hono");

// node_modules/hono/dist/router/reg-exp-router/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/reg-exp-router/router.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/reg-exp-router/matcher.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var emptyParam = [];
function match(method, path) {
  const matchers = this.buildAllMatchers();
  const match2 = /* @__PURE__ */ __name((method2, path2) => {
    const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
    const staticMatch = matcher[2][path2];
    if (staticMatch) {
      return staticMatch;
    }
    const match3 = path2.match(matcher[0]);
    if (!match3) {
      return [[], emptyParam];
    }
    const index = match3.indexOf("", 1);
    return [matcher[1][index], match3];
  }, "match2");
  this.match = match2;
  return match2(method, path);
}
__name(match, "match");

// node_modules/hono/dist/router/reg-exp-router/node.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = /* @__PURE__ */ Symbol();
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
var Node = /* @__PURE__ */ __name(class _Node {
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
      const name2 = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name2 && pattern[2]) {
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
        node = this.#children[regexpStr] = new _Node();
        if (name2 !== "") {
          node.#varIndex = context2.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name2 !== "") {
        paramMap.push([name2, node.#varIndex]);
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
        node = this.#children[token] = new _Node();
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
}, "_Node");

// node_modules/hono/dist/router/reg-exp-router/trie.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var Trie = /* @__PURE__ */ __name(class {
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
}, "Trie");

// node_modules/hono/dist/router/reg-exp-router/router.js
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
var RegExpRouter = /* @__PURE__ */ __name(class {
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
  match = match;
  buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    clearWildcardRegExpCache();
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
}, "RegExpRouter");

// node_modules/hono/dist/router/reg-exp-router/prepared-router.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/smart-router/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/smart-router/router.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var SmartRouter = /* @__PURE__ */ __name(class {
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init3) {
    this.#routers = init3.routers;
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
}, "SmartRouter");

// node_modules/hono/dist/router/trie-router/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/trie-router/router.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/router/trie-router/node.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var emptyParams = /* @__PURE__ */ Object.create(null);
var Node2 = /* @__PURE__ */ __name(class _Node2 {
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
      curNode.#children[key] = new _Node2();
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
          const [key, name2, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          const restPathString = parts.slice(i).join("/");
          if (matcher instanceof RegExp) {
            const m = matcher.exec(restPathString);
            if (m) {
              params[name2] = m[0];
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
            params[name2] = part;
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
}, "_Node");

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = /* @__PURE__ */ __name(class {
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
}, "TrieRouter");

// node_modules/hono/dist/hono.js
var Hono2 = /* @__PURE__ */ __name(class extends Hono {
  /**
   * Creates an instance of the Hono class.
   *
   * @param options - Optional configuration options for the Hono instance.
   */
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
}, "Hono");

// node_modules/hono/dist/helper/cookie/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/hono/dist/utils/cookie.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var validCookieNameRegEx = /^[\w!#$%&'*.^`|~+-]+$/;
var validCookieValueRegEx = /^[ !#-:<-[\]-~]*$/;
var parse = /* @__PURE__ */ __name((cookie, name2) => {
  if (name2 && cookie.indexOf(name2) === -1) {
    return {};
  }
  const pairs = cookie.trim().split(";");
  const parsedCookie = {};
  for (let pairStr of pairs) {
    pairStr = pairStr.trim();
    const valueStartPos = pairStr.indexOf("=");
    if (valueStartPos === -1) {
      continue;
    }
    const cookieName = pairStr.substring(0, valueStartPos).trim();
    if (name2 && name2 !== cookieName || !validCookieNameRegEx.test(cookieName)) {
      continue;
    }
    let cookieValue = pairStr.substring(valueStartPos + 1).trim();
    if (cookieValue.startsWith('"') && cookieValue.endsWith('"')) {
      cookieValue = cookieValue.slice(1, -1);
    }
    if (validCookieValueRegEx.test(cookieValue)) {
      parsedCookie[cookieName] = cookieValue.indexOf("%") !== -1 ? tryDecode(cookieValue, decodeURIComponent_) : cookieValue;
      if (name2) {
        break;
      }
    }
  }
  return parsedCookie;
}, "parse");
var _serialize = /* @__PURE__ */ __name((name2, value, opt = {}) => {
  let cookie = `${name2}=${value}`;
  if (name2.startsWith("__Secure-") && !opt.secure) {
    throw new Error("__Secure- Cookie must have Secure attributes");
  }
  if (name2.startsWith("__Host-")) {
    if (!opt.secure) {
      throw new Error("__Host- Cookie must have Secure attributes");
    }
    if (opt.path !== "/") {
      throw new Error('__Host- Cookie must have Path attributes with "/"');
    }
    if (opt.domain) {
      throw new Error("__Host- Cookie must not have Domain attributes");
    }
  }
  if (opt && typeof opt.maxAge === "number" && opt.maxAge >= 0) {
    if (opt.maxAge > 3456e4) {
      throw new Error(
        "Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration."
      );
    }
    cookie += `; Max-Age=${opt.maxAge | 0}`;
  }
  if (opt.domain && opt.prefix !== "host") {
    cookie += `; Domain=${opt.domain}`;
  }
  if (opt.path) {
    cookie += `; Path=${opt.path}`;
  }
  if (opt.expires) {
    if (opt.expires.getTime() - Date.now() > 3456e7) {
      throw new Error(
        "Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future."
      );
    }
    cookie += `; Expires=${opt.expires.toUTCString()}`;
  }
  if (opt.httpOnly) {
    cookie += "; HttpOnly";
  }
  if (opt.secure) {
    cookie += "; Secure";
  }
  if (opt.sameSite) {
    cookie += `; SameSite=${opt.sameSite.charAt(0).toUpperCase() + opt.sameSite.slice(1)}`;
  }
  if (opt.priority) {
    cookie += `; Priority=${opt.priority.charAt(0).toUpperCase() + opt.priority.slice(1)}`;
  }
  if (opt.partitioned) {
    if (!opt.secure) {
      throw new Error("Partitioned Cookie must have Secure attributes");
    }
    cookie += "; Partitioned";
  }
  return cookie;
}, "_serialize");
var serialize = /* @__PURE__ */ __name((name2, value, opt) => {
  value = encodeURIComponent(value);
  return _serialize(name2, value, opt);
}, "serialize");

// node_modules/hono/dist/helper/cookie/index.js
var getCookie = /* @__PURE__ */ __name((c, key, prefix) => {
  const cookie = c.req.raw.headers.get("Cookie");
  if (typeof key === "string") {
    if (!cookie) {
      return void 0;
    }
    let finalKey = key;
    if (prefix === "secure") {
      finalKey = "__Secure-" + key;
    } else if (prefix === "host") {
      finalKey = "__Host-" + key;
    }
    const obj2 = parse(cookie, finalKey);
    return obj2[finalKey];
  }
  if (!cookie) {
    return {};
  }
  const obj = parse(cookie);
  return obj;
}, "getCookie");
var generateCookie = /* @__PURE__ */ __name((name2, value, opt) => {
  let cookie;
  if (opt?.prefix === "secure") {
    cookie = serialize("__Secure-" + name2, value, { path: "/", ...opt, secure: true });
  } else if (opt?.prefix === "host") {
    cookie = serialize("__Host-" + name2, value, {
      ...opt,
      path: "/",
      secure: true,
      domain: void 0
    });
  } else {
    cookie = serialize(name2, value, { path: "/", ...opt });
  }
  return cookie;
}, "generateCookie");
var setCookie = /* @__PURE__ */ __name((c, name2, value, opt) => {
  const cookie = generateCookie(name2, value, opt);
  c.header("Set-Cookie", cookie, { append: true });
}, "setCookie");
var deleteCookie = /* @__PURE__ */ __name((c, name2, opt) => {
  const deletedCookie = getCookie(c, name2, opt?.prefix);
  setCookie(c, name2, "", { ...opt, maxAge: 0 });
  return deletedCookie;
}, "deleteCookie");

// src/backend/lib/db.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var import_prisma = __toESM(require_default(), 1);

// node_modules/@prisma/adapter-d1/dist/index-workerd.mjs
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
init_dist2();

// node_modules/ky/distribution/index.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/ky/distribution/core/Ky.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/ky/distribution/errors/HTTPError.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var HTTPError = class extends Error {
  response;
  request;
  options;
  constructor(response, request, options) {
    const code = response.status || response.status === 0 ? response.status : "";
    const title2 = response.statusText || "";
    const status = `${code} ${title2}`.trim();
    const reason = status ? `status code ${status}` : "an unknown error";
    super(`Request failed with ${reason}: ${request.method} ${request.url}`);
    this.name = "HTTPError";
    this.response = response;
    this.request = request;
    this.options = options;
  }
};
__name(HTTPError, "HTTPError");

// node_modules/ky/distribution/errors/TimeoutError.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var TimeoutError = class extends Error {
  request;
  constructor(request) {
    super(`Request timed out: ${request.method} ${request.url}`);
    this.name = "TimeoutError";
    this.request = request;
  }
};
__name(TimeoutError, "TimeoutError");

// node_modules/ky/distribution/utils/merge.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/ky/distribution/utils/is.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var isObject = /* @__PURE__ */ __name((value) => value !== null && typeof value === "object", "isObject");

// node_modules/ky/distribution/utils/merge.js
var validateAndMerge = /* @__PURE__ */ __name((...sources) => {
  for (const source of sources) {
    if ((!isObject(source) || Array.isArray(source)) && source !== void 0) {
      throw new TypeError("The `options` argument must be an object");
    }
  }
  return deepMerge({}, ...sources);
}, "validateAndMerge");
var mergeHeaders = /* @__PURE__ */ __name((source1 = {}, source2 = {}) => {
  const result = new globalThis.Headers(source1);
  const isHeadersInstance = source2 instanceof globalThis.Headers;
  const source = new globalThis.Headers(source2);
  for (const [key, value] of source.entries()) {
    if (isHeadersInstance && value === "undefined" || value === void 0) {
      result.delete(key);
    } else {
      result.set(key, value);
    }
  }
  return result;
}, "mergeHeaders");
function newHookValue(original, incoming, property) {
  return Object.hasOwn(incoming, property) && incoming[property] === void 0 ? [] : deepMerge(original[property] ?? [], incoming[property] ?? []);
}
__name(newHookValue, "newHookValue");
var mergeHooks = /* @__PURE__ */ __name((original = {}, incoming = {}) => ({
  beforeRequest: newHookValue(original, incoming, "beforeRequest"),
  beforeRetry: newHookValue(original, incoming, "beforeRetry"),
  afterResponse: newHookValue(original, incoming, "afterResponse"),
  beforeError: newHookValue(original, incoming, "beforeError")
}), "mergeHooks");
var deepMerge = /* @__PURE__ */ __name((...sources) => {
  let returnValue = {};
  let headers = {};
  let hooks = {};
  for (const source of sources) {
    if (Array.isArray(source)) {
      if (!Array.isArray(returnValue)) {
        returnValue = [];
      }
      returnValue = [...returnValue, ...source];
    } else if (isObject(source)) {
      for (let [key, value] of Object.entries(source)) {
        if (isObject(value) && key in returnValue) {
          value = deepMerge(returnValue[key], value);
        }
        returnValue = { ...returnValue, [key]: value };
      }
      if (isObject(source.hooks)) {
        hooks = mergeHooks(hooks, source.hooks);
        returnValue.hooks = hooks;
      }
      if (isObject(source.headers)) {
        headers = mergeHeaders(headers, source.headers);
        returnValue.headers = headers;
      }
    }
  }
  return returnValue;
}, "deepMerge");

// node_modules/ky/distribution/utils/normalize.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// node_modules/ky/distribution/core/constants.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var supportsRequestStreams = (() => {
  let duplexAccessed = false;
  let hasContentType = false;
  const supportsReadableStream = typeof globalThis.ReadableStream === "function";
  const supportsRequest = typeof globalThis.Request === "function";
  if (supportsReadableStream && supportsRequest) {
    try {
      hasContentType = new globalThis.Request("https://empty.invalid", {
        body: new globalThis.ReadableStream(),
        method: "POST",
        // @ts-expect-error - Types are outdated.
        get duplex() {
          duplexAccessed = true;
          return "half";
        }
      }).headers.has("Content-Type");
    } catch (error3) {
      if (error3 instanceof Error && error3.message === "unsupported BodyInit type") {
        return false;
      }
      throw error3;
    }
  }
  return duplexAccessed && !hasContentType;
})();
var supportsAbortController = typeof globalThis.AbortController === "function";
var supportsResponseStreams = typeof globalThis.ReadableStream === "function";
var supportsFormData = typeof globalThis.FormData === "function";
var requestMethods = ["get", "post", "put", "patch", "head", "delete"];
var validate = /* @__PURE__ */ __name(() => void 0, "validate");
validate();
var responseTypes = {
  json: "application/json",
  text: "text/*",
  formData: "multipart/form-data",
  arrayBuffer: "*/*",
  blob: "*/*"
};
var maxSafeTimeout = 2147483647;
var stop = Symbol("stop");
var kyOptionKeys = {
  json: true,
  parseJson: true,
  stringifyJson: true,
  searchParams: true,
  prefixUrl: true,
  retry: true,
  timeout: true,
  hooks: true,
  throwHttpErrors: true,
  onDownloadProgress: true,
  fetch: true
};
var requestOptionsRegistry = {
  method: true,
  headers: true,
  body: true,
  mode: true,
  credentials: true,
  cache: true,
  redirect: true,
  referrer: true,
  referrerPolicy: true,
  integrity: true,
  keepalive: true,
  signal: true,
  window: true,
  dispatcher: true,
  duplex: true,
  priority: true
};

// node_modules/ky/distribution/utils/normalize.js
var normalizeRequestMethod = /* @__PURE__ */ __name((input) => requestMethods.includes(input) ? input.toUpperCase() : input, "normalizeRequestMethod");
var retryMethods = ["get", "put", "head", "delete", "options", "trace"];
var retryStatusCodes = [408, 413, 429, 500, 502, 503, 504];
var retryAfterStatusCodes = [413, 429, 503];
var defaultRetryOptions = {
  limit: 2,
  methods: retryMethods,
  statusCodes: retryStatusCodes,
  afterStatusCodes: retryAfterStatusCodes,
  maxRetryAfter: Number.POSITIVE_INFINITY,
  backoffLimit: Number.POSITIVE_INFINITY,
  delay: (attemptCount) => 0.3 * 2 ** (attemptCount - 1) * 1e3
};
var normalizeRetryOptions = /* @__PURE__ */ __name((retry = {}) => {
  if (typeof retry === "number") {
    return {
      ...defaultRetryOptions,
      limit: retry
    };
  }
  if (retry.methods && !Array.isArray(retry.methods)) {
    throw new Error("retry.methods must be an array");
  }
  if (retry.statusCodes && !Array.isArray(retry.statusCodes)) {
    throw new Error("retry.statusCodes must be an array");
  }
  return {
    ...defaultRetryOptions,
    ...retry
  };
}, "normalizeRetryOptions");

// node_modules/ky/distribution/utils/timeout.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
async function timeout(request, init3, abortController, options) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (abortController) {
        abortController.abort();
      }
      reject(new TimeoutError(request));
    }, options.timeout);
    void options.fetch(request, init3).then(resolve).catch(reject).then(() => {
      clearTimeout(timeoutId);
    });
  });
}
__name(timeout, "timeout");

// node_modules/ky/distribution/utils/delay.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
async function delay(ms, { signal }) {
  return new Promise((resolve, reject) => {
    if (signal) {
      signal.throwIfAborted();
      signal.addEventListener("abort", abortHandler, { once: true });
    }
    function abortHandler() {
      clearTimeout(timeoutId);
      reject(signal.reason);
    }
    __name(abortHandler, "abortHandler");
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abortHandler);
      resolve();
    }, ms);
  });
}
__name(delay, "delay");

// node_modules/ky/distribution/utils/options.js
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var findUnknownOptions = /* @__PURE__ */ __name((request, options) => {
  const unknownOptions = {};
  for (const key in options) {
    if (!(key in requestOptionsRegistry) && !(key in kyOptionKeys) && !(key in request)) {
      unknownOptions[key] = options[key];
    }
  }
  return unknownOptions;
}, "findUnknownOptions");

// node_modules/ky/distribution/core/Ky.js
var Ky = class {
  static create(input, options) {
    const ky2 = new Ky(input, options);
    const function_ = /* @__PURE__ */ __name(async () => {
      if (typeof ky2._options.timeout === "number" && ky2._options.timeout > maxSafeTimeout) {
        throw new RangeError(`The \`timeout\` option cannot be greater than ${maxSafeTimeout}`);
      }
      await Promise.resolve();
      let response = await ky2._fetch();
      for (const hook of ky2._options.hooks.afterResponse) {
        const modifiedResponse = await hook(ky2.request, ky2._options, ky2._decorateResponse(response.clone()));
        if (modifiedResponse instanceof globalThis.Response) {
          response = modifiedResponse;
        }
      }
      ky2._decorateResponse(response);
      if (!response.ok && ky2._options.throwHttpErrors) {
        let error3 = new HTTPError(response, ky2.request, ky2._options);
        for (const hook of ky2._options.hooks.beforeError) {
          error3 = await hook(error3);
        }
        throw error3;
      }
      if (ky2._options.onDownloadProgress) {
        if (typeof ky2._options.onDownloadProgress !== "function") {
          throw new TypeError("The `onDownloadProgress` option must be a function");
        }
        if (!supportsResponseStreams) {
          throw new Error("Streams are not supported in your environment. `ReadableStream` is missing.");
        }
        return ky2._stream(response.clone(), ky2._options.onDownloadProgress);
      }
      return response;
    }, "function_");
    const isRetriableMethod = ky2._options.retry.methods.includes(ky2.request.method.toLowerCase());
    const result = isRetriableMethod ? ky2._retry(function_) : function_();
    for (const [type, mimeType] of Object.entries(responseTypes)) {
      result[type] = async () => {
        ky2.request.headers.set("accept", ky2.request.headers.get("accept") || mimeType);
        const response = await result;
        if (type === "json") {
          if (response.status === 204) {
            return "";
          }
          const arrayBuffer = await response.clone().arrayBuffer();
          const responseSize = arrayBuffer.byteLength;
          if (responseSize === 0) {
            return "";
          }
          if (options.parseJson) {
            return options.parseJson(await response.text());
          }
        }
        return response[type]();
      };
    }
    return result;
  }
  request;
  abortController;
  _retryCount = 0;
  _input;
  _options;
  // eslint-disable-next-line complexity
  constructor(input, options = {}) {
    this._input = input;
    this._options = {
      ...options,
      headers: mergeHeaders(this._input.headers, options.headers),
      hooks: mergeHooks({
        beforeRequest: [],
        beforeRetry: [],
        beforeError: [],
        afterResponse: []
      }, options.hooks),
      method: normalizeRequestMethod(options.method ?? this._input.method ?? "GET"),
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      prefixUrl: String(options.prefixUrl || ""),
      retry: normalizeRetryOptions(options.retry),
      throwHttpErrors: options.throwHttpErrors !== false,
      timeout: options.timeout ?? 1e4,
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis)
    };
    if (typeof this._input !== "string" && !(this._input instanceof URL || this._input instanceof globalThis.Request)) {
      throw new TypeError("`input` must be a string, URL, or Request");
    }
    if (this._options.prefixUrl && typeof this._input === "string") {
      if (this._input.startsWith("/")) {
        throw new Error("`input` must not begin with a slash when using `prefixUrl`");
      }
      if (!this._options.prefixUrl.endsWith("/")) {
        this._options.prefixUrl += "/";
      }
      this._input = this._options.prefixUrl + this._input;
    }
    if (supportsAbortController) {
      this.abortController = new globalThis.AbortController();
      const originalSignal = this._options.signal ?? this._input.signal;
      if (originalSignal?.aborted) {
        this.abortController.abort(originalSignal?.reason);
      }
      originalSignal?.addEventListener("abort", () => {
        this.abortController.abort(originalSignal.reason);
      });
      this._options.signal = this.abortController.signal;
    }
    if (supportsRequestStreams) {
      this._options.duplex = "half";
    }
    if (this._options.json !== void 0) {
      this._options.body = this._options.stringifyJson?.(this._options.json) ?? JSON.stringify(this._options.json);
      this._options.headers.set("content-type", this._options.headers.get("content-type") ?? "application/json");
    }
    this.request = new globalThis.Request(this._input, this._options);
    if (this._options.searchParams) {
      const textSearchParams = typeof this._options.searchParams === "string" ? this._options.searchParams.replace(/^\?/, "") : new URLSearchParams(this._options.searchParams).toString();
      const searchParams = "?" + textSearchParams;
      const url = this.request.url.replace(/(?:\?.*?)?(?=#|$)/, searchParams);
      if ((supportsFormData && this._options.body instanceof globalThis.FormData || this._options.body instanceof URLSearchParams) && !(this._options.headers && this._options.headers["content-type"])) {
        this.request.headers.delete("content-type");
      }
      this.request = new globalThis.Request(new globalThis.Request(url, { ...this.request }), this._options);
    }
  }
  _calculateRetryDelay(error3) {
    this._retryCount++;
    if (this._retryCount > this._options.retry.limit || error3 instanceof TimeoutError) {
      throw error3;
    }
    if (error3 instanceof HTTPError) {
      if (!this._options.retry.statusCodes.includes(error3.response.status)) {
        throw error3;
      }
      const retryAfter = error3.response.headers.get("Retry-After") ?? error3.response.headers.get("RateLimit-Reset") ?? error3.response.headers.get("X-RateLimit-Reset") ?? error3.response.headers.get("X-Rate-Limit-Reset");
      if (retryAfter && this._options.retry.afterStatusCodes.includes(error3.response.status)) {
        let after = Number(retryAfter) * 1e3;
        if (Number.isNaN(after)) {
          after = Date.parse(retryAfter) - Date.now();
        } else if (after >= Date.parse("2024-01-01")) {
          after -= Date.now();
        }
        const max = this._options.retry.maxRetryAfter ?? after;
        return after < max ? after : max;
      }
      if (error3.response.status === 413) {
        throw error3;
      }
    }
    const retryDelay = this._options.retry.delay(this._retryCount);
    return Math.min(this._options.retry.backoffLimit, retryDelay);
  }
  _decorateResponse(response) {
    if (this._options.parseJson) {
      response.json = async () => this._options.parseJson(await response.text());
    }
    return response;
  }
  async _retry(function_) {
    try {
      return await function_();
    } catch (error3) {
      const ms = Math.min(this._calculateRetryDelay(error3), maxSafeTimeout);
      if (this._retryCount < 1) {
        throw error3;
      }
      await delay(ms, { signal: this._options.signal });
      for (const hook of this._options.hooks.beforeRetry) {
        const hookResult = await hook({
          request: this.request,
          options: this._options,
          error: error3,
          retryCount: this._retryCount
        });
        if (hookResult === stop) {
          return;
        }
      }
      return this._retry(function_);
    }
  }
  async _fetch() {
    for (const hook of this._options.hooks.beforeRequest) {
      const result = await hook(this.request, this._options);
      if (result instanceof Request) {
        this.request = result;
        break;
      }
      if (result instanceof Response) {
        return result;
      }
    }
    const nonRequestOptions = findUnknownOptions(this.request, this._options);
    const mainRequest = this.request;
    this.request = mainRequest.clone();
    if (this._options.timeout === false) {
      return this._options.fetch(mainRequest, nonRequestOptions);
    }
    return timeout(mainRequest, nonRequestOptions, this.abortController, this._options);
  }
  /* istanbul ignore next */
  _stream(response, onDownloadProgress) {
    const totalBytes = Number(response.headers.get("content-length")) || 0;
    let transferredBytes = 0;
    if (response.status === 204) {
      if (onDownloadProgress) {
        onDownloadProgress({ percent: 1, totalBytes, transferredBytes }, new Uint8Array());
      }
      return new globalThis.Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    }
    return new globalThis.Response(new globalThis.ReadableStream({
      async start(controller) {
        const reader = response.body.getReader();
        if (onDownloadProgress) {
          onDownloadProgress({ percent: 0, transferredBytes: 0, totalBytes }, new Uint8Array());
        }
        async function read() {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          if (onDownloadProgress) {
            transferredBytes += value.byteLength;
            const percent = totalBytes === 0 ? 0 : transferredBytes / totalBytes;
            onDownloadProgress({ percent, transferredBytes, totalBytes }, value);
          }
          controller.enqueue(value);
          await read();
        }
        __name(read, "read");
        await read();
      }
    }), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  }
};
__name(Ky, "Ky");

// node_modules/ky/distribution/index.js
var createInstance = /* @__PURE__ */ __name((defaults) => {
  const ky2 = /* @__PURE__ */ __name((input, options) => Ky.create(input, validateAndMerge(defaults, options)), "ky");
  for (const method of requestMethods) {
    ky2[method] = (input, options) => Ky.create(input, validateAndMerge(defaults, options, { method }));
  }
  ky2.create = (newDefaults) => createInstance(validateAndMerge(newDefaults));
  ky2.extend = (newDefaults) => {
    if (typeof newDefaults === "function") {
      newDefaults = newDefaults(defaults ?? {});
    }
    return createInstance(validateAndMerge(defaults, newDefaults));
  };
  ky2.stop = stop;
  return ky2;
}, "createInstance");
var ky = createInstance();
var distribution_default = ky;

// node_modules/@prisma/adapter-d1/dist/index-workerd.mjs
init_dist2();
init_dist2();
var name = "@prisma/adapter-d1";
var FORCE_COLOR2;
var NODE_DISABLE_COLORS2;
var NO_COLOR2;
var TERM2;
var isTTY2 = true;
if (typeof process !== "undefined") {
  ({ FORCE_COLOR: FORCE_COLOR2, NODE_DISABLE_COLORS: NODE_DISABLE_COLORS2, NO_COLOR: NO_COLOR2, TERM: TERM2 } = process.env || {});
  isTTY2 = process.stdout && process.stdout.isTTY;
}
var $2 = {
  enabled: !NODE_DISABLE_COLORS2 && NO_COLOR2 == null && TERM2 !== "dumb" && (FORCE_COLOR2 != null && FORCE_COLOR2 !== "0" || isTTY2)
};
function init2(x, y) {
  let rgx = new RegExp(`\\x1b\\[${y}m`, "g");
  let open = `\x1B[${x}m`, close = `\x1B[${y}m`;
  return function(txt) {
    if (!$2.enabled || txt == null)
      return txt;
    return open + (!!~("" + txt).indexOf(close) ? txt.replace(rgx, close + open) : txt) + close;
  };
}
__name(init2, "init");
var reset2 = init2(0, 0);
var bold2 = init2(1, 22);
var dim2 = init2(2, 22);
var italic2 = init2(3, 23);
var underline2 = init2(4, 24);
var inverse2 = init2(7, 27);
var hidden2 = init2(8, 28);
var strikethrough2 = init2(9, 29);
var black2 = init2(30, 39);
var red2 = init2(31, 39);
var green2 = init2(32, 39);
var yellow2 = init2(33, 39);
var blue2 = init2(34, 39);
var magenta2 = init2(35, 39);
var cyan2 = init2(36, 39);
var white2 = init2(37, 39);
var gray2 = init2(90, 39);
var grey2 = init2(90, 39);
var bgBlack2 = init2(40, 49);
var bgRed2 = init2(41, 49);
var bgGreen2 = init2(42, 49);
var bgYellow2 = init2(43, 49);
var bgBlue2 = init2(44, 49);
var bgMagenta2 = init2(45, 49);
var bgCyan2 = init2(46, 49);
var bgWhite2 = init2(47, 49);
var MAX_BIND_VALUES = 98;
var GENERIC_SQLITE_ERROR = 1;
function getColumnTypes(columnNames, rows) {
  const columnTypes = [];
  columnLoop:
    for (let columnIndex = 0; columnIndex < columnNames.length; columnIndex++) {
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const candidateValue = rows[rowIndex][columnIndex];
        if (candidateValue !== null) {
          const inferred = inferColumnType(candidateValue);
          if (columnTypes[columnIndex] === void 0 || inferred === ColumnTypeEnum.Text) {
            columnTypes[columnIndex] = inferred;
          }
          if (inferred !== ColumnTypeEnum.UnknownNumber) {
            continue columnLoop;
          }
        }
      }
      if (columnTypes[columnIndex] === void 0) {
        columnTypes[columnIndex] = ColumnTypeEnum.Int32;
      }
    }
  return columnTypes;
}
__name(getColumnTypes, "getColumnTypes");
function inferColumnType(value) {
  switch (typeof value) {
    case "string":
      return inferStringType(value);
    case "number":
      return inferNumberType(value);
    case "object":
      return inferObjectType(value);
    default:
      throw new UnexpectedTypeError(value);
  }
}
__name(inferColumnType, "inferColumnType");
var isoDateRegex = new RegExp(
  /^(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))$|^(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))$|^(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))$/
);
var sqliteDateRegex = /^\d{4}-[0-1]\d-[0-3]\d [0-2]\d:[0-5]\d:[0-5]\d$/;
function isISODate(str) {
  return isoDateRegex.test(str) || sqliteDateRegex.test(str);
}
__name(isISODate, "isISODate");
function inferStringType(value) {
  if (isISODate(value)) {
    return ColumnTypeEnum.DateTime;
  }
  return ColumnTypeEnum.Text;
}
__name(inferStringType, "inferStringType");
function inferNumberType(_) {
  return ColumnTypeEnum.UnknownNumber;
}
__name(inferNumberType, "inferNumberType");
function inferObjectType(value) {
  if (value instanceof Array) {
    return ColumnTypeEnum.Bytes;
  }
  throw new UnexpectedTypeError(value);
}
__name(inferObjectType, "inferObjectType");
var UnexpectedTypeError = /* @__PURE__ */ __name(class extends Error {
  name = "UnexpectedTypeError";
  constructor(value) {
    const type = typeof value;
    const repr = type === "object" ? JSON.stringify(value) : String(value);
    super(`unexpected value of type ${type}: ${repr}`);
  }
}, "UnexpectedTypeError");
function mapRow(result, columnTypes) {
  for (let i = 0; i < result.length; i++) {
    const value = result[i];
    if (value instanceof ArrayBuffer) {
      result[i] = new Uint8Array(value);
      continue;
    }
    if (typeof value === "number" && (columnTypes[i] === ColumnTypeEnum.Int32 || columnTypes[i] === ColumnTypeEnum.Int64) && !Number.isInteger(value)) {
      result[i] = Math.trunc(value);
      continue;
    }
    if (typeof value === "number" && columnTypes[i] === ColumnTypeEnum.Text) {
      result[i] = value.toString();
      continue;
    }
    if (typeof value === "bigint") {
      result[i] = value.toString();
      continue;
    }
    if (columnTypes[i] === ColumnTypeEnum.Boolean) {
      result[i] = JSON.parse(value);
    }
  }
  return result;
}
__name(mapRow, "mapRow");
function mapArg(arg, argType) {
  if (arg === null) {
    return null;
  }
  if (typeof arg === "bigint" || argType.scalarType === "bigint") {
    const asInt56 = Number.parseInt(`${arg}`);
    if (!Number.isSafeInteger(asInt56)) {
      throw new Error(`Invalid Int64-encoded value received: ${arg}`);
    }
    return asInt56;
  }
  if (typeof arg === "string" && argType.scalarType === "int") {
    return Number.parseInt(arg);
  }
  if (typeof arg === "string" && argType.scalarType === "float") {
    return Number.parseFloat(arg);
  }
  if (typeof arg === "string" && argType.scalarType === "decimal") {
    return Number.parseFloat(arg);
  }
  if (arg === true) {
    return 1;
  }
  if (arg === false) {
    return 0;
  }
  if (typeof arg === "string" && argType.scalarType === "datetime") {
    arg = new Date(arg);
  }
  if (arg instanceof Date) {
    return arg.toISOString().replace("Z", "+00:00");
  }
  if (typeof arg === "string" && argType.scalarType === "bytes") {
    return Array.from(Buffer.from(arg, "base64"));
  }
  if (arg instanceof Uint8Array) {
    return Array.from(arg);
  }
  return arg;
}
__name(mapArg, "mapArg");
function convertDriverError(error3) {
  if (isDriverError(error3)) {
    return {
      originalMessage: error3.message,
      ...mapDriverError(error3)
    };
  }
  throw error3;
}
__name(convertDriverError, "convertDriverError");
function mapDriverError(error3) {
  let stripped = error3.message.split("D1_ERROR: ").at(1) ?? error3.message;
  stripped = stripped.split("SqliteError: ").at(1) ?? stripped;
  if (stripped.startsWith("UNIQUE constraint failed") || stripped.startsWith("PRIMARY KEY constraint failed")) {
    const fields = stripped.split(": ").at(1)?.split(", ").map((field) => field.split(".").pop());
    return {
      kind: "UniqueConstraintViolation",
      constraint: fields !== void 0 ? { fields } : void 0
    };
  } else if (stripped.startsWith("NOT NULL constraint failed")) {
    const fields = stripped.split(": ").at(1)?.split(", ").map((field) => field.split(".").pop());
    return {
      kind: "NullConstraintViolation",
      constraint: fields !== void 0 ? { fields } : void 0
    };
  } else if (stripped.startsWith("FOREIGN KEY constraint failed") || stripped.startsWith("CHECK constraint failed")) {
    return {
      kind: "ForeignKeyConstraintViolation",
      constraint: { foreignKey: {} }
    };
  } else if (stripped.startsWith("no such table")) {
    return {
      kind: "TableDoesNotExist",
      table: stripped.split(": ").at(1)
    };
  } else if (stripped.startsWith("no such column")) {
    return {
      kind: "ColumnNotFound",
      column: stripped.split(": ").at(1)
    };
  } else if (stripped.includes("has no column named ")) {
    return {
      kind: "ColumnNotFound",
      column: stripped.split("has no column named ").at(1)
    };
  }
  return {
    kind: "sqlite",
    extendedCode: error3["code"] ?? error3["cause"]?.["code"] ?? 1,
    message: error3.message
  };
}
__name(mapDriverError, "mapDriverError");
function isDriverError(error3) {
  return typeof error3["message"] === "string";
}
__name(isDriverError, "isDriverError");
var debug4 = Debug2("prisma:driver-adapter:d1-http");
function onUnsuccessfulD1HttpResponse({ errors }) {
  debug4("D1 HTTP Errors: %O", errors);
  const error3 = errors.at(0) ?? { message: "Unknown error", code: GENERIC_SQLITE_ERROR };
  throw new DriverAdapterError(convertDriverError(error3));
}
__name(onUnsuccessfulD1HttpResponse, "onUnsuccessfulD1HttpResponse");
function onGenericD1HttpError(error3) {
  debug4("HTTP Error: %O", error3);
  throw new DriverAdapterError(convertDriverError(error3));
}
__name(onGenericD1HttpError, "onGenericD1HttpError");
function onError(error3) {
  console.error("Error in performIO: %O", error3);
  throw new DriverAdapterError(convertDriverError(error3));
}
__name(onError, "onError");
async function performRawQuery(client, options) {
  try {
    const response = await client.post("raw", options).json();
    const tag = "[js::performRawQuery]";
    debug4(`${tag} %O`, {
      success: response.success,
      errors: response.errors,
      messages: response.messages,
      result: response.result
    });
    if (!response.success) {
      onUnsuccessfulD1HttpResponse(response);
    }
    return response.result;
  } catch (e) {
    onGenericD1HttpError(e);
  }
}
__name(performRawQuery, "performRawQuery");
function isD1HttpParams(params) {
  return typeof params === "object" && params !== null && "CLOUDFLARE_D1_TOKEN" in params && "CLOUDFLARE_ACCOUNT_ID" in params && "CLOUDFLARE_DATABASE_ID" in params;
}
__name(isD1HttpParams, "isD1HttpParams");
var D1HttpQueryable = /* @__PURE__ */ __name(class {
  constructor(client) {
    this.client = client;
  }
  provider = "sqlite";
  adapterName = `${name}-http`;
  /**
   * Execute a query given as SQL, interpolating the given parameters.
   */
  async queryRaw(query) {
    const tag = "[js::query_raw]";
    debug4(`${tag} %O`, query);
    const data = await this.performIO(query);
    const convertedData = this.convertData(data);
    return convertedData;
  }
  convertData({ columnNames, rows: results }) {
    if (results.length === 0) {
      return {
        columnNames: [],
        columnTypes: [],
        rows: []
      };
    }
    const columnTypes = getColumnTypes(columnNames, results);
    const rows = results.map((value) => mapRow(value, columnTypes));
    return {
      columnNames,
      columnTypes,
      rows
    };
  }
  /**
   * Execute a query given as SQL, interpolating the given parameters and
   * returning the number of affected rows.
   * Note: Queryable expects a u64, but napi.rs only supports u32.
   */
  async executeRaw(query) {
    const tag = "[js::execute_raw]";
    debug4(`${tag} %O`, query);
    const result = await this.performIO(query);
    return result.affectedRows ?? 0;
  }
  async performIO(query) {
    try {
      const body = {
        json: {
          sql: query.sql,
          params: query.args.map((arg, i) => mapArg(arg, query.argTypes[i]))
        }
      };
      const tag = "[js::perform_io]";
      debug4(`${tag} %O`, body);
      const results = await performRawQuery(this.client, body);
      if (results.length !== 1) {
        throw new Error("Expected exactly one result");
      }
      const result = results[0];
      const { columns: columnNames = [], rows = [] } = result.results ?? {};
      const affectedRows = result.meta?.changes;
      return { rows, columnNames, affectedRows };
    } catch (e) {
      onError(e);
    }
  }
}, "D1HttpQueryable");
var D1HttpTransaction = /* @__PURE__ */ __name(class extends D1HttpQueryable {
  constructor(client, options) {
    super(client);
    this.options = options;
  }
  async commit() {
    debug4(`[js::commit]`);
  }
  async rollback() {
    debug4(`[js::rollback]`);
  }
}, "D1HttpTransaction");
var PrismaD1HttpAdapter = /* @__PURE__ */ __name(class extends D1HttpQueryable {
  constructor(params, release2) {
    const D1_API_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${params.CLOUDFLARE_ACCOUNT_ID}/d1/database/${params.CLOUDFLARE_DATABASE_ID}`;
    const client = distribution_default.create({
      prefixUrl: D1_API_BASE_URL,
      headers: {
        Authorization: `Bearer ${params.CLOUDFLARE_D1_TOKEN}`
      },
      // Don't automatically throw on non-2xx status codes
      throwHttpErrors: false
    });
    super(client);
    this.release = release2;
  }
  tags = {
    error: red2("prisma:error"),
    warn: yellow2("prisma:warn"),
    info: cyan2("prisma:info"),
    query: blue2("prisma:query")
  };
  alreadyWarned = /* @__PURE__ */ new Set();
  /**
   * This will warn once per transaction
   * e.g. the following two explicit transactions
   * will only trigger _two_ warnings
   *
   * ```ts
   * await prisma.$transaction([ ...queries ])
   * await prisma.$transaction([ ...moreQueries ])
   * ```
   */
  warnOnce = (key, message, ...args) => {
    if (!this.alreadyWarned.has(key)) {
      this.alreadyWarned.add(key);
      console.info(`${this.tags.warn} ${message}`, ...args);
    }
  };
  async executeScript(script) {
    try {
      await performRawQuery(this.client, {
        json: {
          sql: script
        }
      });
    } catch (error3) {
      onError(error3);
    }
  }
  getConnectionInfo() {
    return {
      maxBindValues: MAX_BIND_VALUES,
      supportsRelationJoins: false
    };
  }
  async startTransaction(isolationLevel) {
    if (isolationLevel && isolationLevel !== "SERIALIZABLE") {
      throw new DriverAdapterError({
        kind: "InvalidIsolationLevel",
        level: isolationLevel
      });
    }
    this.warnOnce(
      "D1 Transaction",
      "Cloudflare D1 does not support transactions yet. When using Prisma's D1 adapter, implicit & explicit transactions will be ignored and run as individual queries, which breaks the guarantees of the ACID properties of transactions. For more details see https://pris.ly/d/d1-transactions"
    );
    const options = {
      usePhantomQuery: true
    };
    const tag = "[js::startTransaction]";
    debug4("%s options: %O", tag, options);
    return new D1HttpTransaction(this.client, options);
  }
  async dispose() {
    await this.release?.();
  }
}, "PrismaD1HttpAdapter");
var PrismaD1HttpAdapterFactory = /* @__PURE__ */ __name(class {
  constructor(params) {
    this.params = params;
  }
  provider = "sqlite";
  adapterName = `${name}-http`;
  async connect() {
    return new PrismaD1HttpAdapter(this.params, async () => {
    });
  }
  async connectToShadowDb() {
    const D1_API_BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${this.params.CLOUDFLARE_ACCOUNT_ID}/d1/database`;
    const client = distribution_default.create({
      headers: {
        Authorization: `Bearer ${this.params.CLOUDFLARE_D1_TOKEN}`
      },
      // Don't throw on non-2xx status codes
      throwHttpErrors: false
    });
    const createShadowDatabase = /* @__PURE__ */ __name(async () => {
      const tag = "[js::connectToShadowDb::createShadowDatabase]";
      const SHADOW_DATABASE_PREFIX = "_prisma_shadow_";
      const CLOUDFLARE_SHADOW_DATABASE_NAME = `${SHADOW_DATABASE_PREFIX}${globalThis.crypto.randomUUID()}`;
      debug4(`${tag} creating database %s`, CLOUDFLARE_SHADOW_DATABASE_NAME);
      try {
        const response = await client.post(D1_API_BASE_URL, {
          json: {
            name: CLOUDFLARE_SHADOW_DATABASE_NAME
          }
        }).json();
        debug4(`${tag} %O`, response);
        if (!response.success) {
          onUnsuccessfulD1HttpResponse(response);
        }
        const { uuid: CLOUDFLARE_SHADOW_DATABASE_ID2 } = response.result;
        debug4(`${tag} created database %s with ID %s`, CLOUDFLARE_SHADOW_DATABASE_NAME, CLOUDFLARE_SHADOW_DATABASE_ID2);
        return CLOUDFLARE_SHADOW_DATABASE_ID2;
      } catch (e) {
        onGenericD1HttpError(e);
      }
    }, "createShadowDatabase");
    const CLOUDFLARE_SHADOW_DATABASE_ID = this.params.CLOUDFLARE_SHADOW_DATABASE_ID ?? await createShadowDatabase();
    const dispose = /* @__PURE__ */ __name(async () => {
      const tag = "[js::connectToShadowDb::dispose]";
      try {
        debug4(`${tag} deleting database %s`, CLOUDFLARE_SHADOW_DATABASE_ID);
        const response = await client.delete(`${D1_API_BASE_URL}/${CLOUDFLARE_SHADOW_DATABASE_ID}`).json();
        debug4(`${tag} %O`, response);
        if (!response.success) {
          onUnsuccessfulD1HttpResponse(response);
        }
      } catch (e) {
        onGenericD1HttpError(e);
      }
    }, "dispose");
    return new PrismaD1HttpAdapter(this.params, dispose);
  }
}, "PrismaD1HttpAdapterFactory");
var debug22 = Debug2("prisma:driver-adapter:d1");
var D1WorkerQueryable = /* @__PURE__ */ __name(class {
  constructor(client) {
    this.client = client;
  }
  provider = "sqlite";
  adapterName = name;
  /**
   * Execute a query given as SQL, interpolating the given parameters.
   */
  async queryRaw(query) {
    const tag = "[js::query_raw]";
    debug22(`${tag} %O`, query);
    const data = await this.performIO(query);
    const convertedData = this.convertData(data);
    return convertedData;
  }
  convertData(ioResult) {
    const columnNames = ioResult[0];
    const results = ioResult[1];
    if (results.length === 0) {
      return {
        columnNames: [],
        columnTypes: [],
        rows: []
      };
    }
    const columnTypes = Object.values(getColumnTypes(columnNames, results));
    const rows = results.map((value) => mapRow(value, columnTypes));
    return {
      columnNames,
      // * Note: without Object.values the array looks like
      // * columnTypes: [ id: 128 ],
      // * and errors with:
      // * ✘ [ERROR] A hanging Promise was canceled. This happens when the worker runtime is waiting for a Promise from JavaScript to resolve, but has detected that the Promise cannot possibly ever resolve because all code and events related to the Promise's I/O context have already finished.
      columnTypes,
      rows
    };
  }
  /**
   * Execute a query given as SQL, interpolating the given parameters and
   * returning the number of affected rows.
   * Note: Queryable expects a u64, but napi.rs only supports u32.
   */
  async executeRaw(query) {
    const tag = "[js::execute_raw]";
    debug22(`${tag} %O`, query);
    const result = await this.performIO(query, true);
    return result.meta.changes ?? 0;
  }
  async performIO(query, executeRaw = false) {
    try {
      const args = query.args.map((arg, i) => mapArg(arg, query.argTypes[i]));
      const stmt = this.client.prepare(query.sql).bind(...args);
      if (executeRaw) {
        return await stmt.run();
      } else {
        const [columnNames, ...rows] = await stmt.raw({ columnNames: true });
        return [columnNames, rows];
      }
    } catch (e) {
      onError2(e);
    }
  }
}, "D1WorkerQueryable");
var D1WorkerTransaction = /* @__PURE__ */ __name(class extends D1WorkerQueryable {
  constructor(client, options) {
    super(client);
    this.options = options;
  }
  async commit() {
    debug22(`[js::commit]`);
  }
  async rollback() {
    debug22(`[js::rollback]`);
  }
}, "D1WorkerTransaction");
var PrismaD1WorkerAdapter = /* @__PURE__ */ __name(class extends D1WorkerQueryable {
  constructor(client, release2) {
    super(client);
    this.release = release2;
  }
  tags = {
    error: red2("prisma:error"),
    warn: yellow2("prisma:warn"),
    info: cyan2("prisma:info"),
    query: blue2("prisma:query")
  };
  alreadyWarned = /* @__PURE__ */ new Set();
  /**
   * This will warn once per transaction
   * e.g. the following two explicit transactions
   * will only trigger _two_ warnings
   *
   * ```ts
   * await prisma.$transaction([ ...queries ])
   * await prisma.$transaction([ ...moreQueries ])
   * ```
   */
  warnOnce = (key, message, ...args) => {
    if (!this.alreadyWarned.has(key)) {
      this.alreadyWarned.add(key);
      console.info(`${this.tags.warn} ${message}`, ...args);
    }
  };
  async executeScript(script) {
    try {
      await this.client.exec(script);
    } catch (error3) {
      onError2(error3);
    }
  }
  getConnectionInfo() {
    return {
      maxBindValues: MAX_BIND_VALUES,
      supportsRelationJoins: false
    };
  }
  async startTransaction(isolationLevel) {
    if (isolationLevel && isolationLevel !== "SERIALIZABLE") {
      throw new DriverAdapterError({
        kind: "InvalidIsolationLevel",
        level: isolationLevel
      });
    }
    this.warnOnce(
      "D1 Transaction",
      "Cloudflare D1 does not support transactions yet. When using Prisma's D1 adapter, implicit & explicit transactions will be ignored and run as individual queries, which breaks the guarantees of the ACID properties of transactions. For more details see https://pris.ly/d/d1-transactions"
    );
    const options = {
      usePhantomQuery: true
    };
    const tag = "[js::startTransaction]";
    debug22("%s options: %O", tag, options);
    return new D1WorkerTransaction(this.client, options);
  }
  async dispose() {
    await this.release?.();
  }
}, "PrismaD1WorkerAdapter");
var PrismaD1WorkerAdapterFactory = /* @__PURE__ */ __name(class {
  constructor(client) {
    this.client = client;
  }
  provider = "sqlite";
  adapterName = name;
  async connect() {
    return new PrismaD1WorkerAdapter(this.client, async () => {
    });
  }
}, "PrismaD1WorkerAdapterFactory");
function onError2(error3) {
  console.error("Error in performIO: %O", error3);
  throw new DriverAdapterError(convertDriverError(error3));
}
__name(onError2, "onError2");
var PrismaD1 = /* @__PURE__ */ __name(class {
  provider = "sqlite";
  adapterName = name;
  connect;
  connectToShadowDb;
  constructor(params) {
    if (isD1HttpParams(params)) {
      const factory = new PrismaD1HttpAdapterFactory(params);
      const self2 = this;
      self2.connect = factory.connect.bind(factory);
      self2.connectToShadowDb = factory.connectToShadowDb.bind(factory);
    } else {
      const factory = new PrismaD1WorkerAdapterFactory(params);
      const self2 = this;
      self2.connect = factory.connect.bind(factory);
    }
  }
}, "PrismaD1");

// src/backend/lib/db.ts
function getPrismaD1(d1) {
  const adapter = new PrismaD1(d1);
  return new import_prisma.PrismaClient({ adapter });
}
__name(getPrismaD1, "getPrismaD1");

// src/backend/routes/auth.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/utils.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/lib/errors.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var ErrorCodes = {
  // 4xx Client Errors
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNPROCESSABLE_ENTITY: "UNPROCESSABLE_ENTITY",
  // 5xx Server Errors
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  BAD_GATEWAY: "BAD_GATEWAY",
  GATEWAY_TIMEOUT: "GATEWAY_TIMEOUT",
  // Domain-specific codes
  SESSION_EXPIRED: "SESSION_EXPIRED",
  INVALID_TOKEN: "INVALID_TOKEN",
  RESOURCE_EXHAUSTED: "RESOURCE_EXHAUSTED",
  DUPLICATE_ENTRY: "DUPLICATE_ENTRY",
  DEPENDENCY_ERROR: "DEPENDENCY_ERROR"
};
var AppError = class extends Error {
  code;
  statusCode;
  details;
  isOperational;
  constructor(message, code = ErrorCodes.INTERNAL_ERROR, statusCode = 500, details) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
  /**
   * Convert error to API response format
   * This ensures no internal details leak to clients
   */
  toResponse() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...this.details !== void 0 && { details: this.details }
      }
    };
  }
  /**
   * Convert error to JSON for logging
   * Includes full details for server-side logging
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      details: this.details,
      stack: this.stack
    };
  }
};
__name(AppError, "AppError");
var RateLimitError = class extends AppError {
  retryAfter;
  constructor(message = "Rate limit exceeded", retryAfter) {
    super(message, ErrorCodes.RATE_LIMITED, 429);
    this.retryAfter = retryAfter;
  }
};
__name(RateLimitError, "RateLimitError");
var InternalError = class extends AppError {
  constructor(message = "Internal server error", details) {
    super(message, ErrorCodes.INTERNAL_ERROR, 500, details);
  }
};
__name(InternalError, "InternalError");
function isAppError(error3) {
  return error3 instanceof AppError;
}
__name(isAppError, "isAppError");
function logError(error3, context2) {
  const errorInfo = isAppError(error3) ? error3.toJSON() : {
    message: error3 instanceof Error ? error3.message : String(error3),
    stack: error3 instanceof Error ? error3.stack : void 0
  };
  console.error("[Error]", {
    ...errorInfo,
    context: context2,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  });
}
__name(logError, "logError");

// src/backend/middleware/error-handler.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function createErrorMiddleware(options = {}) {
  const { includeStack = false, logger = logError, transformError } = options;
  return (err, c) => {
    const correlationId = c.req.header("x-request-id") || c.req.header("CF-Ray") || crypto.randomUUID();
    let appError;
    if (transformError) {
      appError = transformError(err);
    } else if (isAppError(err)) {
      appError = err;
    } else {
      logger(err, {
        correlationId,
        path: c.req.path,
        method: c.req.method,
        requestId: c.req.header("x-request-id")
      });
      appError = new InternalError("An unexpected error occurred");
    }
    const response = appError.toResponse();
    response.error.correlation_id = correlationId;
    if (includeStack && appError.stack) {
      response.error.stack = appError.stack;
    }
    if (appError instanceof RateLimitError && appError.retryAfter) {
      c.header("Retry-After", String(appError.retryAfter));
    }
    return c.json(response, appError.statusCode);
  };
}
__name(createErrorMiddleware, "createErrorMiddleware");

// src/backend/utils.ts
function safeJsonParse(json, defaultValue) {
  if (!json)
    return defaultValue;
  try {
    return JSON.parse(json);
  } catch (err) {
    console.warn("[Utils] safeJsonParse failed:", err);
    return defaultValue;
  }
}
__name(safeJsonParse, "safeJsonParse");
function parseLimit(value, fallback, max) {
  const parsed = parseInt(value || "", 10);
  if (!Number.isFinite(parsed))
    return fallback;
  return Math.min(Math.max(parsed, 1), max);
}
__name(parseLimit, "parseLimit");
function generateId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(generateId, "generateId");
function actorApId(baseUrl, username) {
  return `${baseUrl}/ap/users/${username}`;
}
__name(actorApId, "actorApId");
function objectApId(baseUrl, id) {
  return `${baseUrl}/ap/objects/${id}`;
}
__name(objectApId, "objectApId");
function activityApId(baseUrl, id) {
  return `${baseUrl}/ap/activities/${id}`;
}
__name(activityApId, "activityApId");
function communityApId(baseUrl, name2) {
  return `${baseUrl}/ap/groups/${name2}`;
}
__name(communityApId, "communityApId");
function getDomain(apId) {
  return new URL(apId).host;
}
__name(getDomain, "getDomain");
function isLocal(apId, baseUrl) {
  return apId.startsWith(baseUrl);
}
__name(isLocal, "isLocal");
function formatUsername(apId) {
  const url = new URL(apId);
  const match2 = apId.match(/\/users\/([^\/]+)$/);
  if (match2) {
    return `${match2[1]}@${url.host}`;
  }
  return apId;
}
__name(formatUsername, "formatUsername");
var HOSTNAME_PATTERN = /^[a-z0-9.-]+$/i;
function parseIPv4(hostname) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname))
    return null;
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255))
    return null;
  return parts;
}
__name(parseIPv4, "parseIPv4");
function isPrivateIPv4(hostname) {
  const parts = parseIPv4(hostname);
  if (!parts)
    return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127)
    return true;
  if (a === 169 && b === 254)
    return true;
  if (a === 172 && b >= 16 && b <= 31)
    return true;
  if (a === 192 && b === 168)
    return true;
  if (a === 100 && b >= 64 && b <= 127)
    return true;
  if (a === 192 && b === 0 && c === 0)
    return true;
  if (a === 192 && b === 0 && c === 2)
    return true;
  if (a === 198 && (b === 18 || b === 19))
    return true;
  if (a === 198 && b === 51 && c === 100)
    return true;
  if (a === 203 && b === 0 && c === 113)
    return true;
  if (a >= 224)
    return true;
  return false;
}
__name(isPrivateIPv4, "isPrivateIPv4");
function isBlockedHostname(hostname) {
  const lower = hostname.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local") || lower.endsWith(".localdomain") || lower.endsWith(".internal")) {
    return true;
  }
  if (lower.includes(":"))
    return true;
  if (isPrivateIPv4(lower))
    return true;
  return false;
}
__name(isBlockedHostname, "isBlockedHostname");
function isSafeRemoteUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password)
      return false;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return false;
    if (!HOSTNAME_PATTERN.test(parsed.hostname))
      return false;
    if (!parsed.hostname.includes("."))
      return false;
    if (isBlockedHostname(parsed.hostname))
      return false;
    return true;
  } catch {
    return false;
  }
}
__name(isSafeRemoteUrl, "isSafeRemoteUrl");
function normalizeRemoteDomain(domain2) {
  const trimmed = domain2.trim();
  if (!trimmed)
    return null;
  try {
    const parsed = new URL(`https://${trimmed}`);
    if (parsed.username || parsed.password)
      return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash)
      return null;
    const hostname = parsed.hostname;
    if (!HOSTNAME_PATTERN.test(hostname))
      return null;
    if (!hostname.includes("."))
      return null;
    if (isBlockedHostname(hostname))
      return null;
    return parsed.host;
  } catch {
    return null;
  }
}
__name(normalizeRemoteDomain, "normalizeRemoteDomain");
async function generateKeyPair() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"]
  );
  const publicKey = await crypto.subtle.exportKey("spki", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const publicKeyPem = `-----BEGIN PUBLIC KEY-----
${btoa(String.fromCharCode(...new Uint8Array(publicKey))).match(/.{1,64}/g)?.join("\n")}
-----END PUBLIC KEY-----`;
  const privateKeyPem = `-----BEGIN PRIVATE KEY-----
${btoa(String.fromCharCode(...new Uint8Array(privateKey))).match(/.{1,64}/g)?.join("\n")}
-----END PRIVATE KEY-----`;
  return { publicKeyPem, privateKeyPem };
}
__name(generateKeyPair, "generateKeyPair");
async function signRequest(privateKeyPem, keyId, method, url, body) {
  const urlObj = new URL(url);
  const date = (/* @__PURE__ */ new Date()).toUTCString();
  const digest = body ? `SHA-256=${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))))}` : void 0;
  const signedHeaders = digest ? "(request-target) host date digest" : "(request-target) host date";
  const signatureString = digest ? `(request-target): ${method.toLowerCase()} ${urlObj.pathname}
host: ${urlObj.host}
date: ${date}
digest: ${digest}` : `(request-target): ${method.toLowerCase()} ${urlObj.pathname}
host: ${urlObj.host}
date: ${date}`;
  const pemContents = privateKeyPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const binaryKey = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey("pkcs8", binaryKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signatureBuffer = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(signatureString));
  const signature = btoa(String.fromCharCode(...new Uint8Array(signatureBuffer)));
  const headers = {
    "Date": date,
    "Host": urlObj.host,
    "Signature": `keyId="${keyId}",algorithm="rsa-sha256",headers="${signedHeaders}",signature="${signature}"`
  };
  if (digest)
    headers["Digest"] = digest;
  return headers;
}
__name(signRequest, "signRequest");
var DEFAULT_FETCH_TIMEOUT_MS = 3e4;
async function fetchWithTimeout(url, options = {}) {
  const { timeout: timeout2 = DEFAULT_FETCH_TIMEOUT_MS, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout2);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal
    });
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeout2 / 1e3} seconds: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
__name(fetchWithTimeout, "fetchWithTimeout");

// src/backend/lib/crypto.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function isValidHexString(hex, expectedLength) {
  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return false;
  }
  if (hex.length % 2 !== 0) {
    return false;
  }
  if (expectedLength !== void 0 && hex.length !== expectedLength) {
    return false;
  }
  return true;
}
__name(isValidHexString, "isValidHexString");
function hexToBytes(hex) {
  if (!isValidHexString(hex)) {
    throw new Error("Invalid hex string: must contain only hexadecimal characters (0-9, a-f, A-F) with even length");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = parseInt(hex.substring(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error(`Invalid hex character at position ${i}`);
    }
    bytes[i / 2] = byte;
  }
  return bytes;
}
__name(hexToBytes, "hexToBytes");
function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(bytesToHex, "bytesToHex");
async function getEncryptionKey(keyHex) {
  if (!keyHex) {
    return null;
  }
  if (!isValidHexString(keyHex, 64)) {
    console.error("Invalid encryption key format: must be exactly 64 hex characters (0-9, a-f, A-F)");
    return null;
  }
  try {
    const keyBytes = hexToBytes(keyHex);
    return await crypto.subtle.importKey(
      "raw",
      keyBytes.buffer,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (error3) {
    console.error("Failed to import encryption key:", error3);
    return null;
  }
}
__name(getEncryptionKey, "getEncryptionKey");
async function encrypt(plaintext, encryptionKey) {
  const key = await getEncryptionKey(encryptionKey);
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is not configured or invalid. A 32-byte (64 hex character) key is required to encrypt sensitive data. Generate one with: openssl rand -hex 32"
    );
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const data = encoder.encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv.buffer },
    key,
    data.buffer
  );
  return `${bytesToHex(iv)}:${bytesToHex(new Uint8Array(ciphertext))}`;
}
__name(encrypt, "encrypt");
async function decrypt(encrypted, encryptionKey) {
  const key = await getEncryptionKey(encryptionKey);
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is not configured or invalid. Cannot decrypt data without the encryption key."
    );
  }
  if (!encrypted.includes(":")) {
    throw new Error(
      "Data appears to be unencrypted (legacy format). Please re-authenticate to encrypt your tokens."
    );
  }
  const [ivHex, ciphertextHex] = encrypted.split(":");
  if (!ivHex || !ciphertextHex) {
    return encrypted;
  }
  try {
    const iv = hexToBytes(ivHex);
    const ciphertext = hexToBytes(ciphertextHex);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv.buffer },
      key,
      ciphertext.buffer
    );
    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error3) {
    throw new Error(
      "Failed to decrypt data. The encryption key may be incorrect or the data is corrupted."
    );
  }
}
__name(decrypt, "decrypt");
var PBKDF2_ITERATIONS = 6e5;
async function verifyPassword(password, storedHash) {
  if (!storedHash.includes(":")) {
    return false;
  }
  const [saltHex, expectedHashHex] = storedHash.split(":");
  if (!saltHex || !expectedHashHex) {
    return false;
  }
  if (!isValidHexString(saltHex) || !isValidHexString(expectedHashHex)) {
    return false;
  }
  try {
    const encoder = new TextEncoder();
    const passwordData = encoder.encode(password);
    const salt = hexToBytes(saltHex);
    const expectedHash = hexToBytes(expectedHashHex);
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordData.buffer,
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt.buffer,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256"
      },
      keyMaterial,
      expectedHash.length * 8
      // Match stored hash length
    );
    const computedHash = new Uint8Array(derivedBits);
    if (computedHash.length !== expectedHash.length) {
      return false;
    }
    let result = 0;
    for (let i = 0; i < computedHash.length; i++) {
      result |= computedHash[i] ^ expectedHash[i];
    }
    return result === 0;
  } catch {
    return false;
  }
}
__name(verifyPassword, "verifyPassword");

// src/backend/lib/oauth-providers.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function getAuthConfig(env2) {
  const providers = [];
  if (env2.GOOGLE_CLIENT_ID && env2.GOOGLE_CLIENT_SECRET) {
    providers.push({
      id: "google",
      name: "Google",
      icon: "/icons/google.svg",
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://www.googleapis.com/oauth2/v2/userinfo",
      scopes: ["openid", "profile", "email"],
      supportsPkce: true
    });
  }
  if (env2.X_CLIENT_ID && env2.X_CLIENT_SECRET) {
    providers.push({
      id: "x",
      name: "X",
      icon: "/icons/x.svg",
      authorizeUrl: "https://twitter.com/i/oauth2/authorize",
      tokenUrl: "https://api.twitter.com/2/oauth2/token",
      userInfoUrl: "https://api.twitter.com/2/users/me",
      scopes: ["tweet.read", "users.read", "offline.access"],
      supportsPkce: true
    });
  }
  if (env2.TAKOS_URL && env2.TAKOS_CLIENT_ID && env2.TAKOS_CLIENT_SECRET) {
    providers.push({
      id: "takos",
      name: "Takos",
      icon: "/icons/takos.svg",
      authorizeUrl: `${env2.TAKOS_URL}/oauth/authorize`,
      tokenUrl: `${env2.TAKOS_URL}/oauth/token`,
      userInfoUrl: `${env2.TAKOS_URL}/oauth/userinfo`,
      scopes: ["openid", "profile", "email", "workspaces:read", "repos:read"],
      supportsPkce: true,
      apiBaseUrl: env2.TAKOS_URL
    });
  }
  return {
    // AUTH_PASSWORD_HASH (secure) or AUTH_PASSWORD (legacy)
    passwordEnabled: !!(env2.AUTH_PASSWORD_HASH || env2.AUTH_PASSWORD),
    providers
  };
}
__name(getAuthConfig, "getAuthConfig");
function getProvider(env2, providerId) {
  const config2 = getAuthConfig(env2);
  return config2.providers.find((p) => p.id === providerId) || null;
}
__name(getProvider, "getProvider");
function getClientId(env2, providerId) {
  switch (providerId) {
    case "google":
      return env2.GOOGLE_CLIENT_ID || "";
    case "x":
      return env2.X_CLIENT_ID || "";
    case "takos":
      return env2.TAKOS_CLIENT_ID || "";
    default:
      return "";
  }
}
__name(getClientId, "getClientId");
function getClientSecret(env2, providerId) {
  switch (providerId) {
    case "google":
      return env2.GOOGLE_CLIENT_SECRET || "";
    case "x":
      return env2.X_CLIENT_SECRET || "";
    case "takos":
      return env2.TAKOS_CLIENT_SECRET || "";
    default:
      return "";
  }
}
__name(getClientSecret, "getClientSecret");
async function fetchUserInfo(provider, accessToken) {
  const headers = {
    Authorization: `Bearer ${accessToken}`
  };
  let url = provider.userInfoUrl;
  if (provider.id === "x") {
    url += "?user.fields=profile_image_url";
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch user info: ${res.status}`);
  }
  const data = await res.json();
  switch (provider.id) {
    case "google": {
      const g = data;
      return {
        id: g.id,
        name: g.name,
        email: g.email,
        picture: g.picture
      };
    }
    case "x": {
      const x = data;
      return {
        id: x.data.id,
        name: x.data.name,
        username: x.data.username,
        picture: x.data.profile_image_url
      };
    }
    case "takos": {
      const t = data;
      return {
        id: t.user.id,
        name: t.user.name,
        email: t.user.email,
        picture: t.user.picture
      };
    }
    default:
      throw new Error(`Unknown provider: ${provider.id}`);
  }
}
__name(fetchUserInfo, "fetchUserInfo");

// src/backend/lib/oauth-utils.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function generateId2(length = 21) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join("");
}
__name(generateId2, "generateId");
function generateCodeVerifier() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => chars[byte % chars.length]).join("");
}
__name(generateCodeVerifier, "generateCodeVerifier");
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(digest);
}
__name(generateCodeChallenge, "generateCodeChallenge");
function base64UrlEncode(buffer) {
  if (buffer == null) {
    throw new Error("base64UrlEncode: buffer cannot be null or undefined");
  }
  if (!(buffer instanceof ArrayBuffer)) {
    throw new Error("base64UrlEncode: buffer must be an ArrayBuffer");
  }
  if (buffer.byteLength === 0) {
    return "";
  }
  try {
    const bytes = new Uint8Array(buffer);
    const CHUNK_SIZE = 8192;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch (error3) {
    throw new Error(`base64UrlEncode: encoding failed - ${error3 instanceof Error ? error3.message : String(error3)}`);
  }
}
__name(base64UrlEncode, "base64UrlEncode");
async function saveOAuthState(kv, state, data) {
  await kv.put(`oauth:${state}`, JSON.stringify(data), {
    // PRIMARY expiration: KV TTL auto-deletes after 10 minutes
    // This is the authoritative expiration mechanism
    expirationTtl: 600
    // 10 minutes in seconds
  });
}
__name(saveOAuthState, "saveOAuthState");
async function getOAuthState(kv, state) {
  const stored = await kv.get(`oauth:${state}`);
  if (!stored)
    return null;
  const data = JSON.parse(stored);
  const STATE_TTL_MS = 6e5;
  if (Date.now() - data.createdAt > STATE_TTL_MS) {
    await kv.delete(`oauth:${state}`);
    return null;
  }
  return data;
}
__name(getOAuthState, "getOAuthState");
async function deleteOAuthState(kv, state) {
  await kv.delete(`oauth:${state}`);
}
__name(deleteOAuthState, "deleteOAuthState");

// src/backend/routes/auth.ts
function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const maxLen = Math.max(aBytes.length, bBytes.length);
  let result = aBytes.length === bBytes.length ? 0 : 1;
  for (let i = 0; i < maxLen; i++) {
    const aByte = i < aBytes.length ? aBytes[i] : 0;
    const bByte = i < bBytes.length ? bBytes[i] : 0;
    result |= aByte ^ bByte;
  }
  return result === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
var auth = new Hono2();
auth.get("/providers", async (c) => {
  const config2 = getAuthConfig(c.env);
  return c.json({
    providers: config2.providers.map((p) => ({
      id: p.id,
      name: p.name,
      icon: p.icon
    })),
    password_enabled: config2.passwordEnabled
  });
});
auth.get("/me", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Not authenticated" }, 401);
  const sessionId = getCookie(c, "session");
  let provider = null;
  let hasTakosAccess = false;
  if (sessionId) {
    const prisma = c.get("prisma");
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { provider: true, providerAccessToken: true }
    });
    if (session) {
      provider = session.provider;
      hasTakosAccess = session.provider === "takos" && !!session.providerAccessToken;
    }
  }
  return c.json({
    actor: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id),
      preferred_username: actor.preferred_username,
      name: actor.name,
      summary: actor.summary,
      icon_url: actor.icon_url,
      header_url: actor.header_url,
      follower_count: actor.follower_count,
      following_count: actor.following_count,
      post_count: actor.post_count,
      role: actor.role
    },
    provider,
    has_takos_access: hasTakosAccess
  });
});
auth.post("/login", async (c) => {
  const config2 = getAuthConfig(c.env);
  if (!config2.passwordEnabled) {
    return c.json({ error: "Password auth not enabled" }, 400);
  }
  const body = await c.req.json();
  const password = body.password || "";
  let isValid = false;
  if (c.env.AUTH_PASSWORD_HASH) {
    isValid = await verifyPassword(password, c.env.AUTH_PASSWORD_HASH);
  } else if (c.env.AUTH_PASSWORD) {
    console.warn(
      "[SECURITY WARNING] AUTH_PASSWORD is deprecated. Use AUTH_PASSWORD_HASH with PBKDF2-hashed password instead. See docs for migration guide."
    );
    isValid = timingSafeEqual(password, c.env.AUTH_PASSWORD);
  }
  if (!isValid) {
    return c.json({ error: "Invalid password" }, 401);
  }
  const prisma = c.get("prisma");
  const existingSessionId = getCookie(c, "session");
  if (existingSessionId) {
    await prisma.session.delete({ where: { id: existingSessionId } }).catch(() => {
    });
    deleteCookie(c, "session");
  }
  let actorData = await prisma.actor.findFirst({
    where: { role: "owner" }
  });
  if (!actorData) {
    actorData = await createDefaultOwner(prisma, c.env, "password:owner");
  }
  const sessionId = await createSession(prisma, actorData.apId, null, null, c.env.ENCRYPTION_KEY);
  setSessionCookie(c, sessionId);
  return c.json({ success: true });
});
auth.get("/login/:provider", async (c) => {
  const providerId = c.req.param("provider");
  const provider = getProvider(c.env, providerId);
  if (!provider) {
    return c.json({ error: "Unknown or unconfigured provider" }, 400);
  }
  const state = generateId2();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  await saveOAuthState(c.env.KV, state, {
    provider: providerId,
    codeVerifier,
    createdAt: Date.now()
  });
  const clientId = getClientId(c.env, providerId);
  const redirectUri = `${c.env.APP_URL}/api/auth/callback/${providerId}`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: provider.scopes.join(" "),
    state
  });
  if (provider.supportsPkce) {
    params.set("code_challenge", codeChallenge);
    params.set("code_challenge_method", "S256");
  }
  return c.redirect(`${provider.authorizeUrl}?${params.toString()}`);
});
auth.get("/callback/:provider", async (c) => {
  const providerId = c.req.param("provider");
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error3 = c.req.query("error");
  const errorDescription = c.req.query("error_description");
  if (error3) {
    console.error("OAuth error:", error3, errorDescription);
    const knownErrors = [
      "access_denied",
      "invalid_request",
      "unauthorized_client",
      "unsupported_response_type",
      "invalid_scope",
      "server_error",
      "temporarily_unavailable",
      "interaction_required",
      "login_required",
      "consent_required"
    ];
    const safeError = knownErrors.includes(error3) ? error3 : "oauth_error";
    return c.redirect(`/?error=${safeError}`);
  }
  if (!code || !state) {
    return c.redirect("/?error=missing_params");
  }
  const storedState = await getOAuthState(c.env.KV, state);
  if (!storedState) {
    return c.redirect("/?error=invalid_state");
  }
  if (storedState.provider !== providerId) {
    return c.redirect("/?error=provider_mismatch");
  }
  await deleteOAuthState(c.env.KV, state);
  const provider = getProvider(c.env, providerId);
  if (!provider) {
    return c.redirect("/?error=unknown_provider");
  }
  const clientId = getClientId(c.env, providerId);
  const clientSecret = getClientSecret(c.env, providerId);
  const redirectUri = `${c.env.APP_URL}/api/auth/callback/${providerId}`;
  const tokenBody = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret
  };
  if (provider.supportsPkce) {
    tokenBody.code_verifier = storedState.codeVerifier;
  }
  const tokenHeaders = {
    "Content-Type": "application/x-www-form-urlencoded"
  };
  if (providerId === "x") {
    const credentials = btoa(`${clientId}:${clientSecret}`);
    tokenHeaders["Authorization"] = `Basic ${credentials}`;
    delete tokenBody.client_secret;
  }
  console.log("Token exchange request:", {
    url: provider.tokenUrl,
    clientId,
    redirectUri,
    hasCodeVerifier: !!tokenBody.code_verifier
  });
  const tokenRes = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: tokenHeaders,
    body: new URLSearchParams(tokenBody)
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("Token exchange failed:", {
      status: tokenRes.status,
      statusText: tokenRes.statusText,
      body: errText,
      url: provider.tokenUrl
    });
    return c.redirect("/?error=token_exchange_failed");
  }
  const tokens = await tokenRes.json();
  let userInfo;
  try {
    userInfo = await fetchUserInfo(provider, tokens.access_token);
  } catch (err) {
    console.error("Failed to fetch user info:", err);
    return c.redirect("/?error=user_info_failed");
  }
  const providerUserId = `${providerId}:${userInfo.id}`;
  const prisma = c.get("prisma");
  let actorData = await prisma.actor.findFirst({
    where: { takosUserId: providerUserId }
  });
  if (!actorData) {
    actorData = await createActorFromOAuth(prisma, c.env, userInfo, providerUserId);
  } else {
    await updateActorFromOAuth(prisma, actorData, userInfo);
  }
  const existingSessionId = getCookie(c, "session");
  if (existingSessionId) {
    await prisma.session.delete({ where: { id: existingSessionId } }).catch(() => {
    });
    deleteCookie(c, "session");
  }
  const sessionId = await createSession(
    prisma,
    actorData.apId,
    providerId,
    providerId === "takos" ? tokens : null,
    c.env.ENCRYPTION_KEY
  );
  setSessionCookie(c, sessionId);
  return c.redirect("/");
});
auth.post("/logout", async (c) => {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    const prisma = c.get("prisma");
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {
    });
    deleteCookie(c, "session");
  }
  return c.json({ success: true });
});
auth.get("/accounts", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Not authenticated" }, 401);
  const prisma = c.get("prisma");
  const accounts = await prisma.actor.findMany({
    select: {
      apId: true,
      preferredUsername: true,
      name: true,
      iconUrl: true
    },
    orderBy: { createdAt: "asc" }
  });
  return c.json({
    accounts: accounts.map((a) => ({
      ap_id: a.apId,
      preferred_username: a.preferredUsername,
      name: a.name,
      icon_url: a.iconUrl
    })),
    current_ap_id: actor.ap_id
  });
});
auth.post("/switch", async (c) => {
  const currentActor = c.get("actor");
  if (!currentActor)
    return c.json({ error: "Not authenticated" }, 401);
  const sessionId = getCookie(c, "session");
  if (!sessionId)
    return c.json({ error: "No session" }, 401);
  const body = await c.req.json();
  if (!body.ap_id)
    return c.json({ error: "ap_id required" }, 400);
  const prisma = c.get("prisma");
  const targetActor = await prisma.actor.findUnique({
    where: { apId: body.ap_id },
    select: { apId: true }
  });
  if (!targetActor)
    return c.json({ error: "Account not found" }, 404);
  await prisma.session.update({
    where: { id: sessionId },
    data: { memberId: body.ap_id }
  });
  return c.json({ success: true });
});
auth.post("/accounts", async (c) => {
  const currentActor = c.get("actor");
  if (!currentActor)
    return c.json({ error: "Not authenticated" }, 401);
  const body = await c.req.json();
  if (!body.username)
    return c.json({ error: "username required" }, 400);
  if (!/^[a-zA-Z0-9_]+$/.test(body.username)) {
    return c.json({ error: "Invalid username. Use only letters, numbers, and underscores." }, 400);
  }
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, body.username);
  const prisma = c.get("prisma");
  const existing = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true }
  });
  if (existing)
    return c.json({ error: "Username already taken" }, 400);
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const newActor = await prisma.actor.create({
    data: {
      apId,
      type: "Person",
      preferredUsername: body.username,
      name: body.name || body.username,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem,
      privateKeyPem,
      takosUserId: `local:${body.username}`,
      role: "member"
    },
    select: {
      apId: true,
      preferredUsername: true,
      name: true,
      iconUrl: true
    }
  });
  return c.json({
    success: true,
    account: {
      ap_id: newActor.apId,
      preferred_username: newActor.preferredUsername,
      name: newActor.name,
      icon_url: newActor.iconUrl
    }
  });
});
async function createDefaultOwner(prisma, env2, takosUserId) {
  const baseUrl = env2.APP_URL;
  const username = "tako";
  const apId = actorApId(baseUrl, username);
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  return await prisma.actor.create({
    data: {
      apId,
      type: "Person",
      preferredUsername: username,
      name: username,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem,
      privateKeyPem,
      takosUserId,
      role: "owner"
    }
  });
}
__name(createDefaultOwner, "createDefaultOwner");
async function createActorFromOAuth(prisma, env2, userInfo, providerUserId) {
  const baseUrl = env2.APP_URL;
  let baseUsername = userInfo.username || userInfo.name.toLowerCase().replace(/[^a-z0-9]/g, "") || "user";
  let username = baseUsername;
  let counter = 1;
  while (true) {
    const apId2 = actorApId(baseUrl, username);
    const existing = await prisma.actor.findUnique({
      where: { apId: apId2 },
      select: { apId: true }
    });
    if (!existing)
      break;
    username = `${baseUsername}${counter}`;
    counter++;
  }
  const apId = actorApId(baseUrl, username);
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const actorCount = await prisma.actor.count();
  const role = actorCount === 0 ? "owner" : "member";
  return await prisma.actor.create({
    data: {
      apId,
      type: "Person",
      preferredUsername: username,
      name: userInfo.name,
      iconUrl: userInfo.picture || null,
      inbox: `${apId}/inbox`,
      outbox: `${apId}/outbox`,
      followersUrl: `${apId}/followers`,
      followingUrl: `${apId}/following`,
      publicKeyPem,
      privateKeyPem,
      takosUserId: providerUserId,
      role
    }
  });
}
__name(createActorFromOAuth, "createActorFromOAuth");
async function updateActorFromOAuth(prisma, actor, userInfo) {
  await prisma.actor.update({
    where: { apId: actor.apId },
    data: {
      name: userInfo.name,
      iconUrl: userInfo.picture || void 0
    }
  });
}
__name(updateActorFromOAuth, "updateActorFromOAuth");
async function createSession(prisma, actorApId2, provider, tokens, encryptionKey) {
  const sessionId = generateId();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1e3).toISOString();
  const tokenExpiresAt = tokens?.expires_in ? new Date(Date.now() + tokens.expires_in * 1e3).toISOString() : null;
  const encryptedAccessToken = tokens?.access_token ? await encrypt(tokens.access_token, encryptionKey) : null;
  const encryptedRefreshToken = tokens?.refresh_token ? await encrypt(tokens.refresh_token, encryptionKey) : null;
  await prisma.session.create({
    data: {
      id: sessionId,
      memberId: actorApId2,
      accessToken: sessionId,
      // legacy: access_token = sessionId
      expiresAt,
      provider,
      providerAccessToken: encryptedAccessToken,
      providerRefreshToken: encryptedRefreshToken,
      providerTokenExpiresAt: tokenExpiresAt
    }
  });
  return sessionId;
}
__name(createSession, "createSession");
function setSessionCookie(c, sessionId) {
  setCookie(c, "session", sessionId, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 30 * 24 * 60 * 60
  });
}
__name(setSessionCookie, "setSessionCookie");
var auth_default = auth;

// src/backend/routes/actors.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/middleware/cache.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var CacheTTL = {
  /** Public timeline (2 minutes) - frequently updated */
  PUBLIC_TIMELINE: 120,
  /** Actor profile data (5 minutes) */
  ACTOR_PROFILE: 300,
  /** ActivityPub actor JSON (10 minutes) */
  ACTIVITYPUB_ACTOR: 600,
  /** WebFinger response (1 hour) */
  WEBFINGER: 3600,
  /** Community info (5 minutes) */
  COMMUNITY: 300,
  /** Static content like well-known (1 hour) */
  STATIC: 3600,
  /** Search results (1 minute) */
  SEARCH: 60
};
var CacheTags = {
  TIMELINE: "timeline",
  ACTOR: "actor",
  COMMUNITY: "community",
  POST: "post",
  WEBFINGER: "webfinger"
};
var LRUCache = class {
  cache = /* @__PURE__ */ new Map();
  maxSize;
  constructor(maxSize = 1e3) {
    this.maxSize = maxSize;
  }
  get(key) {
    const entry = this.cache.get(key);
    if (!entry)
      return void 0;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return void 0;
    }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }
  set(key, entry) {
    while (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, entry);
  }
  delete(key) {
    return this.cache.delete(key);
  }
  deleteByTag(tag) {
    let deleted = 0;
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (entry.tag === tag) {
        this.cache.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
  clear() {
    this.cache.clear();
  }
  // Cleanup expired entries
  cleanup() {
    const now = Date.now();
    const entries = Array.from(this.cache.entries());
    for (const [key, entry] of entries) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }
};
__name(LRUCache, "LRUCache");
var memoryCache = new LRUCache(1e3);
var CLEANUP_INTERVAL = 5 * 60 * 1e3;
var lastCleanup = Date.now();
function maybeCleanup() {
  const now = Date.now();
  if (now - lastCleanup >= CLEANUP_INTERVAL) {
    lastCleanup = now;
    memoryCache.cleanup();
  }
}
__name(maybeCleanup, "maybeCleanup");
function generateCacheKey(c, config2) {
  if (config2.cacheKeyGenerator) {
    return config2.cacheKeyGenerator(c);
  }
  const url = new URL(c.req.url);
  let cacheKey = url.pathname;
  if (config2.includeQueryParams !== false) {
    const params = new URLSearchParams();
    if (config2.queryParamsToInclude) {
      for (const key of config2.queryParamsToInclude) {
        const value = url.searchParams.get(key);
        if (value !== null) {
          params.set(key, value);
        }
      }
    } else {
      const sortedKeys = Array.from(url.searchParams.keys()).sort();
      for (const key of sortedKeys) {
        params.set(key, url.searchParams.get(key));
      }
    }
    const queryString = params.toString();
    if (queryString) {
      cacheKey += `?${queryString}`;
    }
  }
  if (config2.varyByActor) {
    const actor = c.get("actor");
    if (actor) {
      cacheKey += `#actor:${actor.ap_id}`;
    } else {
      cacheKey += "#actor:anonymous";
    }
  }
  return cacheKey;
}
__name(generateCacheKey, "generateCacheKey");
async function generateETag(body) {
  const encoder = new TextEncoder();
  const data = encoder.encode(body);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  return `"${hashHex.substring(0, 16)}"`;
}
__name(generateETag, "generateETag");
function isCloudflareWorkers() {
  return typeof caches !== "undefined" && "default" in caches;
}
__name(isCloudflareWorkers, "isCloudflareWorkers");
function withCache(config2) {
  return async (c, next) => {
    if (c.req.method !== "GET") {
      await next();
      return;
    }
    if (!config2.varyByActor) {
      const actor = c.get("actor");
      if (actor) {
        await next();
        return;
      }
    }
    const cacheKey = generateCacheKey(c, config2);
    if (isCloudflareWorkers()) {
      return handleCloudflareCache(c, next, cacheKey, config2);
    } else {
      return handleMemoryCache(c, next, cacheKey, config2);
    }
  };
}
__name(withCache, "withCache");
async function handleCloudflareCache(c, next, cacheKey, config2) {
  const cache = caches.default;
  const url = new URL(c.req.url);
  const fullCacheKey = new Request(`${url.origin}/_cache${cacheKey}`);
  const cachedResponse = await cache.match(fullCacheKey);
  if (cachedResponse) {
    const ifNoneMatch = c.req.header("If-None-Match");
    const etag2 = cachedResponse.headers.get("ETag");
    if (ifNoneMatch && etag2 && ifNoneMatch === etag2) {
      return c.body(null, 304);
    }
    const ifModifiedSince = c.req.header("If-Modified-Since");
    const lastModified = cachedResponse.headers.get("Last-Modified");
    if (ifModifiedSince && lastModified) {
      const ifModifiedDate = new Date(ifModifiedSince);
      const lastModifiedDate = new Date(lastModified);
      if (ifModifiedDate >= lastModifiedDate) {
        return c.body(null, 304);
      }
    }
    const headers2 = new Headers(cachedResponse.headers);
    headers2.set("X-Cache", "HIT");
    return new Response(cachedResponse.body, {
      status: cachedResponse.status,
      headers: headers2
    });
  }
  await next();
  if (c.res.status !== 200) {
    return;
  }
  const responseBody = await c.res.text();
  const etag = await generateETag(responseBody);
  const now = /* @__PURE__ */ new Date();
  let cacheControl = `public, max-age=${config2.ttl}`;
  if (config2.staleWhileRevalidate) {
    cacheControl += `, stale-while-revalidate=${config2.staleWhileRevalidate}`;
  }
  const headers = new Headers(c.res.headers);
  headers.set("Cache-Control", cacheControl);
  headers.set("ETag", etag);
  headers.set("Last-Modified", now.toUTCString());
  headers.set("X-Cache", "MISS");
  if (config2.cacheTag) {
    headers.set("Cache-Tag", config2.cacheTag);
  }
  const responseToCache = new Response(responseBody, {
    status: 200,
    headers
  });
  const ctx = c.executionCtx;
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(
      cache.put(fullCacheKey, responseToCache.clone()).catch((err) => {
        console.error("Failed to store response in cache:", err);
      })
    );
  }
  c.res = responseToCache;
}
__name(handleCloudflareCache, "handleCloudflareCache");
async function handleMemoryCache(c, next, cacheKey, config2) {
  maybeCleanup();
  const cached = memoryCache.get(cacheKey);
  if (cached) {
    const ifNoneMatch = c.req.header("If-None-Match");
    if (ifNoneMatch && ifNoneMatch === cached.etag) {
      return c.body(null, 304);
    }
    const ifModifiedSince = c.req.header("If-Modified-Since");
    if (ifModifiedSince) {
      const ifModifiedDate = new Date(ifModifiedSince);
      const lastModifiedDate = new Date(cached.lastModified);
      if (ifModifiedDate >= lastModifiedDate) {
        return c.body(null, 304);
      }
    }
    const headers2 = new Headers(cached.headers);
    headers2.set("X-Cache", "HIT");
    return new Response(cached.body, {
      status: cached.status,
      headers: headers2
    });
  }
  await next();
  if (c.res.status !== 200) {
    return;
  }
  const responseBody = await c.res.text();
  const etag = await generateETag(responseBody);
  const now = /* @__PURE__ */ new Date();
  let cacheControl = `public, max-age=${config2.ttl}`;
  if (config2.staleWhileRevalidate) {
    cacheControl += `, stale-while-revalidate=${config2.staleWhileRevalidate}`;
  }
  const headers = new Headers(c.res.headers);
  headers.set("Cache-Control", cacheControl);
  headers.set("ETag", etag);
  headers.set("Last-Modified", now.toUTCString());
  headers.set("X-Cache", "MISS");
  if (config2.cacheTag) {
    headers.set("Cache-Tag", config2.cacheTag);
  }
  const headersObj = {};
  headers.forEach((value, key) => {
    headersObj[key] = value;
  });
  memoryCache.set(cacheKey, {
    body: responseBody,
    headers: headersObj,
    status: 200,
    expiresAt: Date.now() + config2.ttl * 1e3,
    etag,
    lastModified: now.toUTCString(),
    tag: config2.cacheTag
  });
  c.res = new Response(responseBody, {
    status: 200,
    headers
  });
}
__name(handleMemoryCache, "handleMemoryCache");

// src/backend/routes/actors.ts
var actors = new Hono2();
var MAX_ACTOR_POSTS_LIMIT = 100;
var MAX_PROFILE_NAME_LENGTH = 50;
var MAX_PROFILE_SUMMARY_LENGTH = 500;
var MAX_PROFILE_URL_LENGTH = 2e3;
function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
__name(isValidHttpUrl, "isValidHttpUrl");
async function resolveActorApId(c, identifier) {
  const baseUrl = c.env.APP_URL;
  if (identifier.startsWith("http")) {
    return identifier;
  }
  if (identifier.includes("@")) {
    const stripped = identifier.replace(/^@/, "");
    const parts = stripped.split("@");
    const username = parts[0];
    if (!username)
      return null;
    if (parts.length === 1) {
      return actorApId(baseUrl, username);
    }
    const domain2 = parts.slice(1).join("@");
    if (!domain2)
      return null;
    if (domain2 === getDomain(baseUrl)) {
      return actorApId(baseUrl, username);
    }
    const prisma = c.get("prisma");
    const cached = await prisma.actorCache.findFirst({
      where: {
        preferredUsername: username,
        apId: { contains: domain2 }
      },
      select: { apId: true }
    });
    return cached?.apId || null;
  }
  return actorApId(baseUrl, identifier);
}
__name(resolveActorApId, "resolveActorApId");
actors.get("/", withCache({
  ttl: CacheTTL.ACTOR_PROFILE,
  cacheTag: CacheTags.ACTOR
}), async (c) => {
  const prisma = c.get("prisma");
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);
  const offset = parseInt(c.req.query("offset") || "0");
  const actorsList = await prisma.actor.findMany({
    select: {
      apId: true,
      preferredUsername: true,
      name: true,
      summary: true,
      iconUrl: true,
      role: true,
      followerCount: true,
      followingCount: true,
      postCount: true,
      createdAt: true
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    skip: offset
  });
  return c.json({
    actors: actorsList.map((a) => ({
      ap_id: a.apId,
      preferred_username: a.preferredUsername,
      name: a.name,
      summary: a.summary,
      icon_url: a.iconUrl,
      role: a.role,
      follower_count: a.followerCount,
      following_count: a.followingCount,
      post_count: a.postCount,
      created_at: a.createdAt,
      username: formatUsername(a.apId)
    }))
  });
});
actors.get("/me/blocked", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);
  const offset = parseInt(c.req.query("offset") || "0");
  const blocks = await prisma.block.findMany({
    where: { blockerApId: actor.ap_id },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset
  });
  const blockedApIds = blocks.map((b) => b.blockedApId);
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: blockedApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: blockedApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true }
    })
  ]);
  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
  const blockedList = blocks.map((b) => {
    const actorInfo = localActorMap.get(b.blockedApId) || cachedActorMap.get(b.blockedApId);
    return {
      ap_id: b.blockedApId,
      username: formatUsername(b.blockedApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      summary: actorInfo?.summary || null
    };
  });
  return c.json({ blocked: blockedList });
});
actors.post("/me/blocked", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (!body.ap_id)
    return c.json({ error: "ap_id required" }, 400);
  if (body.ap_id === actor.ap_id)
    return c.json({ error: "Cannot block yourself" }, 400);
  const prisma = c.get("prisma");
  await prisma.block.upsert({
    where: {
      blockerApId_blockedApId: { blockerApId: actor.ap_id, blockedApId: body.ap_id }
    },
    create: { blockerApId: actor.ap_id, blockedApId: body.ap_id },
    update: {}
  });
  return c.json({ success: true });
});
actors.delete("/me/blocked", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (!body.ap_id)
    return c.json({ error: "ap_id required" }, 400);
  const prisma = c.get("prisma");
  await prisma.block.delete({
    where: {
      blockerApId_blockedApId: { blockerApId: actor.ap_id, blockedApId: body.ap_id }
    }
  }).catch(() => {
  });
  return c.json({ success: true });
});
actors.get("/me/muted", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);
  const offset = parseInt(c.req.query("offset") || "0");
  const mutes = await prisma.mute.findMany({
    where: { muterApId: actor.ap_id },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset
  });
  const mutedApIds = mutes.map((m) => m.mutedApId);
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: mutedApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: mutedApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true }
    })
  ]);
  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
  const mutedList = mutes.map((m) => {
    const actorInfo = localActorMap.get(m.mutedApId) || cachedActorMap.get(m.mutedApId);
    return {
      ap_id: m.mutedApId,
      username: formatUsername(m.mutedApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      summary: actorInfo?.summary || null
    };
  });
  return c.json({ muted: mutedList });
});
actors.post("/me/muted", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (!body.ap_id)
    return c.json({ error: "ap_id required" }, 400);
  if (body.ap_id === actor.ap_id)
    return c.json({ error: "Cannot mute yourself" }, 400);
  const prisma = c.get("prisma");
  await prisma.mute.upsert({
    where: {
      muterApId_mutedApId: { muterApId: actor.ap_id, mutedApId: body.ap_id }
    },
    create: { muterApId: actor.ap_id, mutedApId: body.ap_id },
    update: {}
  });
  return c.json({ success: true });
});
actors.delete("/me/muted", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (!body.ap_id)
    return c.json({ error: "ap_id required" }, 400);
  const prisma = c.get("prisma");
  await prisma.mute.delete({
    where: {
      muterApId_mutedApId: { muterApId: actor.ap_id, mutedApId: body.ap_id }
    }
  }).catch(() => {
  });
  return c.json({ success: true });
});
actors.post("/me/delete", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const actorApIdVal = actor.ap_id;
  const prisma = c.get("prisma");
  try {
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { memberId: actorApIdVal } });
      await tx.follow.deleteMany({
        where: { OR: [{ followerApId: actorApIdVal }, { followingApId: actorApIdVal }] }
      });
      await tx.block.deleteMany({
        where: { OR: [{ blockerApId: actorApIdVal }, { blockedApId: actorApIdVal }] }
      });
      await tx.mute.deleteMany({
        where: { OR: [{ muterApId: actorApIdVal }, { mutedApId: actorApIdVal }] }
      });
      await tx.like.deleteMany({ where: { actorApId: actorApIdVal } });
      await tx.bookmark.deleteMany({ where: { actorApId: actorApIdVal } });
      await tx.announce.deleteMany({ where: { actorApId: actorApIdVal } });
      await tx.inbox.deleteMany({ where: { actorApId: actorApIdVal } });
      const memberships = await tx.communityMember.findMany({
        where: { actorApId: actorApIdVal },
        select: { communityApId: true }
      });
      const communityApIds = memberships.map((m) => m.communityApId);
      if (communityApIds.length > 0) {
        await tx.community.updateMany({
          where: { apId: { in: communityApIds } },
          data: { memberCount: { decrement: 1 } }
        });
      }
      await tx.communityMember.deleteMany({ where: { actorApId: actorApIdVal } });
      await tx.objectRecipient.deleteMany({ where: { recipientApId: actorApIdVal } });
      await tx.activity.deleteMany({ where: { actorApId: actorApIdVal } });
      const authoredObjects = await tx.object.findMany({
        where: { attributedTo: actorApIdVal },
        select: { apId: true }
      });
      const objectIds = authoredObjects.map((o) => o.apId);
      if (objectIds.length > 0) {
        await tx.like.deleteMany({ where: { objectApId: { in: objectIds } } });
        await tx.announce.deleteMany({ where: { objectApId: { in: objectIds } } });
        await tx.bookmark.deleteMany({ where: { objectApId: { in: objectIds } } });
        await tx.storyVote.deleteMany({ where: { storyApId: { in: objectIds } } });
        await tx.storyView.deleteMany({ where: { storyApId: { in: objectIds } } });
      }
      await tx.object.deleteMany({ where: { attributedTo: actorApIdVal } });
      await tx.actor.delete({ where: { apId: actorApIdVal } });
    });
    deleteCookie(c, "session");
    return c.json({ success: true });
  } catch (error3) {
    console.error("Account deletion failed:", error3 instanceof Error ? error3.message : "Unknown error");
    return c.json({ error: "Account deletion failed" }, 500);
  }
});
actors.get("/:identifier/posts", async (c) => {
  const currentActor = c.get("actor");
  const identifier = c.req.param("identifier");
  const apId = await resolveActorApId(c, identifier);
  if (!apId)
    return c.json({ error: "Actor not found" }, 404);
  const prisma = c.get("prisma");
  const actorExists = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true }
  });
  const cachedExists = actorExists ? null : await prisma.actorCache.findUnique({
    where: { apId },
    select: { apId: true }
  });
  if (!actorExists && !cachedExists) {
    return c.json({ error: "Actor not found" }, 404);
  }
  const limit = parseLimit(c.req.query("limit"), 20, MAX_ACTOR_POSTS_LIMIT);
  const before = c.req.query("before");
  const isOwnProfile = currentActor && currentActor.ap_id === apId;
  const posts4 = await prisma.object.findMany({
    where: {
      type: "Note",
      inReplyTo: null,
      visibility: isOwnProfile ? { not: "direct" } : "public",
      attributedTo: apId,
      ...before ? { published: { lt: before } } : {}
    },
    orderBy: { published: "desc" },
    take: limit
  });
  const authorApIds = [...new Set(posts4.map((p) => p.attributedTo))];
  const [localAuthors, cachedAuthors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    })
  ]);
  const localAuthorMap = new Map(localAuthors.map((a) => [a.apId, a]));
  const cachedAuthorMap = new Map(cachedAuthors.map((a) => [a.apId, a]));
  const postApIds = posts4.map((p) => p.apId);
  const likedPostIds = /* @__PURE__ */ new Set();
  const bookmarkedPostIds = /* @__PURE__ */ new Set();
  const repostedPostIds = /* @__PURE__ */ new Set();
  if (currentActor) {
    const [likes, bookmarks, announces] = await Promise.all([
      prisma.like.findMany({
        where: { actorApId: currentActor.ap_id, objectApId: { in: postApIds } },
        select: { objectApId: true }
      }),
      prisma.bookmark.findMany({
        where: { actorApId: currentActor.ap_id, objectApId: { in: postApIds } },
        select: { objectApId: true }
      }),
      prisma.announce.findMany({
        where: { actorApId: currentActor.ap_id, objectApId: { in: postApIds } },
        select: { objectApId: true }
      })
    ]);
    likes.forEach((l) => likedPostIds.add(l.objectApId));
    bookmarks.forEach((b) => bookmarkedPostIds.add(b.objectApId));
    announces.forEach((a) => repostedPostIds.add(a.objectApId));
  }
  const result = posts4.map((p) => {
    const author = localAuthorMap.get(p.attributedTo) || cachedAuthorMap.get(p.attributedTo);
    return {
      ap_id: p.apId,
      type: p.type,
      author: {
        ap_id: p.attributedTo,
        username: formatUsername(p.attributedTo),
        preferred_username: author?.preferredUsername || null,
        name: author?.name || null,
        icon_url: author?.iconUrl || null
      },
      content: p.content,
      summary: p.summary,
      attachments: JSON.parse(p.attachmentsJson || "[]"),
      in_reply_to: p.inReplyTo,
      visibility: p.visibility,
      community_ap_id: p.communityApId,
      like_count: p.likeCount,
      reply_count: p.replyCount,
      announce_count: p.announceCount,
      published: p.published,
      liked: likedPostIds.has(p.apId),
      bookmarked: bookmarkedPostIds.has(p.apId),
      reposted: repostedPostIds.has(p.apId)
    };
  });
  return c.json({ posts: result });
});
actors.get("/:identifier", async (c) => {
  const currentActor = c.get("actor");
  const identifier = c.req.param("identifier");
  const baseUrl = c.env.APP_URL;
  const prisma = c.get("prisma");
  let apId;
  if (identifier.startsWith("http")) {
    apId = identifier;
  } else if (identifier.includes("@")) {
    const stripped = identifier.replace(/^@/, "");
    const parts = stripped.split("@");
    const username = parts[0];
    if (!username) {
      return c.json({ error: "Actor not found" }, 404);
    }
    if (parts.length === 1) {
      apId = actorApId(baseUrl, username);
    } else {
      const domain2 = parts.slice(1).join("@");
      if (!domain2) {
        return c.json({ error: "Actor not found" }, 404);
      }
      if (domain2 === getDomain(baseUrl)) {
        apId = actorApId(baseUrl, username);
      } else {
        const cached = await prisma.actorCache.findFirst({
          where: {
            preferredUsername: username,
            apId: { contains: domain2 }
          }
        });
        if (cached) {
          return c.json({
            actor: {
              ap_id: cached.apId,
              preferred_username: cached.preferredUsername,
              name: cached.name,
              summary: cached.summary,
              icon_url: cached.iconUrl,
              username: formatUsername(cached.apId)
            }
          });
        }
        return c.json({ error: "Actor not found" }, 404);
      }
    }
  } else {
    apId = actorApId(baseUrl, identifier);
  }
  const localActor = await prisma.actor.findUnique({
    where: { apId },
    select: {
      apId: true,
      preferredUsername: true,
      name: true,
      summary: true,
      iconUrl: true,
      headerUrl: true,
      role: true,
      followerCount: true,
      followingCount: true,
      postCount: true,
      isPrivate: true,
      createdAt: true
    }
  });
  if (!localActor) {
    const cachedActor = await prisma.actorCache.findUnique({ where: { apId } });
    if (!cachedActor)
      return c.json({ error: "Actor not found" }, 404);
    return c.json({
      actor: {
        ap_id: cachedActor.apId,
        preferred_username: cachedActor.preferredUsername,
        name: cachedActor.name,
        summary: cachedActor.summary,
        icon_url: cachedActor.iconUrl,
        username: formatUsername(cachedActor.apId),
        is_following: false,
        is_followed_by: false
      }
    });
  }
  let is_following = false;
  let is_followed_by = false;
  if (currentActor && currentActor.ap_id !== apId) {
    const followingStatus = await prisma.follow.findFirst({
      where: { followerApId: currentActor.ap_id, followingApId: apId, status: "accepted" }
    });
    is_following = !!followingStatus;
    const followedByStatus = await prisma.follow.findFirst({
      where: { followerApId: apId, followingApId: currentActor.ap_id, status: "accepted" }
    });
    is_followed_by = !!followedByStatus;
  }
  return c.json({
    actor: {
      ap_id: localActor.apId,
      preferred_username: localActor.preferredUsername,
      name: localActor.name,
      summary: localActor.summary,
      icon_url: localActor.iconUrl,
      header_url: localActor.headerUrl,
      role: localActor.role,
      follower_count: localActor.followerCount,
      following_count: localActor.followingCount,
      post_count: localActor.postCount,
      is_private: localActor.isPrivate,
      created_at: localActor.createdAt,
      username: formatUsername(localActor.apId),
      is_following,
      is_followed_by
    }
  });
});
actors.put("/me", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  const updates = {};
  if (body.name !== void 0) {
    const name2 = body.name.trim();
    if (name2.length > MAX_PROFILE_NAME_LENGTH) {
      return c.json({ error: `Name too long (max ${MAX_PROFILE_NAME_LENGTH} chars)` }, 400);
    }
    updates.name = name2;
  }
  if (body.summary !== void 0) {
    const summary = body.summary.trim();
    if (summary.length > MAX_PROFILE_SUMMARY_LENGTH) {
      return c.json({ error: `Summary too long (max ${MAX_PROFILE_SUMMARY_LENGTH} chars)` }, 400);
    }
    updates.summary = summary.length > 0 ? summary : null;
  }
  if (body.icon_url !== void 0) {
    const iconUrl = body.icon_url.trim();
    if (iconUrl.length > MAX_PROFILE_URL_LENGTH) {
      return c.json({ error: `Icon URL too long (max ${MAX_PROFILE_URL_LENGTH} chars)` }, 400);
    }
    if (iconUrl.length > 0 && !isValidHttpUrl(iconUrl)) {
      return c.json({ error: "Invalid icon_url" }, 400);
    }
    updates.iconUrl = iconUrl.length > 0 ? iconUrl : null;
  }
  if (body.header_url !== void 0) {
    const headerUrl = body.header_url.trim();
    if (headerUrl.length > MAX_PROFILE_URL_LENGTH) {
      return c.json({ error: `Header URL too long (max ${MAX_PROFILE_URL_LENGTH} chars)` }, 400);
    }
    if (headerUrl.length > 0 && !isValidHttpUrl(headerUrl)) {
      return c.json({ error: "Invalid header_url" }, 400);
    }
    updates.headerUrl = headerUrl.length > 0 ? headerUrl : null;
  }
  if (body.is_private !== void 0) {
    updates.isPrivate = body.is_private ? 1 : 0;
  }
  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }
  const prisma = c.get("prisma");
  await prisma.actor.update({
    where: { apId: actor.ap_id },
    data: updates
  });
  return c.json({ success: true });
});
actors.get("/:identifier/followers", async (c) => {
  const identifier = c.req.param("identifier");
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith("http") ? identifier : actorApId(baseUrl, identifier);
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = parseInt(c.req.query("offset") || "0");
  const prisma = c.get("prisma");
  const follows = await prisma.follow.findMany({
    where: { followingApId: apId, status: "accepted" },
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: limit
  });
  const total = await prisma.follow.count({
    where: { followingApId: apId, status: "accepted" }
  });
  const followerApIds = follows.map((f) => f.followerApId);
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: followerApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: followerApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true }
    })
  ]);
  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
  const followers = follows.map((f) => {
    const actorInfo = localActorMap.get(f.followerApId) || cachedActorMap.get(f.followerApId);
    return {
      ap_id: f.followerApId,
      username: formatUsername(f.followerApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      summary: actorInfo?.summary || null
    };
  });
  return c.json({
    followers,
    total,
    limit,
    offset,
    has_more: offset + followers.length < total
  });
});
actors.get("/:identifier/following", async (c) => {
  const identifier = c.req.param("identifier");
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith("http") ? identifier : actorApId(baseUrl, identifier);
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = parseInt(c.req.query("offset") || "0");
  const prisma = c.get("prisma");
  const follows = await prisma.follow.findMany({
    where: { followerApId: apId, status: "accepted" },
    orderBy: { createdAt: "desc" },
    skip: offset,
    take: limit
  });
  const total = await prisma.follow.count({
    where: { followerApId: apId, status: "accepted" }
  });
  const followingApIds = follows.map((f) => f.followingApId);
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: followingApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: followingApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true }
    })
  ]);
  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
  const following = follows.map((f) => {
    const actorInfo = localActorMap.get(f.followingApId) || cachedActorMap.get(f.followingApId);
    return {
      ap_id: f.followingApId,
      username: formatUsername(f.followingApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      summary: actorInfo?.summary || null
    };
  });
  return c.json({
    following,
    total,
    limit,
    offset,
    has_more: offset + following.length < total
  });
});
var actors_default = actors;

// src/backend/routes/follow.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var REMOTE_FETCH_TIMEOUT_MS = 1e4;
var follow = new Hono2();
follow.post("/", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (!body.target_ap_id)
    return c.json({ error: "target_ap_id required" }, 400);
  if (body.target_ap_id === actor.ap_id)
    return c.json({ error: "Cannot follow yourself" }, 400);
  const baseUrl = c.env.APP_URL;
  const targetApId = body.target_ap_id;
  const prisma = c.get("prisma");
  const existing = await prisma.follow.findUnique({
    where: {
      followerApId_followingApId: { followerApId: actor.ap_id, followingApId: targetApId }
    }
  });
  if (existing)
    return c.json({ error: "Already following or pending" }, 400);
  const isLocalTarget = isLocal(targetApId, baseUrl);
  if (isLocalTarget) {
    const target = await prisma.actor.findUnique({
      where: { apId: targetApId },
      select: { isPrivate: true }
    });
    if (!target)
      return c.json({ error: "Target actor not found" }, 404);
    const status = target.isPrivate ? "pending" : "accepted";
    const activityId = activityApId(baseUrl, generateId());
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      await prisma.$transaction(async (tx) => {
        const existingInTx = await tx.follow.findUnique({
          where: {
            followerApId_followingApId: { followerApId: actor.ap_id, followingApId: targetApId }
          }
        });
        if (existingInTx) {
          throw new Error("ALREADY_FOLLOWING");
        }
        await tx.follow.create({
          data: {
            followerApId: actor.ap_id,
            followingApId: targetApId,
            status,
            activityApId: activityId,
            acceptedAt: status === "accepted" ? now : null
          }
        });
        if (status === "accepted") {
          await tx.actor.update({
            where: { apId: actor.ap_id },
            data: { followingCount: { increment: 1 } }
          });
          await tx.actor.update({
            where: { apId: targetApId },
            data: { followerCount: { increment: 1 } }
          });
        }
        await tx.activity.create({
          data: {
            apId: activityId,
            type: "Follow",
            actorApId: actor.ap_id,
            objectApId: targetApId,
            rawJson: JSON.stringify({
              "@context": "https://www.w3.org/ns/activitystreams",
              id: activityId,
              type: "Follow",
              actor: actor.ap_id,
              object: targetApId,
              published: now
            }),
            direction: "local"
          }
        });
        await tx.inbox.create({
          data: {
            actorApId: targetApId,
            activityApId: activityId,
            read: 0
          }
        });
      });
    } catch (e) {
      if (e instanceof Error && e.message === "ALREADY_FOLLOWING") {
        return c.json({ error: "Already following or pending" }, 400);
      }
      throw e;
    }
    return c.json({ success: true, status });
  } else {
    let cachedActor = await prisma.actorCache.findUnique({
      where: { apId: targetApId }
    });
    if (!cachedActor) {
      try {
        if (!isSafeRemoteUrl(targetApId)) {
          return c.json({ error: "Invalid target_ap_id" }, 400);
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
        let res;
        try {
          res = await fetch(targetApId, {
            headers: { "Accept": "application/activity+json, application/ld+json" },
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!res.ok)
          return c.json({ error: "Could not fetch remote actor" }, 400);
        const actorData = await res.json();
        if (!actorData?.id || !actorData?.inbox || !isSafeRemoteUrl(actorData.id) || !isSafeRemoteUrl(actorData.inbox)) {
          return c.json({ error: "Invalid remote actor data" }, 400);
        }
        cachedActor = await prisma.actorCache.create({
          data: {
            apId: actorData.id,
            type: actorData.type || "Person",
            preferredUsername: actorData.preferredUsername || null,
            name: actorData.name || null,
            summary: actorData.summary || null,
            iconUrl: actorData.icon?.url || null,
            inbox: actorData.inbox,
            outbox: actorData.outbox || null,
            publicKeyId: actorData.publicKey?.id || null,
            publicKeyPem: actorData.publicKey?.publicKeyPem || null,
            rawJson: JSON.stringify(actorData)
          }
        });
      } catch (e) {
        return c.json({ error: "Failed to fetch remote actor" }, 400);
      }
    }
    if (!cachedActor?.inbox || !isSafeRemoteUrl(cachedActor.inbox)) {
      return c.json({ error: "Invalid inbox URL" }, 400);
    }
    const activityId = activityApId(baseUrl, generateId());
    await prisma.follow.create({
      data: {
        followerApId: actor.ap_id,
        followingApId: targetApId,
        status: "pending",
        activityApId: activityId
      }
    });
    const followActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityId,
      type: "Follow",
      actor: actor.ap_id,
      object: targetApId,
      published: (/* @__PURE__ */ new Date()).toISOString()
    };
    const keyId = `${actor.ap_id}#main-key`;
    const headers = await signRequest(actor.private_key_pem, keyId, "POST", cachedActor.inbox, JSON.stringify(followActivity));
    try {
      const deliveryController = new AbortController();
      const deliveryTimeoutId = setTimeout(() => deliveryController.abort(), REMOTE_FETCH_TIMEOUT_MS);
      try {
        await fetch(cachedActor.inbox, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/activity+json"
          },
          body: JSON.stringify(followActivity),
          signal: deliveryController.signal
        });
      } finally {
        clearTimeout(deliveryTimeoutId);
      }
    } catch (e) {
      console.error("Failed to send Follow activity:", e);
    }
    await prisma.activity.create({
      data: {
        apId: activityId,
        type: "Follow",
        actorApId: actor.ap_id,
        objectApId: targetApId,
        rawJson: JSON.stringify(followActivity),
        direction: "outbound"
      }
    });
    return c.json({ success: true, status: "pending" });
  }
});
follow.delete("/", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (!body.target_ap_id)
    return c.json({ error: "target_ap_id required" }, 400);
  const baseUrl = c.env.APP_URL;
  const targetApId = body.target_ap_id;
  const prisma = c.get("prisma");
  const existingFollow = await prisma.follow.findUnique({
    where: {
      followerApId_followingApId: { followerApId: actor.ap_id, followingApId: targetApId }
    }
  });
  if (!existingFollow)
    return c.json({ error: "Not following" }, 400);
  await prisma.follow.delete({
    where: {
      followerApId_followingApId: { followerApId: actor.ap_id, followingApId: targetApId }
    }
  });
  if (existingFollow.status === "accepted") {
    await prisma.actor.update({
      where: { apId: actor.ap_id },
      data: { followingCount: { decrement: 1 } }
    }).catch(() => {
    });
    if (isLocal(targetApId, baseUrl)) {
      await prisma.actor.update({
        where: { apId: targetApId },
        data: { followerCount: { decrement: 1 } }
      }).catch(() => {
      });
    }
  }
  if (!isLocal(targetApId, baseUrl)) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: targetApId },
      select: { inbox: true }
    });
    if (cachedActor?.inbox) {
      if (isSafeRemoteUrl(cachedActor.inbox)) {
        const activityId = activityApId(baseUrl, generateId());
        const undoActivity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: activityId,
          type: "Undo",
          actor: actor.ap_id,
          published: (/* @__PURE__ */ new Date()).toISOString(),
          object: {
            type: "Follow",
            actor: actor.ap_id,
            object: targetApId
          }
        };
        const keyId = `${actor.ap_id}#main-key`;
        const headers = await signRequest(actor.private_key_pem, keyId, "POST", cachedActor.inbox, JSON.stringify(undoActivity));
        try {
          const undoController = new AbortController();
          const undoTimeoutId = setTimeout(() => undoController.abort(), REMOTE_FETCH_TIMEOUT_MS);
          try {
            await fetch(cachedActor.inbox, {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/activity+json" },
              body: JSON.stringify(undoActivity),
              signal: undoController.signal
            });
          } finally {
            clearTimeout(undoTimeoutId);
          }
        } catch (e) {
          console.error("Failed to send Undo Follow:", e);
        }
        await prisma.activity.create({
          data: {
            apId: activityId,
            type: "Undo",
            actorApId: actor.ap_id,
            objectApId: targetApId,
            rawJson: JSON.stringify(undoActivity),
            direction: "outbound"
          }
        });
      } else {
        console.warn(`[Follow] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
      }
    }
  }
  return c.json({ success: true });
});
follow.post("/accept", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (!body.requester_ap_id)
    return c.json({ error: "requester_ap_id required" }, 400);
  const prisma = c.get("prisma");
  let pendingFollow;
  try {
    pendingFollow = await prisma.$transaction(async (tx) => {
      const follow2 = await tx.follow.findFirst({
        where: {
          followerApId: body.requester_ap_id,
          followingApId: actor.ap_id,
          status: "pending"
        }
      });
      if (!follow2)
        return null;
      await tx.follow.update({
        where: {
          followerApId_followingApId: { followerApId: body.requester_ap_id, followingApId: actor.ap_id }
        },
        data: { status: "accepted", acceptedAt: (/* @__PURE__ */ new Date()).toISOString() }
      });
      await tx.actor.update({
        where: { apId: actor.ap_id },
        data: { followerCount: { increment: 1 } }
      });
      if (isLocal(body.requester_ap_id, c.env.APP_URL)) {
        await tx.actor.update({
          where: { apId: body.requester_ap_id },
          data: { followingCount: { increment: 1 } }
        });
      }
      return follow2;
    });
  } catch (e) {
    console.error("[Follow] Transaction error in accept:", e);
    return c.json({ error: "Internal error" }, 500);
  }
  if (!pendingFollow)
    return c.json({ error: "No pending follow request" }, 404);
  if (!isLocal(body.requester_ap_id, c.env.APP_URL)) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: body.requester_ap_id },
      select: { inbox: true }
    });
    if (cachedActor?.inbox) {
      const baseUrl = c.env.APP_URL;
      const activityId = activityApId(baseUrl, generateId());
      const acceptActivity = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: activityId,
        type: "Accept",
        actor: actor.ap_id,
        object: pendingFollow.activityApId,
        published: (/* @__PURE__ */ new Date()).toISOString()
      };
      const keyId = `${actor.ap_id}#main-key`;
      if (!isSafeRemoteUrl(cachedActor.inbox)) {
        console.warn(`[Follow] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
        return c.json({ success: true });
      }
      const headers = await signRequest(actor.private_key_pem, keyId, "POST", cachedActor.inbox, JSON.stringify(acceptActivity));
      try {
        const acceptController = new AbortController();
        const acceptTimeoutId = setTimeout(() => acceptController.abort(), REMOTE_FETCH_TIMEOUT_MS);
        try {
          await fetch(cachedActor.inbox, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/activity+json" },
            body: JSON.stringify(acceptActivity),
            signal: acceptController.signal
          });
        } finally {
          clearTimeout(acceptTimeoutId);
        }
      } catch (e) {
        console.error("Failed to send Accept:", e);
      }
      await prisma.activity.create({
        data: {
          apId: activityId,
          type: "Accept",
          actorApId: actor.ap_id,
          objectApId: pendingFollow.activityApId || void 0,
          rawJson: JSON.stringify(acceptActivity),
          direction: "outbound"
        }
      });
    }
  }
  return c.json({ success: true });
});
var MAX_BATCH_ACCEPT_SIZE = 100;
follow.post("/accept/batch", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (!body.requester_ap_ids || !Array.isArray(body.requester_ap_ids) || body.requester_ap_ids.length === 0) {
    return c.json({ error: "requester_ap_ids array required" }, 400);
  }
  if (body.requester_ap_ids.length > MAX_BATCH_ACCEPT_SIZE) {
    return c.json({ error: `Batch size exceeds maximum of ${MAX_BATCH_ACCEPT_SIZE}` }, 400);
  }
  const baseUrl = c.env.APP_URL;
  const prisma = c.get("prisma");
  const results = [];
  const pendingFollows = await prisma.follow.findMany({
    where: {
      followerApId: { in: body.requester_ap_ids },
      followingApId: actor.ap_id,
      status: "pending"
    }
  });
  const pendingFollowMap = new Map(pendingFollows.map((f) => [f.followerApId, f]));
  const remoteRequesterIds = body.requester_ap_ids.filter((id) => !isLocal(id, baseUrl));
  const cachedActors = remoteRequesterIds.length > 0 ? await prisma.actorCache.findMany({
    where: { apId: { in: remoteRequesterIds } },
    select: { apId: true, inbox: true }
  }) : [];
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
  let followerCountIncrement = 0;
  const localFollowerIds = [];
  const activitiesToCreate = [];
  for (const requesterApId of body.requester_ap_ids) {
    try {
      const pendingFollow = pendingFollowMap.get(requesterApId);
      if (!pendingFollow) {
        results.push({ ap_id: requesterApId, success: false, error: "No pending follow request" });
        continue;
      }
      await prisma.follow.update({
        where: {
          followerApId_followingApId: { followerApId: requesterApId, followingApId: actor.ap_id }
        },
        data: { status: "accepted", acceptedAt: (/* @__PURE__ */ new Date()).toISOString() }
      });
      followerCountIncrement++;
      if (isLocal(requesterApId, baseUrl)) {
        localFollowerIds.push(requesterApId);
      }
      if (!isLocal(requesterApId, baseUrl)) {
        const cachedActor = cachedActorMap.get(requesterApId);
        if (cachedActor?.inbox) {
          const activityId = activityApId(baseUrl, generateId());
          const acceptActivity = {
            "@context": "https://www.w3.org/ns/activitystreams",
            id: activityId,
            type: "Accept",
            actor: actor.ap_id,
            object: pendingFollow.activityApId,
            published: (/* @__PURE__ */ new Date()).toISOString()
          };
          const keyId = `${actor.ap_id}#main-key`;
          if (!isSafeRemoteUrl(cachedActor.inbox)) {
            console.warn(`[Follow] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
          } else {
            const headers = await signRequest(actor.private_key_pem, keyId, "POST", cachedActor.inbox, JSON.stringify(acceptActivity));
            fetch(cachedActor.inbox, {
              method: "POST",
              headers: { ...headers, "Content-Type": "application/activity+json" },
              body: JSON.stringify(acceptActivity)
            }).catch((err) => {
              console.error(`[Follow] Batch Accept delivery failed to ${cachedActor.inbox}:`, err);
            });
            activitiesToCreate.push({
              apId: activityId,
              type: "Accept",
              actorApId: actor.ap_id,
              objectApId: pendingFollow.activityApId || void 0,
              rawJson: JSON.stringify(acceptActivity),
              direction: "outbound"
            });
          }
        }
      }
      results.push({ ap_id: requesterApId, success: true });
    } catch (e) {
      results.push({ ap_id: requesterApId, success: false, error: "Internal error" });
    }
  }
  if (followerCountIncrement > 0) {
    await prisma.actor.update({
      where: { apId: actor.ap_id },
      data: { followerCount: { increment: followerCountIncrement } }
    });
  }
  if (localFollowerIds.length > 0) {
    await prisma.actor.updateMany({
      where: { apId: { in: localFollowerIds } },
      data: { followingCount: { increment: 1 } }
    });
  }
  if (activitiesToCreate.length > 0) {
    await prisma.activity.createMany({
      data: activitiesToCreate
    });
  }
  return c.json({ results, accepted_count: results.filter((r) => r.success).length });
});
follow.post("/reject", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (!body.requester_ap_id)
    return c.json({ error: "requester_ap_id required" }, 400);
  const prisma = c.get("prisma");
  const pendingFollow = await prisma.follow.findFirst({
    where: {
      followerApId: body.requester_ap_id,
      followingApId: actor.ap_id,
      status: "pending"
    }
  });
  if (!pendingFollow)
    return c.json({ error: "No pending follow request" }, 404);
  await prisma.follow.update({
    where: {
      followerApId_followingApId: { followerApId: body.requester_ap_id, followingApId: actor.ap_id }
    },
    data: { status: "rejected" }
  });
  if (pendingFollow.activityApId) {
    await prisma.inbox.updateMany({
      where: { actorApId: actor.ap_id, activityApId: pendingFollow.activityApId },
      data: { read: 1 }
    });
  }
  if (!isLocal(body.requester_ap_id, c.env.APP_URL)) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: body.requester_ap_id },
      select: { inbox: true }
    });
    if (cachedActor?.inbox) {
      if (!isSafeRemoteUrl(cachedActor.inbox)) {
        console.warn(`[Follow] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
        return c.json({ success: true });
      }
      const baseUrl = c.env.APP_URL;
      const activityId = activityApId(baseUrl, generateId());
      const rejectActivity = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: activityId,
        type: "Reject",
        actor: actor.ap_id,
        object: pendingFollow.activityApId,
        published: (/* @__PURE__ */ new Date()).toISOString()
      };
      const keyId = `${actor.ap_id}#main-key`;
      const headers = await signRequest(actor.private_key_pem, keyId, "POST", cachedActor.inbox, JSON.stringify(rejectActivity));
      try {
        const rejectController = new AbortController();
        const rejectTimeoutId = setTimeout(() => rejectController.abort(), REMOTE_FETCH_TIMEOUT_MS);
        try {
          await fetch(cachedActor.inbox, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/activity+json" },
            body: JSON.stringify(rejectActivity),
            signal: rejectController.signal
          });
        } finally {
          clearTimeout(rejectTimeoutId);
        }
      } catch (e) {
        console.error("Failed to send Reject:", e);
      }
      await prisma.activity.create({
        data: {
          apId: activityId,
          type: "Reject",
          actorApId: actor.ap_id,
          objectApId: pendingFollow.activityApId || void 0,
          rawJson: JSON.stringify(rejectActivity),
          direction: "outbound"
        }
      });
    }
  }
  return c.json({ success: true });
});
follow.get("/requests", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);
  const offset = parseInt(c.req.query("offset") || "0");
  const follows = await prisma.follow.findMany({
    where: { followingApId: actor.ap_id, status: "pending" },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset
  });
  const followerApIds = follows.map((f) => f.followerApId);
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: followerApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: followerApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    })
  ]);
  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
  const result = follows.map((f) => {
    const actorInfo = localActorMap.get(f.followerApId) || cachedActorMap.get(f.followerApId);
    return {
      ap_id: f.followerApId,
      username: formatUsername(f.followerApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      created_at: f.createdAt
    };
  });
  return c.json({ requests: result });
});
var follow_default = follow;

// src/backend/routes/timeline.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var timeline = new Hono2();
async function batchGetAuthorInfo(prisma, apIds) {
  if (apIds.length === 0) {
    return /* @__PURE__ */ new Map();
  }
  const uniqueApIds = [...new Set(apIds)];
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: uniqueApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: uniqueApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    })
  ]);
  const result = /* @__PURE__ */ new Map();
  for (const a of cachedActors) {
    result.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
  }
  for (const a of localActors) {
    result.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
  }
  return result;
}
__name(batchGetAuthorInfo, "batchGetAuthorInfo");
async function batchGetInteractionStatus(prisma, viewerApId, objectApIds) {
  if (!viewerApId || objectApIds.length === 0) {
    return { likedSet: /* @__PURE__ */ new Set(), bookmarkedSet: /* @__PURE__ */ new Set(), repostedSet: /* @__PURE__ */ new Set() };
  }
  const [likes, bookmarks, announces] = await Promise.all([
    prisma.like.findMany({
      where: { actorApId: viewerApId, objectApId: { in: objectApIds } },
      select: { objectApId: true }
    }),
    prisma.bookmark.findMany({
      where: { actorApId: viewerApId, objectApId: { in: objectApIds } },
      select: { objectApId: true }
    }),
    prisma.announce.findMany({
      where: { actorApId: viewerApId, objectApId: { in: objectApIds } },
      select: { objectApId: true }
    })
  ]);
  return {
    likedSet: new Set(likes.map((l) => l.objectApId)),
    bookmarkedSet: new Set(bookmarks.map((b) => b.objectApId)),
    repostedSet: new Set(announces.map((a) => a.objectApId))
  };
}
__name(batchGetInteractionStatus, "batchGetInteractionStatus");
async function getBlockedAndMutedUsers(prisma, viewerApId) {
  if (!viewerApId) {
    return { blockedApIds: [], mutedApIds: [] };
  }
  const [blocks, mutes] = await Promise.all([
    prisma.block.findMany({
      where: { blockerApId: viewerApId },
      select: { blockedApId: true }
    }),
    prisma.mute.findMany({
      where: { muterApId: viewerApId },
      select: { mutedApId: true }
    })
  ]);
  return {
    blockedApIds: blocks.map((b) => b.blockedApId),
    mutedApIds: mutes.map((m) => m.mutedApId)
  };
}
__name(getBlockedAndMutedUsers, "getBlockedAndMutedUsers");
timeline.get("/", withCache({
  ttl: CacheTTL.PUBLIC_TIMELINE,
  cacheTag: CacheTags.TIMELINE,
  queryParamsToInclude: ["limit", "offset", "before", "community"]
}), async (c) => {
  const actor = c.get("actor");
  const prisma = c.get("prisma");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");
  const before = c.req.query("before");
  const communityApId2 = c.req.query("community");
  const viewerApId = actor?.ap_id || "";
  const { blockedApIds, mutedApIds } = await getBlockedAndMutedUsers(prisma, viewerApId);
  const excludedApIds = Array.from(/* @__PURE__ */ new Set([...blockedApIds, ...mutedApIds]));
  const posts4 = await prisma.object.findMany({
    where: {
      type: "Note",
      visibility: "public",
      inReplyTo: null,
      audienceJson: "[]",
      ...excludedApIds.length > 0 ? { attributedTo: { notIn: excludedApIds } } : {},
      ...communityApId2 ? { communityApId: communityApId2 } : {},
      ...before ? { published: { lt: before } } : {}
    },
    orderBy: { published: "desc" },
    take: limit + 1,
    skip: offset
  });
  const has_more = posts4.length > limit;
  const actualResults = has_more ? posts4.slice(0, limit) : posts4;
  const authorApIds = actualResults.map((p) => p.attributedTo);
  const postApIds = actualResults.map((p) => p.apId);
  const [authorMap, interactions] = await Promise.all([
    batchGetAuthorInfo(prisma, authorApIds),
    batchGetInteractionStatus(prisma, viewerApId, postApIds)
  ]);
  const result = actualResults.map((p) => {
    const author = authorMap.get(p.attributedTo) || { preferredUsername: null, name: null, iconUrl: null };
    return {
      ap_id: p.apId,
      type: p.type,
      author: {
        ap_id: p.attributedTo,
        username: formatUsername(p.attributedTo),
        preferred_username: author.preferredUsername,
        name: author.name,
        icon_url: author.iconUrl
      },
      content: p.content,
      summary: p.summary,
      attachments: safeJsonParse(p.attachmentsJson, []),
      in_reply_to: p.inReplyTo,
      visibility: p.visibility,
      community_ap_id: p.communityApId,
      like_count: p.likeCount,
      reply_count: p.replyCount,
      announce_count: p.announceCount,
      published: p.published,
      liked: interactions.likedSet.has(p.apId),
      bookmarked: interactions.bookmarkedSet.has(p.apId),
      reposted: interactions.repostedSet.has(p.apId)
    };
  });
  return c.json({ posts: result, limit, offset, has_more });
});
timeline.get("/following", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");
  const before = c.req.query("before");
  const viewerApId = actor.ap_id;
  const { blockedApIds, mutedApIds } = await getBlockedAndMutedUsers(prisma, viewerApId);
  const excludedApIds = Array.from(/* @__PURE__ */ new Set([...blockedApIds, ...mutedApIds]));
  const follows = await prisma.follow.findMany({
    where: { followerApId: viewerApId, status: "accepted" },
    select: { followingApId: true }
  });
  const followingApIds = follows.map((f) => f.followingApId);
  const allowedAuthors = [viewerApId, ...followingApIds];
  const posts4 = await prisma.object.findMany({
    where: {
      type: "Note",
      inReplyTo: null,
      audienceJson: "[]",
      attributedTo: { in: allowedAuthors },
      ...excludedApIds.length > 0 ? { NOT: { attributedTo: { in: excludedApIds } } } : {},
      ...before ? { published: { lt: before } } : {},
      AND: [
        {
          OR: [
            // Own posts (all except direct)
            { attributedTo: viewerApId },
            // Followed users' posts with appropriate visibility
            {
              AND: [
                { attributedTo: { not: viewerApId } },
                { visibility: { in: ["public", "unlisted", "followers"] } }
              ]
            }
          ]
        }
      ]
    },
    orderBy: { published: "desc" },
    take: limit + 1,
    skip: offset
  });
  const has_more = posts4.length > limit;
  const actualResults = has_more ? posts4.slice(0, limit) : posts4;
  const authorApIds = actualResults.map((p) => p.attributedTo);
  const postApIds = actualResults.map((p) => p.apId);
  const [authorMap, interactions] = await Promise.all([
    batchGetAuthorInfo(prisma, authorApIds),
    batchGetInteractionStatus(prisma, viewerApId, postApIds)
  ]);
  const result = actualResults.map((p) => {
    const author = authorMap.get(p.attributedTo) || { preferredUsername: null, name: null, iconUrl: null };
    return {
      ap_id: p.apId,
      type: p.type,
      author: {
        ap_id: p.attributedTo,
        username: formatUsername(p.attributedTo),
        preferred_username: author.preferredUsername,
        name: author.name,
        icon_url: author.iconUrl
      },
      content: p.content,
      summary: p.summary,
      attachments: safeJsonParse(p.attachmentsJson, []),
      in_reply_to: p.inReplyTo,
      visibility: p.visibility,
      like_count: p.likeCount,
      reply_count: p.replyCount,
      announce_count: p.announceCount,
      published: p.published,
      liked: interactions.likedSet.has(p.apId),
      bookmarked: interactions.bookmarkedSet.has(p.apId),
      reposted: interactions.repostedSet.has(p.apId)
    };
  });
  return c.json({ posts: result, limit, offset, has_more });
});
var timeline_default = timeline;

// src/backend/routes/posts.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/posts/base.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/posts/utils.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var MAX_POST_CONTENT_LENGTH = 5e3;
var MAX_POST_SUMMARY_LENGTH = 500;
var MAX_POSTS_PAGE_LIMIT = 100;
function extractMentions(content) {
  const mentionRegex = /@([a-zA-Z0-9_]+(?:@[a-zA-Z0-9.-]+)?)/g;
  const mentions = [];
  let match2;
  while ((match2 = mentionRegex.exec(content)) !== null) {
    mentions.push(match2[1]);
  }
  return [...new Set(mentions)];
}
__name(extractMentions, "extractMentions");
function formatPost(p, currentActorApId) {
  return {
    ap_id: p.ap_id,
    type: p.type,
    author: {
      ap_id: p.attributed_to,
      username: formatUsername(p.attributed_to),
      preferred_username: p.author_username,
      name: p.author_name,
      icon_url: p.author_icon_url
    },
    content: p.content,
    summary: p.summary,
    attachments: JSON.parse(p.attachments_json || "[]"),
    in_reply_to: p.in_reply_to,
    visibility: p.visibility,
    community_ap_id: p.community_ap_id,
    like_count: p.like_count,
    reply_count: p.reply_count,
    announce_count: p.announce_count,
    published: p.published,
    liked: currentActorApId ? !!p.liked : false
  };
}
__name(formatPost, "formatPost");
function normalizeVisibility(value) {
  if (value === "private" || value === "followers_only")
    return "followers";
  if (value === "public" || value === "unlisted" || value === "followers" || value === "direct")
    return value;
  return "public";
}
__name(normalizeVisibility, "normalizeVisibility");

// src/backend/lib/activitypub-helpers.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var DELIVERY_RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1e3,
  // 1 second initial delay
  maxDelayMs: 3e4
  // 30 seconds max delay
};
var DELIVERY_CONCURRENCY_LIMIT = 10;
function calculateBackoffDelay(attempt) {
  const delay2 = DELIVERY_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay2, DELIVERY_RETRY_CONFIG.maxDelayMs);
}
__name(calculateBackoffDelay, "calculateBackoffDelay");
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
__name(sleep, "sleep");
async function deliverActivity(prisma, senderActor, recipientApId, activity) {
  try {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: recipientApId },
      select: { inbox: true }
    });
    if (!cachedActor?.inbox) {
      console.warn(`[deliverActivity] No inbox found for ${recipientApId}`);
      return false;
    }
    if (!isSafeRemoteUrl(cachedActor.inbox)) {
      console.warn(`[deliverActivity] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
      return false;
    }
    const keyId = `${senderActor.apId}#main-key`;
    const body = JSON.stringify(activity);
    let lastError = null;
    for (let attempt = 0; attempt < DELIVERY_RETRY_CONFIG.maxAttempts; attempt++) {
      try {
        const headers = await signRequest(senderActor.privateKeyPem, keyId, "POST", cachedActor.inbox, body);
        const response = await fetchWithTimeout(cachedActor.inbox, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/activity+json" },
          body,
          timeout: 15e3
          // 15 second timeout for ActivityPub federation
        });
        if (response.ok) {
          return true;
        }
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          console.warn(`[deliverActivity] Delivery failed with non-retryable status ${response.status} to ${recipientApId}`);
          return false;
        }
        console.warn(`[deliverActivity] Delivery attempt ${attempt + 1}/${DELIVERY_RETRY_CONFIG.maxAttempts} failed with status ${response.status} to ${recipientApId}`);
        lastError = new Error(`HTTP ${response.status}`);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        console.warn(`[deliverActivity] Delivery attempt ${attempt + 1}/${DELIVERY_RETRY_CONFIG.maxAttempts} failed to ${recipientApId}:`, e);
      }
      if (attempt < DELIVERY_RETRY_CONFIG.maxAttempts - 1) {
        const delay2 = calculateBackoffDelay(attempt);
        await sleep(delay2);
      }
    }
    console.error(`[deliverActivity] All ${DELIVERY_RETRY_CONFIG.maxAttempts} delivery attempts failed to ${recipientApId}:`, lastError);
    return false;
  } catch (e) {
    console.error(`[deliverActivity] Failed to deliver to ${recipientApId}:`, e);
    return false;
  }
}
__name(deliverActivity, "deliverActivity");
function safeUrlJoin(baseUrl, path) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  try {
    const base = new URL(baseUrl);
    const normalizedBase = base.origin + base.pathname.replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : "/" + path;
    return normalizedBase + normalizedPath;
  } catch (error3) {
    const cleanBase = baseUrl.replace(/\/+$/, "");
    const cleanPath = path.startsWith("/") ? path : "/" + path;
    return cleanBase + cleanPath;
  }
}
__name(safeUrlJoin, "safeUrlJoin");
function storyToActivityPub(story, actor, baseUrl) {
  const attachmentUrl = safeUrlJoin(baseUrl, story.attachment.url);
  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        "story": "https://yurucommu.com/ns/story#",
        "Story": "story:Story",
        "displayDuration": "story:displayDuration",
        "overlays": { "@id": "story:overlays", "@container": "@list" },
        "position": "story:position"
      }
    ],
    "id": story.apId,
    "type": ["Story", "Note"],
    "attributedTo": actor.ap_id,
    "published": story.published,
    "endTime": story.endTime,
    "to": [`${actor.ap_id}/followers`],
    "attachment": [{
      "type": story.attachment.type,
      "mediaType": story.attachment.mediaType,
      "url": attachmentUrl
    }],
    "displayDuration": story.displayDuration,
    ...story.overlays && story.overlays.length > 0 ? { "overlays": story.overlays } : {}
  };
}
__name(storyToActivityPub, "storyToActivityPub");
async function deliverToFollowers(activity, actor, env2, prisma) {
  const baseUrl = env2.APP_URL;
  const followers = await prisma.follow.findMany({
    where: {
      followingApId: actor.ap_id,
      status: "accepted"
    },
    select: {
      followerApId: true
    },
    distinct: ["followerApId"]
  });
  const remoteFollowers = followers.filter(
    (f) => !isLocal(f.followerApId, baseUrl)
  );
  const senderActor = {
    apId: actor.ap_id,
    privateKeyPem: actor.private_key_pem
  };
  await deliverActivityToMany(prisma, senderActor, remoteFollowers.map((f) => f.followerApId), activity);
}
__name(deliverToFollowers, "deliverToFollowers");
async function deliverActivityToMany(prisma, senderActor, recipientApIds, activity) {
  if (recipientApIds.length === 0) {
    return { successes: 0, failures: 0 };
  }
  let successes = 0;
  let failures = 0;
  for (let i = 0; i < recipientApIds.length; i += DELIVERY_CONCURRENCY_LIMIT) {
    const batch = recipientApIds.slice(i, i + DELIVERY_CONCURRENCY_LIMIT);
    const results = await Promise.allSettled(
      batch.map((recipientApId) => deliverActivity(prisma, senderActor, recipientApId, activity))
    );
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        successes++;
      } else {
        failures++;
      }
    }
  }
  return { successes, failures };
}
__name(deliverActivityToMany, "deliverActivityToMany");
async function sendCreateStoryActivity(story, actor, env2, prisma) {
  const baseUrl = env2.APP_URL;
  const storyObject = storyToActivityPub(story, actor, baseUrl);
  const activityId = activityApId(baseUrl, generateId());
  const activity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": activityId,
    "type": "Create",
    "actor": actor.ap_id,
    "published": story.published,
    "to": [`${actor.ap_id}/followers`],
    "object": storyObject
  };
  await deliverToFollowers(activity, actor, env2, prisma);
  await prisma.activity.create({
    data: {
      apId: activityId,
      type: "Create",
      actorApId: actor.ap_id,
      objectApId: story.apId,
      rawJson: JSON.stringify(activity),
      direction: "outbound"
    }
  });
}
__name(sendCreateStoryActivity, "sendCreateStoryActivity");
async function sendDeleteStoryActivity(storyApId, actor, env2, prisma) {
  const baseUrl = env2.APP_URL;
  const activityId = activityApId(baseUrl, generateId());
  const activity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    "id": activityId,
    "type": "Delete",
    "actor": actor.ap_id,
    "to": ["https://www.w3.org/ns/activitystreams#Public"],
    "object": storyApId
  };
  await deliverToFollowers(activity, actor, env2, prisma);
  await prisma.activity.create({
    data: {
      apId: activityId,
      type: "Delete",
      actorApId: actor.ap_id,
      objectApId: storyApId,
      rawJson: JSON.stringify(activity),
      direction: "outbound"
    }
  });
}
__name(sendDeleteStoryActivity, "sendDeleteStoryActivity");

// src/backend/routes/posts/base.ts
var posts = new Hono2();
posts.post("/", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  const content = body.content?.trim();
  const summary = body.summary?.trim();
  if (!content) {
    return c.json({ error: "Content required" }, 400);
  }
  if (content.length > MAX_POST_CONTENT_LENGTH) {
    return c.json({ error: `Content too long (max ${MAX_POST_CONTENT_LENGTH} chars)` }, 400);
  }
  if (summary && summary.length > MAX_POST_SUMMARY_LENGTH) {
    return c.json({ error: `Summary too long (max ${MAX_POST_SUMMARY_LENGTH} chars)` }, 400);
  }
  const visibility = normalizeVisibility(body.visibility);
  let communityId = null;
  if (body.community_ap_id) {
    const community = await prisma.community.findFirst({
      where: {
        OR: [
          { apId: body.community_ap_id },
          { preferredUsername: body.community_ap_id }
        ]
      },
      select: { apId: true, postPolicy: true }
    });
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    communityId = community.apId;
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      },
      select: { role: true }
    });
    const policy = community.postPolicy || "members";
    const role = membership?.role;
    const isManager = role === "owner" || role === "moderator";
    if (policy !== "anyone" && !membership) {
      return c.json({ error: "Not a community member" }, 403);
    }
    if (policy === "mods" && !isManager) {
      return c.json({ error: "Moderator role required" }, 403);
    }
    if (policy === "owners" && role !== "owner") {
      return c.json({ error: "Owner role required" }, 403);
    }
  }
  const baseUrl = c.env.APP_URL;
  const postId = generateId();
  const apId = objectApId(baseUrl, postId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await prisma.object.create({
      data: {
        apId,
        type: "Note",
        attributedTo: actor.ap_id,
        content,
        summary: summary || null,
        attachmentsJson: JSON.stringify(body.attachments || []),
        inReplyTo: body.in_reply_to || null,
        visibility,
        communityApId: communityId,
        published: now,
        isLocal: 1
      }
    });
  } catch (e) {
    console.error("[Posts] Failed to insert post:", e);
    return c.json({ error: "Failed to create post" }, 500);
  }
  try {
    await prisma.actor.update({
      where: { apId: actor.ap_id },
      data: { postCount: { increment: 1 } }
    });
  } catch (e) {
    console.error("[Posts] Failed to update post count:", e);
  }
  if (body.in_reply_to) {
    try {
      await prisma.object.update({
        where: { apId: body.in_reply_to },
        data: { replyCount: { increment: 1 } }
      });
    } catch (e) {
      console.error("[Posts] Failed to update reply count:", e);
    }
    try {
      const parentPost = await prisma.object.findUnique({
        where: { apId: body.in_reply_to },
        select: { attributedTo: true }
      });
      if (parentPost && parentPost.attributedTo !== actor.ap_id && isLocal(parentPost.attributedTo, baseUrl)) {
        const replyActivityId = activityApId(baseUrl, generateId());
        await prisma.activity.create({
          data: {
            apId: replyActivityId,
            type: "Create",
            actorApId: actor.ap_id,
            objectApId: apId,
            rawJson: JSON.stringify({
              "@context": "https://www.w3.org/ns/activitystreams",
              id: replyActivityId,
              type: "Create",
              actor: actor.ap_id,
              object: apId
            }),
            createdAt: now
          }
        });
        await prisma.inbox.create({
          data: {
            actorApId: parentPost.attributedTo,
            activityApId: replyActivityId,
            read: 0,
            createdAt: now
          }
        });
      }
    } catch (e) {
      console.error("[Posts] Failed to create reply notification:", e);
    }
  }
  const mentions = extractMentions(content);
  if (mentions.length > 0) {
    const localMentions = mentions.filter((m) => !m.includes("@"));
    const remoteMentions = mentions.filter((m) => m.includes("@"));
    const localActors = localMentions.length > 0 ? await prisma.actor.findMany({
      where: { preferredUsername: { in: localMentions } },
      select: { apId: true, preferredUsername: true }
    }) : [];
    const localActorMap = new Map(localActors.map((a) => [a.preferredUsername, a.apId]));
    const cachedActors = remoteMentions.length > 0 ? await prisma.actorCache.findMany({
      where: {
        preferredUsername: { in: remoteMentions.map((m) => m.split("@")[0]) }
      },
      select: { apId: true, preferredUsername: true }
    }) : [];
    const remoteActorMap = /* @__PURE__ */ new Map();
    for (const mention of remoteMentions) {
      const [username, domain2] = mention.split("@");
      const matching = cachedActors.find(
        (a) => a.preferredUsername === username && a.apId.includes(domain2)
      );
      if (matching) {
        remoteActorMap.set(mention, matching.apId);
      }
    }
    let parentAuthor = null;
    if (body.in_reply_to) {
      const parentPost = await prisma.object.findUnique({
        where: { apId: body.in_reply_to },
        select: { attributedTo: true }
      });
      parentAuthor = parentPost?.attributedTo || null;
    }
    const activitiesToCreate = [];
    const inboxEntriesToCreate = [];
    for (const mention of mentions) {
      try {
        let mentionedActorApId = null;
        if (mention.includes("@")) {
          mentionedActorApId = remoteActorMap.get(mention) || null;
        } else {
          mentionedActorApId = localActorMap.get(mention) || null;
        }
        if (!mentionedActorApId || mentionedActorApId === actor.ap_id)
          continue;
        if (parentAuthor === mentionedActorApId)
          continue;
        if (isLocal(mentionedActorApId, baseUrl)) {
          const mentionActivityId = activityApId(baseUrl, generateId());
          activitiesToCreate.push({
            apId: mentionActivityId,
            type: "Create",
            actorApId: actor.ap_id,
            objectApId: apId,
            rawJson: JSON.stringify({
              "@context": "https://www.w3.org/ns/activitystreams",
              id: mentionActivityId,
              type: "Create",
              actor: actor.ap_id,
              object: apId
            }),
            createdAt: now
          });
          inboxEntriesToCreate.push({
            actorApId: mentionedActorApId,
            activityApId: mentionActivityId,
            read: 0,
            createdAt: now
          });
        }
      } catch (e) {
        console.error(`Failed to process mention ${mention}:`, e);
      }
    }
    if (activitiesToCreate.length > 0) {
      await prisma.activity.createMany({ data: activitiesToCreate });
    }
    if (inboxEntriesToCreate.length > 0) {
      await prisma.inbox.createMany({ data: inboxEntriesToCreate });
    }
  }
  if (visibility !== "direct") {
    const followers = await prisma.follow.findMany({
      where: {
        followingApId: actor.ap_id,
        status: "accepted"
      },
      select: { followerApId: true },
      distinct: ["followerApId"]
    });
    const followersUrl = `${actor.ap_id}/followers`;
    const publicUrl = "https://www.w3.org/ns/activitystreams#Public";
    let toField;
    let ccField;
    if (visibility === "public") {
      toField = [publicUrl];
      ccField = [followersUrl];
    } else if (visibility === "unlisted") {
      toField = [followersUrl];
      ccField = [publicUrl];
    } else if (visibility === "followers") {
      toField = [followersUrl];
      ccField = [];
    } else {
      toField = [];
      ccField = [];
    }
    const createActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityApId(baseUrl, generateId()),
      type: "Create",
      actor: actor.ap_id,
      published: now,
      to: toField,
      cc: ccField,
      object: {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: apId,
        type: "Note",
        attributedTo: actor.ap_id,
        content,
        summary: summary || null,
        attachment: body.attachments || [],
        inReplyTo: body.in_reply_to || null,
        published: now,
        to: toField,
        cc: ccField
      }
    };
    const remoteFollowers = followers.filter((f) => !isLocal(f.followerApId, baseUrl));
    if (remoteFollowers.length > 0) {
      const senderActor = { apId: actor.ap_id, privateKeyPem: actor.private_key_pem };
      Promise.allSettled(
        remoteFollowers.map(
          (follower) => deliverActivity(prisma, senderActor, follower.followerApId, createActivity).then((success) => {
            if (!success) {
              console.warn(`[Posts] Background delivery failed to ${follower.followerApId}`);
            }
          }).catch((err) => {
            console.error(`[Posts] Background delivery error to ${follower.followerApId}:`, err);
          })
        )
      ).catch((err) => {
        console.error("[Posts] Background delivery batch error:", err);
      });
    }
    await prisma.activity.create({
      data: {
        apId: createActivity.id,
        type: "Create",
        actorApId: actor.ap_id,
        objectApId: apId,
        rawJson: JSON.stringify(createActivity),
        direction: "outbound"
      }
    });
  }
  return c.json({
    ap_id: apId,
    type: "Note",
    author: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id),
      preferred_username: actor.preferred_username,
      name: actor.name,
      icon_url: actor.icon_url
    },
    content,
    summary: summary || null,
    attachments: body.attachments || [],
    visibility,
    published: now,
    like_count: 0,
    reply_count: 0,
    announce_count: 0,
    liked: false,
    bookmarked: false
  });
});
posts.get("/:id", async (c) => {
  const currentActor = c.get("actor");
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const prisma = c.get("prisma");
  const postApId = objectApId(baseUrl, postId);
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: postApId },
        { apId: postId }
      ]
    },
    include: {
      author: {
        select: {
          preferredUsername: true,
          name: true,
          iconUrl: true
        }
      }
    }
  });
  if (!post)
    return c.json({ error: "Post not found" }, 404);
  let authorUsername = post.author?.preferredUsername;
  let authorName = post.author?.name;
  let authorIconUrl = post.author?.iconUrl;
  if (!authorUsername) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: post.attributedTo },
      select: { preferredUsername: true, name: true, iconUrl: true }
    });
    if (cachedActor) {
      authorUsername = cachedActor.preferredUsername;
      authorName = cachedActor.name;
      authorIconUrl = cachedActor.iconUrl;
    }
  }
  let liked = false;
  let bookmarked = false;
  if (currentActor) {
    const likeExists = await prisma.like.findUnique({
      where: {
        actorApId_objectApId: {
          actorApId: currentActor.ap_id,
          objectApId: post.apId
        }
      }
    });
    liked = !!likeExists;
    const bookmarkExists = await prisma.bookmark.findUnique({
      where: {
        actorApId_objectApId: {
          actorApId: currentActor.ap_id,
          objectApId: post.apId
        }
      }
    });
    bookmarked = !!bookmarkExists;
  }
  if (post.visibility === "followers") {
    if (!currentActor) {
      return c.json({ error: "Post not found" }, 404);
    }
    if (currentActor.ap_id !== post.attributedTo) {
      const follows = await prisma.follow.findUnique({
        where: {
          followerApId_followingApId: {
            followerApId: currentActor.ap_id,
            followingApId: post.attributedTo
          },
          status: "accepted"
        }
      });
      if (!follows) {
        return c.json({ error: "Post not found" }, 404);
      }
    }
  }
  if (post.visibility === "direct") {
    if (!currentActor) {
      return c.json({ error: "Post not found" }, 404);
    }
    if (currentActor.ap_id !== post.attributedTo) {
      const recipients = safeJsonParse(post.toJson, []);
      if (!recipients.includes(currentActor.ap_id)) {
        return c.json({ error: "Post not found" }, 404);
      }
    }
  }
  const postRow = {
    ap_id: post.apId,
    type: post.type,
    attributed_to: post.attributedTo,
    author_username: authorUsername || null,
    author_name: authorName || null,
    author_icon_url: authorIconUrl || null,
    content: post.content,
    summary: post.summary,
    attachments_json: post.attachmentsJson,
    in_reply_to: post.inReplyTo,
    visibility: post.visibility,
    community_ap_id: post.communityApId,
    like_count: post.likeCount,
    reply_count: post.replyCount,
    announce_count: post.announceCount,
    published: post.published,
    liked: liked ? 1 : 0,
    bookmarked: bookmarked ? 1 : 0,
    to_json: post.toJson
  };
  return c.json({ post: formatPost(postRow, currentActor?.ap_id) });
});
posts.get("/:id/replies", async (c) => {
  const currentActor = c.get("actor");
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const limit = parseLimit(c.req.query("limit"), 20, MAX_POSTS_PAGE_LIMIT);
  const before = c.req.query("before");
  const prisma = c.get("prisma");
  const postApId = objectApId(baseUrl, postId);
  const parentPost = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: postApId },
        { apId: postId }
      ]
    },
    select: { apId: true }
  });
  if (!parentPost)
    return c.json({ error: "Post not found" }, 404);
  const whereClause = {
    inReplyTo: parentPost.apId
  };
  if (before) {
    whereClause.published = { lt: before };
  }
  const replies = await prisma.object.findMany({
    where: whereClause,
    include: {
      author: {
        select: {
          preferredUsername: true,
          name: true,
          iconUrl: true
        }
      }
    },
    orderBy: { published: "desc" },
    take: limit
  });
  const repliesWithoutAuthor = replies.filter((r) => !r.author);
  const cachedAuthorApIds = [...new Set(repliesWithoutAuthor.map((r) => r.attributedTo))];
  const cachedAuthors = cachedAuthorApIds.length > 0 ? await prisma.actorCache.findMany({
    where: { apId: { in: cachedAuthorApIds } },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
  }) : [];
  const cachedAuthorMap = new Map(cachedAuthors.map((a) => [a.apId, a]));
  const replyApIds = replies.map((r) => r.apId);
  const likedReplyIds = /* @__PURE__ */ new Set();
  const bookmarkedReplyIds = /* @__PURE__ */ new Set();
  if (currentActor) {
    const [likes, bookmarks] = await Promise.all([
      prisma.like.findMany({
        where: { actorApId: currentActor.ap_id, objectApId: { in: replyApIds } },
        select: { objectApId: true }
      }),
      prisma.bookmark.findMany({
        where: { actorApId: currentActor.ap_id, objectApId: { in: replyApIds } },
        select: { objectApId: true }
      })
    ]);
    likes.forEach((l) => likedReplyIds.add(l.objectApId));
    bookmarks.forEach((b) => bookmarkedReplyIds.add(b.objectApId));
  }
  const result = replies.map((reply) => {
    let authorUsername = reply.author?.preferredUsername;
    let authorName = reply.author?.name;
    let authorIconUrl = reply.author?.iconUrl;
    if (!authorUsername) {
      const cachedActor = cachedAuthorMap.get(reply.attributedTo);
      if (cachedActor) {
        authorUsername = cachedActor.preferredUsername;
        authorName = cachedActor.name;
        authorIconUrl = cachedActor.iconUrl;
      }
    }
    const liked = likedReplyIds.has(reply.apId);
    const bookmarked = bookmarkedReplyIds.has(reply.apId);
    const postRow = {
      ap_id: reply.apId,
      type: reply.type,
      attributed_to: reply.attributedTo,
      author_username: authorUsername || null,
      author_name: authorName || null,
      author_icon_url: authorIconUrl || null,
      content: reply.content,
      summary: reply.summary,
      attachments_json: reply.attachmentsJson,
      in_reply_to: reply.inReplyTo,
      visibility: reply.visibility,
      community_ap_id: reply.communityApId,
      like_count: reply.likeCount,
      reply_count: reply.replyCount,
      announce_count: reply.announceCount,
      published: reply.published,
      liked: liked ? 1 : 0
    };
    return formatPost(postRow, currentActor?.ap_id);
  });
  return c.json({ replies: result });
});
posts.patch("/:id", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const body = await c.req.json();
  const prisma = c.get("prisma");
  const postApId = objectApId(baseUrl, postId);
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: postApId },
        { apId: postId }
      ]
    }
  });
  if (!post)
    return c.json({ error: "Post not found" }, 404);
  if (post.attributedTo !== actor.ap_id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  let trimmedContent;
  if (body.content !== void 0) {
    trimmedContent = body.content.trim();
    if (trimmedContent.length === 0) {
      return c.json({ error: "Content cannot be empty" }, 400);
    }
    if (trimmedContent.length > MAX_POST_CONTENT_LENGTH) {
      return c.json({ error: `Content too long (max ${MAX_POST_CONTENT_LENGTH} chars)` }, 400);
    }
  }
  let trimmedSummary;
  if (body.summary !== void 0) {
    trimmedSummary = body.summary.trim();
    if (trimmedSummary.length > MAX_POST_SUMMARY_LENGTH) {
      return c.json({ error: `Summary too long (max ${MAX_POST_SUMMARY_LENGTH} chars)` }, 400);
    }
  }
  const nextContent = body.content !== void 0 ? trimmedContent : post.content;
  const nextSummary = body.summary !== void 0 ? trimmedSummary || null : post.summary;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const updateData = {
    updated: now
  };
  if (body.content !== void 0) {
    updateData.content = trimmedContent;
  }
  if (body.summary !== void 0) {
    updateData.summary = trimmedSummary || null;
  }
  if (Object.keys(updateData).length === 1) {
    return c.json({ error: "No changes provided" }, 400);
  }
  await prisma.object.update({
    where: { apId: post.apId },
    data: updateData
  });
  const followers = await prisma.follow.findMany({
    where: {
      followingApId: actor.ap_id,
      status: "accepted"
    },
    select: { followerApId: true },
    distinct: ["followerApId"]
  });
  const updateActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Update",
    actor: actor.ap_id,
    object: {
      id: post.apId,
      type: "Note",
      attributedTo: actor.ap_id,
      content: nextContent,
      summary: nextSummary,
      updated: now
    }
  };
  const remoteFollowers = followers.filter((f) => !isLocal(f.followerApId, baseUrl));
  const senderActor = { apId: actor.ap_id, privateKeyPem: actor.private_key_pem };
  await deliverActivityToMany(prisma, senderActor, remoteFollowers.map((f) => f.followerApId), updateActivity);
  await prisma.activity.create({
    data: {
      apId: updateActivity.id,
      type: "Update",
      actorApId: actor.ap_id,
      objectApId: post.apId,
      rawJson: JSON.stringify(updateActivity),
      direction: "outbound"
    }
  });
  return c.json({
    success: true,
    post: {
      ap_id: post.apId,
      content: nextContent,
      summary: nextSummary,
      updated_at: now
    }
  });
});
posts.delete("/:id", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const prisma = c.get("prisma");
  const postApId = objectApId(baseUrl, postId);
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: postApId },
        { apId: postId }
      ]
    }
  });
  if (!post)
    return c.json({ error: "Post not found" }, 404);
  if (post.attributedTo !== actor.ap_id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await prisma.object.delete({
    where: { apId: post.apId }
  });
  await prisma.actor.update({
    where: { apId: actor.ap_id },
    data: {
      postCount: { decrement: 1 }
    }
  });
  if (post.inReplyTo) {
    try {
      await prisma.object.update({
        where: { apId: post.inReplyTo },
        data: {
          replyCount: { decrement: 1 }
        }
      });
    } catch (err) {
      console.warn("[Posts] Failed to decrement parent reply count (parent may not exist):", err);
    }
  }
  const followers = await prisma.follow.findMany({
    where: {
      followingApId: actor.ap_id,
      status: "accepted"
    },
    select: { followerApId: true },
    distinct: ["followerApId"]
  });
  const deleteActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: activityApId(baseUrl, generateId()),
    type: "Delete",
    actor: actor.ap_id,
    object: post.apId
  };
  const remoteFollowers = followers.filter((f) => !isLocal(f.followerApId, baseUrl));
  const senderActorDelete = { apId: actor.ap_id, privateKeyPem: actor.private_key_pem };
  await deliverActivityToMany(prisma, senderActorDelete, remoteFollowers.map((f) => f.followerApId), deleteActivity);
  return c.json({ success: true });
});
var base_default = posts;

// src/backend/routes/posts/interactions.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var posts2 = new Hono2();
posts2.post("/:id/like", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    }
  });
  if (!post)
    return c.json({ error: "Post not found" }, 404);
  const existingLike = await prisma.like.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });
  if (existingLike)
    return c.json({ error: "Already liked" }, 400);
  const likeId = generateId();
  const likeActivityApId = activityApId(baseUrl, likeId);
  const likeActivityRaw = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: likeActivityApId,
    type: "Like",
    actor: actor.ap_id,
    object: post.apId
  };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const shouldNotifyLocal = post.attributedTo !== actor.ap_id && isLocal(post.attributedTo, baseUrl);
  await prisma.$transaction(async (tx) => {
    await tx.like.create({
      data: {
        actorApId: actor.ap_id,
        objectApId: post.apId,
        activityApId: likeActivityApId
      }
    });
    await tx.object.update({
      where: { apId: post.apId },
      data: { likeCount: { increment: 1 } }
    });
    await tx.activity.create({
      data: {
        apId: likeActivityApId,
        type: "Like",
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(likeActivityRaw),
        createdAt: now
      }
    });
    if (shouldNotifyLocal) {
      await tx.inbox.create({
        data: {
          actorApId: post.attributedTo,
          activityApId: likeActivityApId,
          read: 0,
          createdAt: now
        }
      });
    }
  });
  if (!isLocal(post.apId, baseUrl)) {
    await deliverActivity(prisma, { apId: actor.ap_id, privateKeyPem: actor.private_key_pem }, post.attributedTo, likeActivityRaw);
  }
  return c.json({ success: true, liked: true });
});
posts2.delete("/:id/like", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    }
  });
  if (!post)
    return c.json({ error: "Post not found" }, 404);
  const like = await prisma.like.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });
  if (!like)
    return c.json({ error: "Not liked" }, 400);
  await prisma.$transaction(async (tx) => {
    await tx.like.delete({
      where: {
        actorApId_objectApId: {
          actorApId: actor.ap_id,
          objectApId: post.apId
        }
      }
    });
    await tx.object.updateMany({
      where: {
        apId: post.apId,
        likeCount: { gt: 0 }
      },
      data: { likeCount: { decrement: 1 } }
    });
  });
  if (!isLocal(post.apId, baseUrl)) {
    const undoObject = like.activityApId ? like.activityApId : {
      type: "Like",
      actor: actor.ap_id,
      object: post.apId
    };
    const undoLikeActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityApId(baseUrl, generateId()),
      type: "Undo",
      actor: actor.ap_id,
      object: undoObject
    };
    const delivered = await deliverActivity(prisma, { apId: actor.ap_id, privateKeyPem: actor.private_key_pem }, post.attributedTo, undoLikeActivity);
    if (delivered) {
      await prisma.activity.create({
        data: {
          apId: undoLikeActivity.id,
          type: "Undo",
          actorApId: actor.ap_id,
          objectApId: post.apId,
          rawJson: JSON.stringify(undoLikeActivity),
          direction: "outbound"
        }
      });
    }
  }
  return c.json({ success: true, liked: false });
});
posts2.post("/:id/repost", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    }
  });
  if (!post)
    return c.json({ error: "Post not found" }, 404);
  const existingRepost = await prisma.announce.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });
  if (existingRepost)
    return c.json({ error: "Already reposted" }, 400);
  const announceId = generateId();
  const announceActivityApId = activityApId(baseUrl, announceId);
  const announceActivityRaw = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: announceActivityApId,
    type: "Announce",
    actor: actor.ap_id,
    object: post.apId,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [actor.ap_id + "/followers"]
  };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const shouldNotifyLocal = post.attributedTo !== actor.ap_id && isLocal(post.attributedTo, baseUrl);
  await prisma.$transaction(async (tx) => {
    await tx.announce.create({
      data: {
        actorApId: actor.ap_id,
        objectApId: post.apId,
        activityApId: announceActivityApId
      }
    });
    await tx.object.update({
      where: { apId: post.apId },
      data: { announceCount: { increment: 1 } }
    });
    await tx.activity.create({
      data: {
        apId: announceActivityApId,
        type: "Announce",
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(announceActivityRaw),
        createdAt: now
      }
    });
    if (shouldNotifyLocal) {
      await tx.inbox.create({
        data: {
          actorApId: post.attributedTo,
          activityApId: announceActivityApId,
          read: 0,
          createdAt: now
        }
      });
    }
  });
  if (!isLocal(post.apId, baseUrl)) {
    await deliverActivity(prisma, { apId: actor.ap_id, privateKeyPem: actor.private_key_pem }, post.attributedTo, announceActivityRaw);
  }
  return c.json({ success: true, reposted: true });
});
posts2.delete("/:id/repost", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    }
  });
  if (!post)
    return c.json({ error: "Post not found" }, 404);
  const announce = await prisma.announce.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });
  if (!announce)
    return c.json({ error: "Not reposted" }, 400);
  await prisma.$transaction(async (tx) => {
    await tx.announce.delete({
      where: {
        actorApId_objectApId: {
          actorApId: actor.ap_id,
          objectApId: post.apId
        }
      }
    });
    await tx.object.updateMany({
      where: {
        apId: post.apId,
        announceCount: { gt: 0 }
      },
      data: { announceCount: { decrement: 1 } }
    });
  });
  if (!isLocal(post.apId, baseUrl)) {
    const undoAnnounceActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: activityApId(baseUrl, generateId()),
      type: "Undo",
      actor: actor.ap_id,
      object: {
        type: "Announce",
        actor: actor.ap_id,
        object: post.apId
      }
    };
    const delivered = await deliverActivity(prisma, { apId: actor.ap_id, privateKeyPem: actor.private_key_pem }, post.attributedTo, undoAnnounceActivity);
    if (delivered) {
      await prisma.activity.create({
        data: {
          apId: undoAnnounceActivity.id,
          type: "Undo",
          actorApId: actor.ap_id,
          objectApId: post.apId,
          rawJson: JSON.stringify(undoAnnounceActivity),
          direction: "outbound"
        }
      });
    }
  }
  return c.json({ success: true, reposted: false });
});
posts2.post("/:id/bookmark", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    },
    select: { apId: true }
  });
  if (!post)
    return c.json({ error: "Post not found" }, 404);
  const existingBookmark = await prisma.bookmark.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });
  if (existingBookmark)
    return c.json({ error: "Already bookmarked" }, 400);
  await prisma.bookmark.create({
    data: {
      actorApId: actor.ap_id,
      objectApId: post.apId
    }
  });
  return c.json({ success: true, bookmarked: true });
});
posts2.delete("/:id/bookmark", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const postId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    },
    select: { apId: true }
  });
  if (!post)
    return c.json({ error: "Post not found" }, 404);
  const bookmark = await prisma.bookmark.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });
  if (!bookmark)
    return c.json({ error: "Not bookmarked" }, 400);
  await prisma.bookmark.delete({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });
  return c.json({ success: true, bookmarked: false });
});
posts2.get("/bookmarks", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const limit = parseLimit(c.req.query("limit"), 20, MAX_POSTS_PAGE_LIMIT);
  const before = c.req.query("before");
  const bookmarks = await prisma.bookmark.findMany({
    where: {
      actorApId: actor.ap_id,
      ...before ? { createdAt: { lt: before } } : {}
    },
    include: {
      object: true
    },
    orderBy: { createdAt: "desc" },
    take: limit
  });
  const authorApIds = [...new Set(bookmarks.map((b) => b.object.attributedTo))];
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    })
  ]);
  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
  const postApIds = bookmarks.map((b) => b.object.apId);
  const likes = await prisma.like.findMany({
    where: { actorApId: actor.ap_id, objectApId: { in: postApIds } },
    select: { objectApId: true }
  });
  const likedPostIds = new Set(likes.map((l) => l.objectApId));
  const result = bookmarks.map((b) => {
    const obj = b.object;
    const authorInfo = localActorMap.get(obj.attributedTo) || cachedActorMap.get(obj.attributedTo);
    return {
      ap_id: obj.apId,
      type: obj.type,
      author: {
        ap_id: obj.attributedTo,
        username: formatUsername(obj.attributedTo),
        preferred_username: authorInfo?.preferredUsername || null,
        name: authorInfo?.name || null,
        icon_url: authorInfo?.iconUrl || null
      },
      content: obj.content,
      summary: obj.summary,
      attachments: safeJsonParse(obj.attachmentsJson, []),
      in_reply_to: obj.inReplyTo,
      visibility: obj.visibility,
      community_ap_id: obj.communityApId,
      like_count: obj.likeCount,
      reply_count: obj.replyCount,
      announce_count: obj.announceCount,
      published: obj.published,
      liked: likedPostIds.has(obj.apId),
      bookmarked: true,
      reposted: false
    };
  });
  return c.json({ bookmarks: result });
});
var interactions_default = posts2;

// src/backend/routes/posts.ts
var posts3 = new Hono2();
posts3.route("/", base_default);
posts3.route("/", interactions_default);
var posts_default = posts3;

// src/backend/routes/notifications.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var notifications = new Hono2();
var ARCHIVE_RETENTION_DAYS = 90;
async function cleanupArchivedNotifications(prisma, actorApId2) {
  const retentionDate = /* @__PURE__ */ new Date();
  retentionDate.setDate(retentionDate.getDate() - ARCHIVE_RETENTION_DAYS);
  const retentionDateStr = retentionDate.toISOString();
  const archivedToDelete = await prisma.notificationArchived.findMany({
    where: {
      actorApId: actorApId2,
      archivedAt: { lt: retentionDateStr }
    },
    select: { activityApId: true }
  });
  if (archivedToDelete.length > 0) {
    const activityApIds = archivedToDelete.map((a) => a.activityApId);
    await prisma.inbox.deleteMany({
      where: {
        actorApId: actorApId2,
        activityApId: { in: activityApIds }
      }
    });
    await prisma.notificationArchived.deleteMany({
      where: {
        actorApId: actorApId2,
        archivedAt: { lt: retentionDateStr }
      }
    });
  }
}
__name(cleanupArchivedNotifications, "cleanupArchivedNotifications");
function activityToNotificationType(activityType, hasInReplyTo, followStatus) {
  switch (activityType) {
    case "Follow":
      return followStatus === "pending" ? "follow_request" : "follow";
    case "Like":
      return "like";
    case "Announce":
      return "announce";
    case "Create":
      return hasInReplyTo ? "reply" : "mention";
    default:
      return null;
  }
}
__name(activityToNotificationType, "activityToNotificationType");
notifications.get("/", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  await cleanupArchivedNotifications(prisma, actor.ap_id);
  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");
  const before = c.req.query("before");
  const typeFilter = c.req.query("type");
  const showArchived = c.req.query("archived") === "true";
  const typeToActivityType = {
    "follow": ["Follow"],
    "like": ["Like"],
    "announce": ["Announce"],
    "reply": ["Create"],
    // Create with in_reply_to
    "mention": ["Create"]
    // Create without in_reply_to
  };
  let activityTypes = ["Follow", "Like", "Announce", "Create"];
  if (typeFilter && typeToActivityType[typeFilter]) {
    activityTypes = typeToActivityType[typeFilter];
  }
  const archivedActivities = await prisma.notificationArchived.findMany({
    where: { actorApId: actor.ap_id },
    select: { activityApId: true }
  });
  const archivedActivityIds = new Set(archivedActivities.map((a) => a.activityApId));
  const whereClause = {
    actorApId: actor.ap_id,
    activity: {
      actorApId: { not: actor.ap_id },
      type: { in: activityTypes }
    }
  };
  if (before) {
    whereClause.createdAt = { lt: before };
  }
  const inboxEntries = await prisma.inbox.findMany({
    where: whereClause,
    include: {
      activity: true
    },
    orderBy: { createdAt: "desc" },
    take: limit * 5
    // Fetch more to account for filtering
  });
  const actorApIds = [...new Set(inboxEntries.map((i) => i.activity.actorApId))];
  const objectApIds = [...new Set(inboxEntries.map((i) => i.activity.objectApId).filter((id) => id !== null))];
  const activityApIds = [...new Set(inboxEntries.map((i) => i.activityApId))];
  const [localActors, cachedActors, objects, follows] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: actorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: actorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.object.findMany({
      where: { apId: { in: objectApIds } },
      select: { apId: true, content: true, inReplyTo: true }
    }),
    prisma.follow.findMany({
      where: { activityApId: { in: activityApIds } },
      select: { activityApId: true, status: true }
    })
  ]);
  const actorMap = /* @__PURE__ */ new Map();
  for (const a of localActors) {
    actorMap.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
  }
  for (const a of cachedActors) {
    if (!actorMap.has(a.apId)) {
      actorMap.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
    }
  }
  const objectMap = /* @__PURE__ */ new Map();
  for (const o of objects) {
    objectMap.set(o.apId, { content: o.content, inReplyTo: o.inReplyTo });
  }
  const followMap = /* @__PURE__ */ new Map();
  for (const f of follows) {
    if (f.activityApId) {
      followMap.set(f.activityApId, f.status);
    }
  }
  const processedEntries = [];
  for (const entry of inboxEntries) {
    const isArchived = archivedActivityIds.has(entry.activityApId);
    if (showArchived !== isArchived) {
      continue;
    }
    const objectData = entry.activity.objectApId ? objectMap.get(entry.activity.objectApId) : null;
    const inReplyTo = objectData?.inReplyTo ?? null;
    if (typeFilter === "reply" && entry.activity.type === "Create" && !inReplyTo) {
      continue;
    }
    if (typeFilter === "mention" && entry.activity.type === "Create" && inReplyTo) {
      continue;
    }
    const actorData = actorMap.get(entry.activity.actorApId);
    const followStatus = followMap.get(entry.activityApId) ?? null;
    processedEntries.push({
      activityApId: entry.activityApId,
      read: entry.read,
      createdAt: entry.createdAt,
      activityType: entry.activity.type,
      actorApId: entry.activity.actorApId,
      objectApId: entry.activity.objectApId,
      followStatus,
      actorUsername: actorData?.preferredUsername ?? null,
      actorName: actorData?.name ?? null,
      actorIconUrl: actorData?.iconUrl ?? null,
      objectContent: objectData?.content ?? null,
      inReplyTo
    });
    if (processedEntries.length > limit) {
      break;
    }
  }
  const has_more = processedEntries.length > limit;
  const actualResults = has_more ? processedEntries.slice(0, limit) : processedEntries;
  const notifications_list = actualResults.map((n) => {
    const notifType = activityToNotificationType(n.activityType, !!n.inReplyTo, n.followStatus);
    return {
      id: n.activityApId,
      type: notifType || n.activityType.toLowerCase(),
      object_ap_id: n.objectApId,
      read: !!n.read,
      created_at: n.createdAt,
      actor: {
        ap_id: n.actorApId,
        username: formatUsername(n.actorApId),
        preferred_username: n.actorUsername,
        name: n.actorName,
        icon_url: n.actorIconUrl
      },
      object_content: n.objectContent || ""
    };
  });
  return c.json({ notifications: notifications_list, limit, offset, has_more });
});
notifications.get("/unread/count", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  await cleanupArchivedNotifications(prisma, actor.ap_id);
  const unreadCount = await prisma.inbox.count({
    where: {
      actorApId: actor.ap_id,
      read: 0,
      activity: {
        actorApId: { not: actor.ap_id },
        type: { in: ["Follow", "Like", "Announce", "Create"] }
      }
    }
  });
  return c.json({
    count: unreadCount
  });
});
notifications.post("/read", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  if (body.read_all) {
    await prisma.inbox.updateMany({
      where: { actorApId: actor.ap_id },
      data: { read: 1 }
    });
  } else if (body.ids && body.ids.length > 0) {
    await prisma.inbox.updateMany({
      where: {
        actorApId: actor.ap_id,
        activityApId: { in: body.ids }
      },
      data: { read: 1 }
    });
  } else {
    return c.json({ error: "Either ids array or read_all flag is required" }, 400);
  }
  return c.json({ success: true });
});
notifications.post("/archive", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  if (!body.ids || body.ids.length === 0) {
    return c.json({ error: "ids array is required" }, 400);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let archivedCount = 0;
  for (const id of body.ids) {
    try {
      await prisma.notificationArchived.create({
        data: {
          actorApId: actor.ap_id,
          activityApId: id,
          archivedAt: now
        }
      });
      archivedCount++;
    } catch {
    }
  }
  return c.json({ success: true, archived_count: archivedCount });
});
notifications.delete("/archive", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  if (!body.ids || body.ids.length === 0) {
    return c.json({ error: "ids array is required" }, 400);
  }
  await prisma.notificationArchived.deleteMany({
    where: {
      actorApId: actor.ap_id,
      activityApId: { in: body.ids }
    }
  });
  return c.json({ success: true });
});
var ARCHIVE_ALL_CAP = 1e3;
var ARCHIVE_BATCH_SIZE = 100;
notifications.post("/archive/all", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const alreadyArchived = await prisma.notificationArchived.findMany({
    where: { actorApId: actor.ap_id },
    select: { activityApId: true },
    take: ARCHIVE_ALL_CAP
  });
  const alreadyArchivedIds = new Set(alreadyArchived.map((a) => a.activityApId));
  const inboxItems = await prisma.inbox.findMany({
    where: { actorApId: actor.ap_id },
    select: { activityApId: true },
    take: ARCHIVE_ALL_CAP
  });
  const toArchive = inboxItems.filter((item) => !alreadyArchivedIds.has(item.activityApId));
  let archivedCount = 0;
  for (let i = 0; i < toArchive.length; i += ARCHIVE_BATCH_SIZE) {
    const batch = toArchive.slice(i, i + ARCHIVE_BATCH_SIZE);
    const batchData = batch.map((item) => ({
      actorApId: actor.ap_id,
      activityApId: item.activityApId,
      archivedAt: now
    }));
    try {
      const result = await prisma.notificationArchived.createMany({
        data: batchData
      });
      archivedCount += result.count;
    } catch (e) {
      const error3 = e;
      if (error3.code !== "P2002") {
        console.error("[Notifications] Batch archive error:", e);
      }
    }
  }
  return c.json({ success: true, archived_count: archivedCount });
});
var notifications_default = notifications;

// src/backend/routes/stories.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/stories/base.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/stories/utils.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
async function cleanupExpiredStories(prisma) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const expiredStories = await prisma.object.findMany({
    where: {
      type: "Story",
      endTime: { lt: now }
    },
    select: {
      apId: true
    }
  });
  if (expiredStories.length === 0) {
    return 0;
  }
  const expiredApIds = expiredStories.map((s) => s.apId);
  await prisma.storyVote.deleteMany({
    where: {
      storyApId: { in: expiredApIds }
    }
  });
  await prisma.like.deleteMany({
    where: {
      objectApId: { in: expiredApIds }
    }
  });
  await prisma.storyView.deleteMany({
    where: {
      storyApId: { in: expiredApIds }
    }
  });
  await prisma.storyShare.deleteMany({
    where: {
      storyApId: { in: expiredApIds }
    }
  });
  const result = await prisma.object.deleteMany({
    where: {
      type: "Story",
      endTime: { lt: now }
    }
  });
  return result.count;
}
__name(cleanupExpiredStories, "cleanupExpiredStories");
async function getVoteCounts(prisma, storyApId) {
  const votes = await prisma.storyVote.groupBy({
    by: ["optionIndex"],
    where: {
      storyApId
    },
    _count: {
      id: true
    }
  });
  const results = {};
  votes.forEach((vote) => {
    results[vote.optionIndex] = vote._count.id;
  });
  return results;
}
__name(getVoteCounts, "getVoteCounts");
function validateOverlays(overlays) {
  if (!Array.isArray(overlays)) {
    return { valid: false, error: "overlays must be an array" };
  }
  for (let i = 0; i < overlays.length; i++) {
    const overlay = overlays[i];
    if (!overlay.type || typeof overlay.type !== "string") {
      return { valid: false, error: `overlay[${i}].type is required` };
    }
    if (!overlay.position || typeof overlay.position !== "object") {
      return { valid: false, error: `overlay[${i}].position is required` };
    }
    const position = overlay.position;
    const { x, y, width, height } = position;
    if (typeof x !== "number" || x < 0 || x > 1) {
      return { valid: false, error: `overlay[${i}].position.x must be 0.0-1.0` };
    }
    if (typeof y !== "number" || y < 0 || y > 1) {
      return { valid: false, error: `overlay[${i}].position.y must be 0.0-1.0` };
    }
    if (typeof width !== "number" || width < 0 || width > 1) {
      return { valid: false, error: `overlay[${i}].position.width must be 0.0-1.0` };
    }
    if (typeof height !== "number" || height < 0 || height > 1) {
      return { valid: false, error: `overlay[${i}].position.height must be 0.0-1.0` };
    }
    if (overlay.type === "Question") {
      const oneOf = overlay.oneOf;
      if (!oneOf || !Array.isArray(oneOf) || oneOf.length < 2 || oneOf.length > 4) {
        return { valid: false, error: `overlay[${i}].oneOf must have 2-4 options` };
      }
    }
    if (overlay.type === "Link") {
      if (!overlay.href || typeof overlay.href !== "string") {
        return { valid: false, error: `overlay[${i}].href is required` };
      }
      try {
        new URL(overlay.href);
      } catch {
        return { valid: false, error: `overlay[${i}].href is invalid URL` };
      }
    }
  }
  return { valid: true };
}
__name(validateOverlays, "validateOverlays");
function transformStoryData(attachmentsJson) {
  const stored = JSON.parse(attachmentsJson || "{}");
  const r2Key = stored.attachment?.r2_key;
  const contentType = stored.attachment?.content_type || "image/jpeg";
  const externalUrl = stored.attachment?.url;
  let url = "";
  if (r2Key) {
    url = `/media/${r2Key.replace("uploads/", "")}`;
  } else if (externalUrl) {
    url = externalUrl;
  }
  return {
    attachment: {
      type: contentType.startsWith("video/") ? "Video" : "Document",
      mediaType: contentType,
      url,
      r2_key: r2Key || "",
      width: stored.attachment?.width || 1080,
      height: stored.attachment?.height || 1920
    },
    displayDuration: stored.displayDuration || "PT5S",
    overlays: stored.overlays || void 0
  };
}
__name(transformStoryData, "transformStoryData");

// src/backend/routes/stories/base.ts
var stories = new Hono2();
stories.get("/", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (Math.random() < 0.01) {
    cleanupExpiredStories(prisma).catch(() => {
    });
  }
  const follows = await prisma.follow.findMany({
    where: {
      followerApId: actor.ap_id,
      status: "accepted"
    },
    select: {
      followingApId: true
    }
  });
  const followedIds = follows.map((f) => f.followingApId);
  followedIds.push(actor.ap_id);
  const blocks = await prisma.block.findMany({
    where: {
      blockerApId: actor.ap_id
    },
    select: {
      blockedApId: true
    }
  });
  const blockedIds = blocks.map((b) => b.blockedApId);
  const mutes = await prisma.mute.findMany({
    where: {
      muterApId: actor.ap_id
    },
    select: {
      mutedApId: true
    }
  });
  const mutedIds = mutes.map((m) => m.mutedApId);
  const storiesData = await prisma.object.findMany({
    where: {
      type: "Story",
      endTime: { gt: now },
      attributedTo: {
        in: followedIds,
        notIn: [...blockedIds, ...mutedIds]
      }
    },
    include: {
      author: {
        select: {
          apId: true,
          preferredUsername: true,
          name: true,
          iconUrl: true
        }
      },
      storyViews: {
        where: { actorApId: actor.ap_id },
        select: { actorApId: true }
      },
      likes: {
        where: { actorApId: actor.ap_id },
        select: { actorApId: true }
      }
    },
    orderBy: [
      { endTime: "desc" }
    ]
  });
  const storyApIds = storiesData.map((s) => s.apId);
  let allVotes = {};
  let userVotes = {};
  if (storyApIds.length > 0) {
    const votes = await prisma.storyVote.groupBy({
      by: ["storyApId", "optionIndex"],
      where: {
        storyApId: { in: storyApIds }
      },
      _count: {
        id: true
      }
    });
    votes.forEach((v) => {
      if (!allVotes[v.storyApId]) {
        allVotes[v.storyApId] = {};
      }
      allVotes[v.storyApId][v.optionIndex] = v._count.id;
    });
    const userVotesData = await prisma.storyVote.findMany({
      where: {
        storyApId: { in: storyApIds },
        actorApId: actor.ap_id
      },
      select: {
        storyApId: true,
        optionIndex: true
      }
    });
    userVotesData.forEach((v) => {
      userVotes[v.storyApId] = v.optionIndex;
    });
  }
  const remoteAuthorIds = [...new Set(storiesData.filter((s) => !s.author).map((s) => s.attributedTo))];
  let actorCacheMap = {};
  if (remoteAuthorIds.length > 0) {
    const cachedActors = await prisma.actorCache.findMany({
      where: { apId: { in: remoteAuthorIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    });
    cachedActors.forEach((a) => {
      actorCacheMap[a.apId] = { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl };
    });
  }
  const grouped = {};
  const authorOrder = [];
  storiesData.forEach((s) => {
    const authorApId = s.attributedTo;
    const authorData = s.author || actorCacheMap[authorApId];
    const authorInfo = {
      ap_id: authorApId,
      username: formatUsername(authorApId),
      preferred_username: authorData?.preferredUsername || null,
      name: authorData?.name || null,
      icon_url: authorData?.iconUrl || null
    };
    if (!grouped[authorApId]) {
      grouped[authorApId] = {
        actor: authorInfo,
        stories: [],
        has_unviewed: false
      };
      if (authorApId === actor.ap_id) {
        authorOrder.unshift(authorApId);
      } else {
        authorOrder.push(authorApId);
      }
    }
    const isViewed = s.storyViews.length > 0;
    if (!isViewed) {
      grouped[authorApId].has_unviewed = true;
    }
    const storyData = transformStoryData(s.attachmentsJson);
    const storyVotes = allVotes[s.apId] || {};
    const total = Object.values(storyVotes).reduce((sum, count3) => sum + count3, 0);
    grouped[authorApId].stories.push({
      ap_id: s.apId,
      author: authorInfo,
      attachment: storyData.attachment,
      displayDuration: storyData.displayDuration,
      overlays: storyData.overlays,
      end_time: s.endTime || "",
      published: s.published,
      viewed: isViewed,
      like_count: s.likeCount,
      share_count: s.shareCount || 0,
      liked: s.likes.length > 0,
      votes: storyVotes,
      votes_total: total,
      user_vote: userVotes[s.apId]
    });
  });
  Object.keys(grouped).forEach((authorApId) => {
    grouped[authorApId].stories.sort((a, b) => {
      if (!a.viewed && b.viewed)
        return -1;
      if (a.viewed && !b.viewed)
        return 1;
      return b.end_time.localeCompare(a.end_time);
    });
  });
  authorOrder.sort((a, b) => {
    if (a === actor.ap_id)
      return -1;
    if (b === actor.ap_id)
      return 1;
    if (grouped[a].has_unviewed && !grouped[b].has_unviewed)
      return -1;
    if (!grouped[a].has_unviewed && grouped[b].has_unviewed)
      return 1;
    return 0;
  });
  const result = authorOrder.map((apId) => grouped[apId]);
  return c.json({ actor_stories: result });
});
stories.post("/cleanup", async (c) => {
  const prisma = c.get("prisma");
  const deleted = await cleanupExpiredStories(prisma);
  return c.json({ deleted });
});
stories.get("/:actorId", async (c) => {
  const targetActorId = c.req.param("actorId");
  const actor = c.get("actor");
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let targetApId = targetActorId;
  if (!targetActorId.startsWith("http")) {
    targetApId = actorApId(baseUrl, targetActorId);
  }
  let blockedIds = [];
  let mutedIds = [];
  if (actor) {
    const blocks = await prisma.block.findMany({
      where: { blockerApId: actor.ap_id },
      select: { blockedApId: true }
    });
    blockedIds = blocks.map((b) => b.blockedApId);
    const mutes = await prisma.mute.findMany({
      where: { muterApId: actor.ap_id },
      select: { mutedApId: true }
    });
    mutedIds = mutes.map((m) => m.mutedApId);
  }
  if (blockedIds.includes(targetApId) || mutedIds.includes(targetApId)) {
    return c.json({ stories: [] });
  }
  const userStories = await prisma.object.findMany({
    where: {
      type: "Story",
      attributedTo: targetApId,
      endTime: { gt: now }
    },
    include: {
      author: {
        select: {
          apId: true,
          preferredUsername: true,
          name: true,
          iconUrl: true
        }
      },
      storyViews: actor ? {
        where: { actorApId: actor.ap_id },
        select: { actorApId: true }
      } : false,
      likes: actor ? {
        where: { actorApId: actor.ap_id },
        select: { actorApId: true }
      } : false
    },
    orderBy: { published: "desc" }
  });
  const storyApIds = userStories.map((s) => s.apId);
  let allVotes = {};
  let userVotes = {};
  if (storyApIds.length > 0) {
    const votes = await prisma.storyVote.groupBy({
      by: ["storyApId", "optionIndex"],
      where: {
        storyApId: { in: storyApIds }
      },
      _count: {
        id: true
      }
    });
    votes.forEach((v) => {
      if (!allVotes[v.storyApId]) {
        allVotes[v.storyApId] = {};
      }
      allVotes[v.storyApId][v.optionIndex] = v._count.id;
    });
    if (actor) {
      const userVotesData = await prisma.storyVote.findMany({
        where: {
          storyApId: { in: storyApIds },
          actorApId: actor.ap_id
        },
        select: {
          storyApId: true,
          optionIndex: true
        }
      });
      userVotesData.forEach((v) => {
        userVotes[v.storyApId] = v.optionIndex;
      });
    }
  }
  const remoteAuthorIds = [...new Set(userStories.filter((s) => !s.author).map((s) => s.attributedTo))];
  let actorCacheMap = {};
  if (remoteAuthorIds.length > 0) {
    const cachedActors = await prisma.actorCache.findMany({
      where: { apId: { in: remoteAuthorIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    });
    cachedActors.forEach((a) => {
      actorCacheMap[a.apId] = { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl };
    });
  }
  const result = userStories.map((s) => {
    const storyData = transformStoryData(s.attachmentsJson);
    const authorData = s.author || actorCacheMap[s.attributedTo];
    const storyVotes = allVotes[s.apId] || {};
    const total = Object.values(storyVotes).reduce((sum, count3) => sum + count3, 0);
    const storyViews = s.storyViews || [];
    const likes = s.likes || [];
    return {
      ap_id: s.apId,
      author: {
        ap_id: s.attributedTo,
        username: formatUsername(s.attributedTo),
        preferred_username: authorData?.preferredUsername || null,
        name: authorData?.name || null,
        icon_url: authorData?.iconUrl || null
      },
      attachment: storyData.attachment,
      displayDuration: storyData.displayDuration,
      overlays: storyData.overlays,
      end_time: s.endTime || "",
      published: s.published,
      viewed: storyViews.length > 0,
      like_count: s.likeCount,
      share_count: s.shareCount || 0,
      liked: likes.length > 0,
      votes: storyVotes,
      votes_total: total,
      user_vote: userVotes[s.apId]
    };
  });
  return c.json({ stories: result });
});
stories.post("/", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  if (!body.attachment || !body.attachment.r2_key) {
    return c.json({ error: "attachment with r2_key required" }, 400);
  }
  if (body.overlays && body.overlays.length > 0) {
    const validation = validateOverlays(body.overlays);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }
  }
  const baseUrl = c.env.APP_URL;
  const id = generateId();
  const apId = objectApId(baseUrl, id);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const endTime = new Date(Date.now() + 24 * 60 * 60 * 1e3).toISOString();
  const storyData = {
    attachment: {
      ...body.attachment,
      width: body.attachment.width || 1080,
      height: body.attachment.height || 1920
    },
    displayDuration: body.displayDuration || "PT5S",
    overlays: body.overlays || void 0
  };
  const attachmentsJson = JSON.stringify(storyData);
  await prisma.object.create({
    data: {
      apId,
      type: "Story",
      attributedTo: actor.ap_id,
      content: "",
      attachmentsJson,
      endTime,
      published: now,
      isLocal: 1
    }
  });
  await prisma.actor.update({
    where: { apId: actor.ap_id },
    data: { postCount: { increment: 1 } }
  });
  const responseData = transformStoryData(attachmentsJson);
  const story = {
    ap_id: apId,
    author: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id),
      preferred_username: actor.preferred_username,
      name: actor.name,
      icon_url: actor.icon_url
    },
    attachment: responseData.attachment,
    displayDuration: responseData.displayDuration,
    overlays: responseData.overlays,
    end_time: endTime,
    published: now,
    viewed: false,
    like_count: 0,
    liked: false
  };
  sendCreateStoryActivity(
    {
      apId,
      attributedTo: actor.ap_id,
      attachment: responseData.attachment,
      displayDuration: responseData.displayDuration,
      overlays: responseData.overlays,
      endTime,
      published: now
    },
    actor,
    c.env,
    prisma
  ).catch(console.error);
  return c.json({ story }, 201);
});
stories.post("/delete", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  if (!body.ap_id)
    return c.json({ error: "ap_id required" }, 400);
  const apId = body.ap_id;
  const story = await prisma.object.findUnique({
    where: { apId }
  });
  if (!story)
    return c.json({ error: "Story not found" }, 404);
  if (story.attributedTo !== actor.ap_id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  try {
    await sendDeleteStoryActivity(apId, actor, c.env, prisma);
  } catch (err) {
    console.error("Failed to send Delete activity for story:", err);
  }
  await prisma.storyVote.deleteMany({
    where: { storyApId: apId }
  });
  await prisma.like.deleteMany({
    where: { objectApId: apId }
  });
  await prisma.storyView.deleteMany({
    where: { storyApId: apId }
  });
  await prisma.storyShare.deleteMany({
    where: { storyApId: apId }
  });
  await prisma.object.delete({
    where: { apId }
  });
  await prisma.actor.update({
    where: { apId: actor.ap_id },
    data: {
      postCount: { decrement: 1 }
    }
  });
  return c.json({ success: true });
});
var base_default2 = stories;

// src/backend/routes/stories/interactions.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var stories2 = new Hono2();
stories2.post("/view", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  if (!body.ap_id)
    return c.json({ error: "ap_id required" }, 400);
  const apId = body.ap_id;
  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: "Story"
    }
  });
  if (!story)
    return c.json({ error: "Story not found" }, 404);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await prisma.storyView.upsert({
      where: {
        actorApId_storyApId: {
          actorApId: actor.ap_id,
          storyApId: apId
        }
      },
      update: {},
      // No update needed if it already exists
      create: {
        actorApId: actor.ap_id,
        storyApId: apId,
        viewedAt: now
      }
    });
  } catch (e) {
  }
  return c.json({ success: true });
});
stories2.post("/vote", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  if (!body.ap_id)
    return c.json({ error: "ap_id required" }, 400);
  const apId = body.ap_id;
  if (typeof body.option_index !== "number" || body.option_index < 0) {
    return c.json({ error: "Invalid option_index" }, 400);
  }
  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: "Story"
    }
  });
  if (!story)
    return c.json({ error: "Story not found" }, 404);
  if (story.attributedTo === actor.ap_id) {
    return c.json({ error: "Cannot vote on your own story" }, 403);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  if (story.endTime && story.endTime < now) {
    return c.json({ error: "Story has expired" }, 410);
  }
  const storyData = JSON.parse(story.attachmentsJson || "{}");
  const questionOverlays = (storyData.overlays || []).filter((o) => o.type === "Question");
  if (questionOverlays.length === 0) {
    return c.json({ error: "Story has no poll" }, 400);
  }
  const maxOptionIndex = questionOverlays[0].oneOf?.length || 0;
  if (body.option_index >= maxOptionIndex) {
    return c.json({ error: `option_index must be 0-${maxOptionIndex - 1}` }, 400);
  }
  const existingVote = await prisma.storyVote.findFirst({
    where: {
      storyApId: apId,
      actorApId: actor.ap_id
    }
  });
  if (existingVote) {
    await prisma.storyVote.update({
      where: { id: existingVote.id },
      data: {
        optionIndex: body.option_index,
        createdAt: now
      }
    });
  } else {
    const voteId = generateId();
    await prisma.storyVote.create({
      data: {
        id: voteId,
        storyApId: apId,
        actorApId: actor.ap_id,
        optionIndex: body.option_index,
        createdAt: now
      }
    });
  }
  const votes = await getVoteCounts(prisma, apId);
  const total = Object.values(votes).reduce((sum, count3) => sum + count3, 0);
  return c.json({ success: true, votes, total, user_vote: body.option_index });
});
stories2.post("/:id/like", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const storyId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith("http") ? storyId : objectApId(baseUrl, storyId);
  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: "Story"
    }
  });
  if (!story)
    return c.json({ error: "Story not found" }, 404);
  const existing = await prisma.like.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: apId
      }
    }
  });
  if (existing) {
    return c.json({ success: true, liked: true, like_count: story.likeCount });
  }
  const likeId = generateId();
  const likeActivityApId = activityApId(baseUrl, likeId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await prisma.like.create({
    data: {
      actorApId: actor.ap_id,
      objectApId: apId,
      activityApId: likeActivityApId,
      createdAt: now
    }
  });
  await prisma.object.update({
    where: { apId },
    data: { likeCount: { increment: 1 } }
  });
  const likeActivityRaw = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: likeActivityApId,
    type: "Like",
    actor: actor.ap_id,
    object: apId
  };
  await prisma.activity.create({
    data: {
      apId: likeActivityApId,
      type: "Like",
      actorApId: actor.ap_id,
      objectApId: apId,
      rawJson: JSON.stringify(likeActivityRaw),
      createdAt: now
    }
  });
  if (story.attributedTo !== actor.ap_id && isLocal(story.attributedTo, baseUrl)) {
    await prisma.inbox.create({
      data: {
        actorApId: story.attributedTo,
        activityApId: likeActivityApId,
        read: 0,
        createdAt: now
      }
    });
  }
  if (!isLocal(apId, baseUrl)) {
    try {
      const postAuthor = await prisma.actorCache.findUnique({
        where: { apId: story.attributedTo },
        select: { inbox: true }
      });
      if (postAuthor?.inbox) {
        if (!isSafeRemoteUrl(postAuthor.inbox)) {
          console.warn(`[Stories] Blocked unsafe inbox URL: ${postAuthor.inbox}`);
        } else {
          const keyId = `${actor.ap_id}#main-key`;
          const headers = await signRequest(actor.private_key_pem, keyId, "POST", postAuthor.inbox, JSON.stringify(likeActivityRaw));
          await fetch(postAuthor.inbox, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/activity+json" },
            body: JSON.stringify(likeActivityRaw)
          });
        }
      }
    } catch (e) {
      console.error("Failed to send Like activity for story:", e);
    }
  }
  return c.json({ success: true, liked: true, like_count: story.likeCount + 1 });
});
stories2.delete("/:id/like", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const storyId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith("http") ? storyId : objectApId(baseUrl, storyId);
  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: "Story"
    }
  });
  if (!story)
    return c.json({ error: "Story not found" }, 404);
  const like = await prisma.like.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: apId
      }
    }
  });
  if (!like)
    return c.json({ error: "Not liked" }, 400);
  await prisma.like.delete({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: apId
      }
    }
  });
  await prisma.object.update({
    where: { apId },
    data: {
      likeCount: { decrement: 1 }
    }
  });
  if (!isLocal(apId, baseUrl)) {
    try {
      const postAuthor = await prisma.actorCache.findUnique({
        where: { apId: story.attributedTo },
        select: { inbox: true }
      });
      if (postAuthor?.inbox) {
        if (!isSafeRemoteUrl(postAuthor.inbox)) {
          console.warn(`[Stories] Blocked unsafe inbox URL: ${postAuthor.inbox}`);
          return c.json({ success: true, liked: false });
        }
        const undoObject = like.activityApId ? like.activityApId : {
          type: "Like",
          actor: actor.ap_id,
          object: apId
        };
        const undoLikeActivity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: activityApId(baseUrl, generateId()),
          type: "Undo",
          actor: actor.ap_id,
          object: undoObject
        };
        const keyId = `${actor.ap_id}#main-key`;
        const headers = await signRequest(actor.private_key_pem, keyId, "POST", postAuthor.inbox, JSON.stringify(undoLikeActivity));
        await fetch(postAuthor.inbox, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/activity+json" },
          body: JSON.stringify(undoLikeActivity)
        });
        await prisma.activity.create({
          data: {
            apId: undoLikeActivity.id,
            type: "Undo",
            actorApId: actor.ap_id,
            objectApId: apId,
            rawJson: JSON.stringify(undoLikeActivity),
            direction: "outbound"
          }
        });
      }
    } catch (e) {
      console.error("Failed to send Undo Like for story:", e);
    }
  }
  return c.json({ success: true, liked: false, like_count: Math.max(0, story.likeCount - 1) });
});
stories2.post("/:id/share", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const storyId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith("http") ? storyId : objectApId(baseUrl, storyId);
  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: "Story"
    }
  });
  if (!story)
    return c.json({ error: "Story not found" }, 404);
  const existing = await prisma.storyShare.findFirst({
    where: {
      storyApId: apId,
      actorApId: actor.ap_id
    }
  });
  if (existing) {
    return c.json({ success: true, shared: true, share_count: story.shareCount || 0 });
  }
  const shareId = generateId();
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await prisma.storyShare.create({
    data: {
      id: shareId,
      storyApId: apId,
      actorApId: actor.ap_id,
      sharedAt: now
    }
  });
  await prisma.object.update({
    where: { apId },
    data: { shareCount: { increment: 1 } }
  });
  return c.json({ success: true, shared: true, share_count: (story.shareCount || 0) + 1 });
});
stories2.get("/:id/shares", async (c) => {
  const prisma = c.get("prisma");
  const storyId = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith("http") ? storyId : objectApId(baseUrl, storyId);
  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: "Story"
    },
    select: {
      shareCount: true
    }
  });
  if (!story)
    return c.json({ error: "Story not found" }, 404);
  return c.json({ share_count: story.shareCount || 0 });
});
stories2.get("/:id/votes", async (c) => {
  const prisma = c.get("prisma");
  const storyId = c.req.param("id");
  const actor = c.get("actor");
  const baseUrl = c.env.APP_URL;
  const apId = objectApId(baseUrl, storyId);
  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: "Story"
    }
  });
  if (!story)
    return c.json({ error: "Story not found" }, 404);
  const votes = await getVoteCounts(prisma, apId);
  const total = Object.values(votes).reduce((sum, count3) => sum + count3, 0);
  let user_vote;
  if (actor) {
    const userVote = await prisma.storyVote.findFirst({
      where: {
        storyApId: apId,
        actorApId: actor.ap_id
      },
      select: {
        optionIndex: true
      }
    });
    if (userVote) {
      user_vote = userVote.optionIndex;
    }
  }
  return c.json({ votes, total, user_vote });
});
var interactions_default2 = stories2;

// src/backend/routes/stories.ts
var stories3 = new Hono2();
stories3.route("/", base_default2);
stories3.route("/", interactions_default2);
var stories_default = stories3;

// src/backend/routes/search.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var search = new Hono2();
var ALLOWED_ACTOR_SORTS = ["relevance", "followers", "recent"];
var ALLOWED_POST_SORTS = ["recent", "popular"];
function validateActorSort(sort) {
  if (sort && ALLOWED_ACTOR_SORTS.includes(sort)) {
    return sort;
  }
  return "relevance";
}
__name(validateActorSort, "validateActorSort");
function validatePostSort(sort) {
  if (sort && ALLOWED_POST_SORTS.includes(sort)) {
    return sort;
  }
  return "recent";
}
__name(validatePostSort, "validatePostSort");
search.get("/actors", async (c) => {
  const query = c.req.query("q")?.trim();
  const sort = validateActorSort(c.req.query("sort"));
  if (!query)
    return c.json({ actors: [] });
  const prisma = c.get("prisma");
  const lowerQuery = query.toLowerCase();
  let orderBy;
  switch (sort) {
    case "followers":
      orderBy = { followerCount: "desc" };
      break;
    case "recent":
      orderBy = { createdAt: "desc" };
      break;
    case "relevance":
    default:
      orderBy = { followerCount: "desc" };
      break;
  }
  const actors2 = await prisma.actor.findMany({
    where: {
      OR: [
        { preferredUsername: { contains: query } },
        { name: { contains: query } }
      ]
    },
    select: {
      apId: true,
      preferredUsername: true,
      name: true,
      iconUrl: true,
      summary: true,
      followerCount: true,
      createdAt: true
    },
    orderBy,
    take: 20
  });
  let sortedActors = actors2;
  if (sort === "relevance") {
    sortedActors = actors2.sort((a, b) => {
      const aUsername = a.preferredUsername.toLowerCase();
      const bUsername = b.preferredUsername.toLowerCase();
      const aExact = aUsername === lowerQuery ? 0 : 1;
      const bExact = bUsername === lowerQuery ? 0 : 1;
      if (aExact !== bExact)
        return aExact - bExact;
      const aPrefix = aUsername.startsWith(lowerQuery) ? 0 : 1;
      const bPrefix = bUsername.startsWith(lowerQuery) ? 0 : 1;
      if (aPrefix !== bPrefix)
        return aPrefix - bPrefix;
      return b.followerCount - a.followerCount;
    });
  }
  const result = sortedActors.map((a) => ({
    ap_id: a.apId,
    preferred_username: a.preferredUsername,
    name: a.name,
    icon_url: a.iconUrl,
    summary: a.summary,
    follower_count: a.followerCount,
    created_at: a.createdAt,
    username: formatUsername(a.apId)
  }));
  return c.json({ actors: result });
});
search.get("/posts", async (c) => {
  const actor = c.get("actor");
  const query = c.req.query("q")?.trim();
  const sort = validatePostSort(c.req.query("sort"));
  if (!query)
    return c.json({ posts: [] });
  const prisma = c.get("prisma");
  let orderBy;
  switch (sort) {
    case "popular":
      orderBy = [{ likeCount: "desc" }, { published: "desc" }];
      break;
    case "recent":
    default:
      orderBy = [{ published: "desc" }];
      break;
  }
  const posts4 = await prisma.object.findMany({
    where: {
      content: { contains: query },
      visibility: "public",
      OR: [
        { audienceJson: { equals: "[]" } }
      ]
    },
    orderBy,
    take: 50
  });
  const authorApIds = [...new Set(posts4.map((p) => p.attributedTo))];
  const [localAuthors, cachedAuthors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    })
  ]);
  const localAuthorMap = new Map(localAuthors.map((a) => [a.apId, a]));
  const cachedAuthorMap = new Map(cachedAuthors.map((a) => [a.apId, a]));
  const likedPostIds = /* @__PURE__ */ new Set();
  if (actor?.ap_id) {
    const postApIds = posts4.map((p) => p.apId);
    const likes = await prisma.like.findMany({
      where: {
        actorApId: actor.ap_id,
        objectApId: { in: postApIds }
      },
      select: { objectApId: true }
    });
    likes.forEach((l) => likedPostIds.add(l.objectApId));
  }
  const result = posts4.map((p) => {
    const author = localAuthorMap.get(p.attributedTo) || cachedAuthorMap.get(p.attributedTo);
    return {
      ap_id: p.apId,
      author: {
        ap_id: p.attributedTo,
        username: formatUsername(p.attributedTo),
        preferred_username: author?.preferredUsername || null,
        name: author?.name || null,
        icon_url: author?.iconUrl || null
      },
      content: p.content,
      published: p.published,
      like_count: p.likeCount,
      liked: likedPostIds.has(p.apId)
    };
  });
  return c.json({ posts: result });
});
search.get("/remote", async (c) => {
  const query = c.req.query("q")?.trim();
  if (!query)
    return c.json({ actors: [] });
  const match2 = query.match(/^@?([^@]+)@([^@]+)$/);
  if (!match2)
    return c.json({ actors: [] });
  const [, username, domain2] = match2;
  const safeDomain = normalizeRemoteDomain(domain2);
  if (!safeDomain)
    return c.json({ actors: [] });
  try {
    const webfingerUrl = `https://${safeDomain}/.well-known/webfinger?resource=acct:${username}@${safeDomain}`;
    const wfRes = await fetch(webfingerUrl, { headers: { Accept: "application/jrd+json" } });
    if (!wfRes.ok)
      return c.json({ actors: [] });
    const wfData = await wfRes.json();
    const actorLink = wfData.links?.find((l) => l.rel === "self" && l.type === "application/activity+json");
    if (!actorLink?.href)
      return c.json({ actors: [] });
    if (!isSafeRemoteUrl(actorLink.href))
      return c.json({ actors: [] });
    const actorRes = await fetch(actorLink.href, {
      headers: { Accept: "application/activity+json, application/ld+json" }
    });
    if (!actorRes.ok)
      return c.json({ actors: [] });
    const actorData = await actorRes.json();
    const prisma = c.get("prisma");
    await prisma.actorCache.upsert({
      where: { apId: actorData.id },
      create: {
        apId: actorData.id,
        type: actorData.type || "Person",
        preferredUsername: actorData.preferredUsername || null,
        name: actorData.name || null,
        summary: actorData.summary || null,
        iconUrl: actorData.icon?.url || null,
        inbox: actorData.inbox || "",
        outbox: actorData.outbox || null,
        publicKeyId: actorData.publicKey?.id || null,
        publicKeyPem: actorData.publicKey?.publicKeyPem || null,
        rawJson: JSON.stringify(actorData)
      },
      update: {
        type: actorData.type || "Person",
        preferredUsername: actorData.preferredUsername || null,
        name: actorData.name || null,
        summary: actorData.summary || null,
        iconUrl: actorData.icon?.url || null,
        inbox: actorData.inbox || "",
        outbox: actorData.outbox || null,
        publicKeyId: actorData.publicKey?.id || null,
        publicKeyPem: actorData.publicKey?.publicKeyPem || null,
        rawJson: JSON.stringify(actorData)
      }
    });
    return c.json({
      actors: [
        {
          ap_id: actorData.id,
          username: `${actorData.preferredUsername}@${safeDomain}`,
          preferred_username: actorData.preferredUsername,
          name: actorData.name,
          summary: actorData.summary,
          icon_url: actorData.icon?.url
        }
      ]
    });
  } catch (e) {
    console.error("Remote search failed:", e);
    return c.json({ actors: [] });
  }
});
search.get("/hashtag/:tag", async (c) => {
  const actor = c.get("actor");
  const tag = c.req.param("tag")?.trim().replace(/^#/, "");
  const sort = validatePostSort(c.req.query("sort"));
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = parseInt(c.req.query("offset") || "0");
  if (!tag)
    return c.json({ posts: [], total: 0 });
  const prisma = c.get("prisma");
  const hashtagPattern = `#${tag}`;
  let orderBy;
  switch (sort) {
    case "popular":
      orderBy = [{ likeCount: "desc" }, { published: "desc" }];
      break;
    case "recent":
    default:
      orderBy = [{ published: "desc" }];
      break;
  }
  const total = await prisma.object.count({
    where: {
      content: { contains: hashtagPattern },
      visibility: "public"
    }
  });
  const posts4 = await prisma.object.findMany({
    where: {
      content: { contains: hashtagPattern },
      visibility: "public"
    },
    orderBy,
    skip: offset,
    take: limit
  });
  const authorApIds = [...new Set(posts4.map((p) => p.attributedTo))];
  const [localAuthors, cachedAuthors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    })
  ]);
  const localAuthorMap = new Map(localAuthors.map((a) => [a.apId, a]));
  const cachedAuthorMap = new Map(cachedAuthors.map((a) => [a.apId, a]));
  const likedPostIds = /* @__PURE__ */ new Set();
  if (actor?.ap_id) {
    const postApIds = posts4.map((p) => p.apId);
    const likes = await prisma.like.findMany({
      where: {
        actorApId: actor.ap_id,
        objectApId: { in: postApIds }
      },
      select: { objectApId: true }
    });
    likes.forEach((l) => likedPostIds.add(l.objectApId));
  }
  const result = posts4.map((p) => {
    const author = localAuthorMap.get(p.attributedTo) || cachedAuthorMap.get(p.attributedTo);
    return {
      ap_id: p.apId,
      author: {
        ap_id: p.attributedTo,
        username: formatUsername(p.attributedTo),
        preferred_username: author?.preferredUsername || null,
        name: author?.name || null,
        icon_url: author?.iconUrl || null
      },
      content: p.content,
      published: p.published,
      like_count: p.likeCount,
      liked: likedPostIds.has(p.apId)
    };
  });
  return c.json({
    posts: result,
    total,
    limit,
    offset,
    has_more: offset + result.length < total
  });
});
search.get("/hashtags/trending", async (c) => {
  const limit = Math.min(parseInt(c.req.query("limit") || "10"), 50);
  const days = Math.min(parseInt(c.req.query("days") || "7"), 30);
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1e3).toISOString();
  const prisma = c.get("prisma");
  const posts4 = await prisma.object.findMany({
    where: {
      visibility: "public",
      published: { gt: sinceDate }
    },
    select: { content: true },
    orderBy: { published: "desc" },
    take: 1e3
  });
  const hashtagCounts = {};
  const hashtagRegex = /#([a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+)/g;
  for (const post of posts4) {
    const content = post.content || "";
    let match2;
    while ((match2 = hashtagRegex.exec(content)) !== null) {
      const tagName = match2[1].toLowerCase();
      hashtagCounts[tagName] = (hashtagCounts[tagName] || 0) + 1;
    }
  }
  const trending = Object.entries(hashtagCounts).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([tagName, count3]) => ({ tag: tagName, count: count3 }));
  return c.json({ trending });
});
var search_default = search;

// src/backend/routes/communities.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/communities/base.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/communities/utils.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var MAX_COMMUNITY_MESSAGE_LENGTH = 5e3;
var MAX_COMMUNITY_MESSAGES_LIMIT = 100;
var managerRoles = /* @__PURE__ */ new Set(["owner", "moderator"]);

// src/backend/routes/communities/base.ts
var communities = new Hono2();
communities.get("/", async (c) => {
  const actor = c.get("actor");
  const prisma = c.get("prisma");
  const limit = Math.min(parseInt(c.req.query("limit") || "100"), 500);
  const offset = parseInt(c.req.query("offset") || "0");
  const actorApIdVal = actor?.ap_id || "";
  const communitiesList = await prisma.community.findMany({
    orderBy: [
      { lastMessageAt: { sort: "desc", nulls: "last" } },
      { createdAt: "asc" }
    ],
    take: limit,
    skip: offset
  });
  const communityApIds = communitiesList.map((c2) => c2.apId);
  const membershipSet = /* @__PURE__ */ new Set();
  const pendingRequestSet = /* @__PURE__ */ new Set();
  if (actorApIdVal && communityApIds.length > 0) {
    const [memberships, joinRequests] = await Promise.all([
      prisma.communityMember.findMany({
        where: { actorApId: actorApIdVal, communityApId: { in: communityApIds } },
        select: { communityApId: true }
      }),
      prisma.communityJoinRequest.findMany({
        where: { actorApId: actorApIdVal, communityApId: { in: communityApIds }, status: "pending" },
        select: { communityApId: true }
      })
    ]);
    memberships.forEach((m) => membershipSet.add(m.communityApId));
    joinRequests.forEach((r) => pendingRequestSet.add(r.communityApId));
  }
  const result = communitiesList.map((community) => {
    const isMember = membershipSet.has(community.apId);
    const joinStatus = !isMember && pendingRequestSet.has(community.apId) ? "pending" : null;
    return {
      ap_id: community.apId,
      name: community.preferredUsername,
      display_name: community.name,
      summary: community.summary,
      icon_url: community.iconUrl,
      visibility: community.visibility,
      join_policy: community.joinPolicy,
      post_policy: community.postPolicy,
      member_count: community.memberCount,
      created_at: community.createdAt,
      last_message_at: community.lastMessageAt,
      is_member: isMember,
      join_status: joinStatus
    };
  });
  return c.json({ communities: result });
});
communities.post("/", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  const name2 = body.name?.trim();
  if (!name2 || name2.length < 2) {
    return c.json({ error: "Name must be at least 2 characters" }, 400);
  }
  if (name2.length > 32) {
    return c.json({ error: "Name must be at most 32 characters" }, 400);
  }
  if (!/^[a-zA-Z0-9_]+$/.test(name2)) {
    return c.json({ error: "Name can only contain letters, numbers, and underscores" }, 400);
  }
  const reservedNames = [
    "admin",
    "administrator",
    "system",
    "root",
    "moderator",
    "mod",
    "community",
    "communities",
    "group",
    "groups",
    "user",
    "users",
    "api",
    "ap",
    "activitypub",
    "webfinger",
    "well_known",
    "settings",
    "config",
    "configuration",
    "help",
    "support",
    "about",
    "terms",
    "privacy",
    "legal",
    "dmca",
    "copyright",
    "login",
    "logout",
    "register",
    "signup",
    "signin",
    "auth",
    "null",
    "undefined",
    "true",
    "false",
    "test",
    "demo"
  ];
  if (reservedNames.includes(name2.toLowerCase())) {
    return c.json({ error: "This name is reserved" }, 400);
  }
  if (/^\d+$/.test(name2)) {
    return c.json({ error: "Name cannot be all numbers" }, 400);
  }
  if (name2.startsWith("_") || name2.endsWith("_")) {
    return c.json({ error: "Name cannot start or end with underscore" }, 400);
  }
  const baseUrl = c.env.APP_URL;
  const apId = communityApId(baseUrl, name2);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const inbox = `${apId}/inbox`;
  const outbox = `${apId}/outbox`;
  const followersUrl = `${apId}/followers`;
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.community.create({
        data: {
          apId,
          preferredUsername: name2,
          name: body.display_name || name2,
          summary: body.summary || "",
          inbox,
          outbox,
          followersUrl,
          publicKeyPem,
          privateKeyPem,
          visibility: "public",
          joinPolicy: "open",
          postPolicy: "members",
          memberCount: 1,
          createdBy: actor.ap_id,
          createdAt: now
        }
      });
      await tx.communityMember.create({
        data: {
          communityApId: apId,
          actorApId: actor.ap_id,
          role: "owner",
          joinedAt: now
        }
      });
    });
  } catch (error3) {
    if (error3 && typeof error3 === "object" && "code" in error3 && error3.code === "P2002") {
      return c.json({ error: "Community name already taken" }, 409);
    }
    throw error3;
  }
  return c.json({
    community: {
      ap_id: apId,
      name: body.name,
      display_name: body.display_name || body.name,
      summary: body.summary || "",
      icon_url: null,
      visibility: "public",
      join_policy: "open",
      post_policy: "members",
      member_count: 1,
      created_at: now,
      is_member: true
    }
  }, 201);
});
communities.get("/:identifier", async (c) => {
  const identifier = c.req.param("identifier");
  const actor = c.get("actor");
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  let apId;
  if (identifier.startsWith("http")) {
    apId = identifier;
  } else {
    apId = communityApId(baseUrl, identifier);
  }
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier }
      ]
    }
  });
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }
  let isMember = false;
  let memberRole = null;
  let joinStatus = null;
  if (actor) {
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (membership) {
      isMember = true;
      memberRole = membership.role;
    } else {
      const joinRequest = await prisma.communityJoinRequest.findUnique({
        where: {
          communityApId_actorApId: {
            communityApId: community.apId,
            actorApId: actor.ap_id
          }
        }
      });
      if (joinRequest?.status === "pending") {
        joinStatus = "pending";
      }
    }
  }
  const memberCountResult = await prisma.communityMember.count({
    where: { communityApId: community.apId }
  });
  const postsCount = await prisma.object.count({
    where: { communityApId: community.apId }
  });
  return c.json({
    community: {
      ap_id: community.apId,
      name: community.preferredUsername,
      display_name: community.name,
      summary: community.summary,
      icon_url: community.iconUrl,
      visibility: community.visibility,
      join_policy: community.joinPolicy,
      post_policy: community.postPolicy,
      member_count: memberCountResult || community.memberCount || 0,
      post_count: postsCount || 0,
      created_by: community.createdBy,
      created_at: community.createdAt,
      is_member: isMember,
      member_role: memberRole,
      join_status: joinStatus
    }
  });
});
communities.patch("/:identifier/settings", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const identifier = c.req.param("identifier");
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith("http") ? identifier : communityApId(baseUrl, identifier);
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier }
      ]
    },
    select: { apId: true }
  });
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }
  const member = await prisma.communityMember.findUnique({
    where: {
      communityApId_actorApId: {
        communityApId: community.apId,
        actorApId: actor.ap_id
      }
    }
  });
  if (!member || !managerRoles.has(member.role)) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const body = await c.req.json();
  const updates = {};
  if (body.display_name !== void 0) {
    updates.name = body.display_name;
  }
  if (body.summary !== void 0) {
    updates.summary = body.summary;
  }
  if (body.icon_url !== void 0) {
    updates.iconUrl = body.icon_url;
  }
  if (body.visibility !== void 0) {
    if (!["public", "private"].includes(body.visibility)) {
      return c.json({ error: "Invalid visibility" }, 400);
    }
    updates.visibility = body.visibility;
  }
  if (body.join_policy !== void 0) {
    if (!["open", "approval", "invite"].includes(body.join_policy)) {
      return c.json({ error: "Invalid join_policy" }, 400);
    }
    updates.joinPolicy = body.join_policy;
  }
  if (body.post_policy !== void 0) {
    if (!["anyone", "members", "mods", "owners"].includes(body.post_policy)) {
      return c.json({ error: "Invalid post_policy" }, 400);
    }
    updates.postPolicy = body.post_policy;
  }
  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }
  await prisma.community.update({
    where: { apId: community.apId },
    data: updates
  });
  return c.json({ success: true });
});
var base_default3 = communities;

// src/backend/routes/communities/membership.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/communities/membership-invites.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/communities/membership-shared.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function resolveCommunityApId(baseUrl, identifier) {
  return identifier.startsWith("http") ? identifier : communityApId(baseUrl, identifier);
}
__name(resolveCommunityApId, "resolveCommunityApId");
async function fetchCommunityDetails(c, identifier) {
  const prisma = c.get("prisma");
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier }
      ]
    }
  });
  return { apId, community };
}
__name(fetchCommunityDetails, "fetchCommunityDetails");
async function fetchCommunityId(c, identifier) {
  const prisma = c.get("prisma");
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier }
      ]
    },
    select: { apId: true }
  });
  return { apId, community };
}
__name(fetchCommunityId, "fetchCommunityId");

// src/backend/routes/communities/membership-invites.ts
function registerMembershipInviteRoutes(communities5) {
  communities5.get("/:identifier/invites", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const prisma = c.get("prisma");
    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const member = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!member || !managerRoles.has(member.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const invites = await prisma.communityInvite.findMany({
      where: { communityApId: community.apId },
      orderBy: { createdAt: "desc" }
    });
    const invitedByApIds = [...new Set(invites.map((inv) => inv.invitedByApId))];
    const [localActors, cachedActors] = await Promise.all([
      prisma.actor.findMany({
        where: { apId: { in: invitedByApIds } },
        select: { apId: true, preferredUsername: true, name: true }
      }),
      prisma.actorCache.findMany({
        where: { apId: { in: invitedByApIds } },
        select: { apId: true, preferredUsername: true, name: true }
      })
    ]);
    const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
    const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
    const result = invites.map((inv) => {
      const invitedByInfo = localActorMap.get(inv.invitedByApId) || cachedActorMap.get(inv.invitedByApId);
      return {
        id: inv.id,
        invited_ap_id: inv.invitedApId,
        invited_by: {
          ap_id: inv.invitedByApId,
          username: formatUsername(inv.invitedByApId),
          preferred_username: invitedByInfo?.preferredUsername || null,
          name: invitedByInfo?.name || null
        },
        created_at: inv.createdAt,
        expires_at: inv.expiresAt,
        used_at: inv.usedAt,
        used_by_ap_id: inv.usedByApId,
        is_valid: !inv.usedAt && (!inv.expiresAt || new Date(inv.expiresAt) > /* @__PURE__ */ new Date())
      };
    });
    return c.json({ invites: result });
  });
  communities5.post("/:identifier/invites", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const prisma = c.get("prisma");
    let invitedApId = null;
    let expiresInHours = null;
    try {
      const body = await c.req.json();
      invitedApId = body.invited_ap_id?.trim() || null;
      expiresInHours = body.expires_in_hours || null;
    } catch {
      invitedApId = null;
      expiresInHours = null;
    }
    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const member = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!member || !managerRoles.has(member.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const inviteId = generateId();
    const now = /* @__PURE__ */ new Date();
    const expiresAt = expiresInHours ? new Date(now.getTime() + expiresInHours * 60 * 60 * 1e3).toISOString() : null;
    await prisma.communityInvite.create({
      data: {
        id: inviteId,
        communityApId: community.apId,
        invitedByApId: actor.ap_id,
        invitedApId,
        createdAt: now.toISOString(),
        expiresAt
      }
    });
    return c.json({ invite_id: inviteId, expires_at: expiresAt });
  });
  communities5.delete("/:identifier/invites/:inviteId", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const inviteId = c.req.param("inviteId");
    const prisma = c.get("prisma");
    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const member = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!member || !managerRoles.has(member.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const invite = await prisma.communityInvite.findFirst({
      where: {
        id: inviteId,
        communityApId: community.apId
      }
    });
    if (!invite) {
      return c.json({ error: "Invite not found" }, 404);
    }
    await prisma.communityInvite.delete({
      where: { id: inviteId }
    });
    return c.json({ success: true });
  });
}
__name(registerMembershipInviteRoutes, "registerMembershipInviteRoutes");

// src/backend/routes/communities/membership-join.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function registerMembershipJoinRoutes(communities5) {
  communities5.post("/:identifier/join", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const prisma = c.get("prisma");
    let inviteId;
    try {
      const body = await c.req.json();
      inviteId = body.invite_id?.trim() || void 0;
    } catch {
      inviteId = void 0;
    }
    const { community } = await fetchCommunityDetails(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const existing = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (existing) {
      return c.json({ error: "Already a member" }, 409);
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (community.joinPolicy === "approval") {
      await prisma.communityJoinRequest.upsert({
        where: {
          communityApId_actorApId: {
            communityApId: community.apId,
            actorApId: actor.ap_id
          }
        },
        create: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
          status: "pending",
          createdAt: now
        },
        update: {
          status: "pending",
          createdAt: now,
          processedAt: null
        }
      });
      return c.json({ success: true, status: "pending" });
    }
    if (community.joinPolicy === "invite") {
      if (!inviteId) {
        return c.json({ error: "Invite required", status: "invite_required" }, 403);
      }
      const invite = await prisma.communityInvite.findFirst({
        where: {
          id: inviteId,
          communityApId: community.apId,
          usedAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: (/* @__PURE__ */ new Date()).toISOString() } }
          ]
        }
      });
      if (!invite) {
        return c.json({ error: "Invalid or expired invite", status: "invite_required" }, 403);
      }
      if (invite.invitedApId && invite.invitedApId !== actor.ap_id) {
        return c.json({ error: "Invite not for this account", status: "invite_required" }, 403);
      }
      await prisma.communityMember.create({
        data: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
          role: "member",
          joinedAt: now
        }
      });
      await prisma.community.update({
        where: { apId: community.apId },
        data: { memberCount: { increment: 1 } }
      });
      await prisma.communityInvite.update({
        where: { id: inviteId },
        data: {
          usedByApId: actor.ap_id,
          usedAt: now
        }
      });
      return c.json({ success: true, status: "joined" });
    }
    await prisma.communityMember.create({
      data: {
        communityApId: community.apId,
        actorApId: actor.ap_id,
        role: "member",
        joinedAt: now
      }
    });
    await prisma.community.update({
      where: { apId: community.apId },
      data: { memberCount: { increment: 1 } }
    });
    return c.json({ success: true, status: "joined" });
  });
  communities5.post("/:identifier/leave", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const prisma = c.get("prisma");
    const { community } = await fetchCommunityDetails(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const membership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!membership) {
      return c.json({ error: "Not a member" }, 400);
    }
    if (membership.role === "owner") {
      const ownerCount = await prisma.communityMember.count({
        where: {
          communityApId: community.apId,
          role: "owner"
        }
      });
      if (ownerCount <= 1) {
        return c.json({ error: "Cannot leave: you are the only owner" }, 400);
      }
    }
    await prisma.communityMember.delete({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    await prisma.community.update({
      where: { apId: community.apId },
      data: { memberCount: { decrement: 1 } }
    });
    return c.json({ success: true });
  });
}
__name(registerMembershipJoinRoutes, "registerMembershipJoinRoutes");

// src/backend/routes/communities/membership-members.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function registerMembershipMemberRoutes(communities5) {
  communities5.delete("/:identifier/members/:actorApId", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const targetApId = decodeURIComponent(c.req.param("actorApId"));
    const prisma = c.get("prisma");
    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const actorMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!actorMembership || !managerRoles.has(actorMembership.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const targetMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: targetApId
        }
      }
    });
    if (!targetMembership) {
      return c.json({ error: "User is not a member" }, 404);
    }
    if (targetMembership.role === "owner" && actorMembership.role !== "owner") {
      return c.json({ error: "Only owners can remove other owners" }, 403);
    }
    if (targetApId === actor.ap_id) {
      return c.json({ error: "Use /leave endpoint to leave the community" }, 400);
    }
    await prisma.communityMember.delete({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: targetApId
        }
      }
    });
    await prisma.community.update({
      where: { apId: community.apId },
      data: { memberCount: { decrement: 1 } }
    });
    return c.json({ success: true });
  });
  communities5.patch("/:identifier/members/:actorApId", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const targetApId = decodeURIComponent(c.req.param("actorApId"));
    const prisma = c.get("prisma");
    const body = await c.req.json();
    if (!body.role || !["owner", "moderator", "member"].includes(body.role)) {
      return c.json({ error: "Invalid role" }, 400);
    }
    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const actorMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!actorMembership || actorMembership.role !== "owner") {
      return c.json({ error: "Only owners can change member roles" }, 403);
    }
    const targetMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: targetApId
        }
      }
    });
    if (!targetMembership) {
      return c.json({ error: "User is not a member" }, 404);
    }
    if (targetApId === actor.ap_id && targetMembership.role === "owner" && body.role !== "owner") {
      const ownerCount = await prisma.communityMember.count({
        where: {
          communityApId: community.apId,
          role: "owner"
        }
      });
      if (ownerCount <= 1) {
        return c.json({ error: "Cannot demote: you are the only owner" }, 400);
      }
    }
    await prisma.communityMember.update({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: targetApId
        }
      },
      data: { role: body.role }
    });
    return c.json({ success: true });
  });
  communities5.get("/:identifier/members", async (c) => {
    const identifier = c.req.param("identifier");
    const prisma = c.get("prisma");
    const baseUrl = c.env.APP_URL;
    const apId = resolveCommunityApId(baseUrl, identifier);
    const community = await prisma.community.findFirst({
      where: {
        OR: [
          { apId },
          { preferredUsername: identifier }
        ]
      },
      select: { apId: true }
    });
    if (!community) {
      return c.json({ members: [] });
    }
    const members = await prisma.communityMember.findMany({
      where: { communityApId: community.apId },
      orderBy: [
        { role: "desc" },
        { joinedAt: "asc" }
      ]
    });
    const memberApIds = members.map((m) => m.actorApId);
    const [localActors, cachedActors] = await Promise.all([
      prisma.actor.findMany({
        where: { apId: { in: memberApIds } },
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
      }),
      prisma.actorCache.findMany({
        where: { apId: { in: memberApIds } },
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
      })
    ]);
    const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
    const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
    const result = members.map((m) => {
      const actorInfo = localActorMap.get(m.actorApId) || cachedActorMap.get(m.actorApId);
      return {
        ap_id: m.actorApId,
        username: formatUsername(m.actorApId),
        preferred_username: actorInfo?.preferredUsername || null,
        name: actorInfo?.name || null,
        icon_url: actorInfo?.iconUrl || null,
        role: m.role,
        joined_at: m.joinedAt
      };
    });
    return c.json({ members: result });
  });
  communities5.post("/:identifier/members/batch/remove", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const prisma = c.get("prisma");
    const body = await c.req.json();
    if (!body.actor_ap_ids || body.actor_ap_ids.length === 0) {
      return c.json({ error: "actor_ap_ids array is required" }, 400);
    }
    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const actorMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!actorMembership || !managerRoles.has(actorMembership.role)) {
      return c.json({ error: "Permission denied" }, 403);
    }
    const results = [];
    for (const targetApId of body.actor_ap_ids) {
      try {
        if (targetApId === actor.ap_id) {
          results.push({ ap_id: targetApId, success: false, error: "Cannot remove yourself" });
          continue;
        }
        const targetMembership = await prisma.communityMember.findUnique({
          where: {
            communityApId_actorApId: {
              communityApId: community.apId,
              actorApId: targetApId
            }
          }
        });
        if (!targetMembership) {
          results.push({ ap_id: targetApId, success: false, error: "Not a member" });
          continue;
        }
        if (actorMembership.role !== "owner" && targetMembership.role === "owner") {
          results.push({ ap_id: targetApId, success: false, error: "Cannot remove owner" });
          continue;
        }
        await prisma.communityMember.delete({
          where: {
            communityApId_actorApId: {
              communityApId: community.apId,
              actorApId: targetApId
            }
          }
        });
        results.push({ ap_id: targetApId, success: true });
      } catch {
        results.push({ ap_id: targetApId, success: false, error: "Internal error" });
      }
    }
    const removedCount = results.filter((r) => r.success).length;
    if (removedCount > 0) {
      await prisma.community.update({
        where: { apId: community.apId },
        data: { memberCount: { decrement: removedCount } }
      });
    }
    return c.json({ results, removed_count: removedCount });
  });
  communities5.post("/:identifier/members/batch/role", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const prisma = c.get("prisma");
    const body = await c.req.json();
    if (!body.actor_ap_ids || body.actor_ap_ids.length === 0) {
      return c.json({ error: "actor_ap_ids array is required" }, 400);
    }
    if (!body.role || !["owner", "moderator", "member"].includes(body.role)) {
      return c.json({ error: "Valid role is required" }, 400);
    }
    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const actorMembership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!actorMembership || actorMembership.role !== "owner") {
      return c.json({ error: "Only owners can change roles" }, 403);
    }
    const results = [];
    for (const targetApId of body.actor_ap_ids) {
      try {
        const targetMembership = await prisma.communityMember.findUnique({
          where: {
            communityApId_actorApId: {
              communityApId: community.apId,
              actorApId: targetApId
            }
          }
        });
        if (!targetMembership) {
          results.push({ ap_id: targetApId, success: false, error: "Not a member" });
          continue;
        }
        if (targetApId === actor.ap_id && targetMembership.role === "owner" && body.role !== "owner") {
          const ownerCount = await prisma.communityMember.count({
            where: {
              communityApId: community.apId,
              role: "owner"
            }
          });
          if (ownerCount <= 1) {
            results.push({ ap_id: targetApId, success: false, error: "Cannot demote: only owner" });
            continue;
          }
        }
        await prisma.communityMember.update({
          where: {
            communityApId_actorApId: {
              communityApId: community.apId,
              actorApId: targetApId
            }
          },
          data: { role: body.role }
        });
        results.push({ ap_id: targetApId, success: true });
      } catch {
        results.push({ ap_id: targetApId, success: false, error: "Internal error" });
      }
    }
    return c.json({ results, updated_count: results.filter((r) => r.success).length });
  });
}
__name(registerMembershipMemberRoutes, "registerMembershipMemberRoutes");

// src/backend/routes/communities/membership-requests.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function registerMembershipRequestRoutes(communities5) {
  communities5.get("/:identifier/requests", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const prisma = c.get("prisma");
    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const member = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!member || !managerRoles.has(member.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const requests = await prisma.communityJoinRequest.findMany({
      where: {
        communityApId: community.apId,
        status: "pending"
      },
      orderBy: { createdAt: "desc" }
    });
    const requestActorApIds = requests.map((r) => r.actorApId);
    const [localActors, cachedActors] = await Promise.all([
      prisma.actor.findMany({
        where: { apId: { in: requestActorApIds } },
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
      }),
      prisma.actorCache.findMany({
        where: { apId: { in: requestActorApIds } },
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
      })
    ]);
    const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
    const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
    const result = requests.map((r) => {
      const actorInfo = localActorMap.get(r.actorApId) || cachedActorMap.get(r.actorApId);
      return {
        ap_id: r.actorApId,
        username: formatUsername(r.actorApId),
        preferred_username: actorInfo?.preferredUsername || null,
        name: actorInfo?.name || null,
        icon_url: actorInfo?.iconUrl || null,
        created_at: r.createdAt
      };
    });
    return c.json({ requests: result });
  });
  communities5.post("/:identifier/requests/accept", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const prisma = c.get("prisma");
    const body = await c.req.json();
    if (!body.actor_ap_id) {
      return c.json({ error: "actor_ap_id required" }, 400);
    }
    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const member = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!member || !managerRoles.has(member.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const request = await prisma.communityJoinRequest.findFirst({
      where: {
        communityApId: community.apId,
        actorApId: body.actor_ap_id,
        status: "pending"
      }
    });
    if (!request) {
      return c.json({ error: "Join request not found" }, 404);
    }
    const existingMember = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: body.actor_ap_id
        }
      }
    });
    if (!existingMember) {
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await prisma.communityMember.create({
        data: {
          communityApId: community.apId,
          actorApId: body.actor_ap_id,
          role: "member",
          joinedAt: now
        }
      });
      await prisma.community.update({
        where: { apId: community.apId },
        data: { memberCount: { increment: 1 } }
      });
    }
    await prisma.communityJoinRequest.update({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: body.actor_ap_id
        }
      },
      data: {
        status: "accepted",
        processedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
    return c.json({ success: true });
  });
  communities5.post("/:identifier/requests/reject", async (c) => {
    const actor = c.get("actor");
    if (!actor)
      return c.json({ error: "Unauthorized" }, 401);
    const identifier = c.req.param("identifier");
    const prisma = c.get("prisma");
    const body = await c.req.json();
    if (!body.actor_ap_id) {
      return c.json({ error: "actor_ap_id required" }, 400);
    }
    const { community } = await fetchCommunityId(c, identifier);
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }
    const member = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      }
    });
    if (!member || !managerRoles.has(member.role)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    const request = await prisma.communityJoinRequest.findFirst({
      where: {
        communityApId: community.apId,
        actorApId: body.actor_ap_id,
        status: "pending"
      }
    });
    if (!request) {
      return c.json({ error: "Join request not found" }, 404);
    }
    await prisma.communityJoinRequest.update({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: body.actor_ap_id
        }
      },
      data: {
        status: "rejected",
        processedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
    return c.json({ success: true });
  });
}
__name(registerMembershipRequestRoutes, "registerMembershipRequestRoutes");

// src/backend/routes/communities/membership.ts
var communities2 = new Hono2();
registerMembershipJoinRoutes(communities2);
registerMembershipRequestRoutes(communities2);
registerMembershipInviteRoutes(communities2);
registerMembershipMemberRoutes(communities2);
var membership_default = communities2;

// src/backend/routes/communities/messages.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var communities3 = new Hono2();
communities3.get("/:identifier/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const identifier = c.req.param("identifier");
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith("http") ? identifier : communityApId(baseUrl, identifier);
  const rawLimit = parseInt(c.req.query("limit") || "50", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_COMMUNITY_MESSAGES_LIMIT) : 50;
  const before = c.req.query("before");
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier }
      ]
    }
  });
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityApId_actorApId: {
        communityApId: community.apId,
        actorApId: actor.ap_id
      }
    }
  });
  const policy = community.postPolicy || "members";
  const role = membership?.role;
  const isManager = role === "owner" || role === "moderator";
  if (policy !== "anyone" && !membership) {
    return c.json({ error: "Not a community member" }, 403);
  }
  if (policy === "mods" && !isManager) {
    return c.json({ error: "Moderator role required" }, 403);
  }
  if (policy === "owners" && role !== "owner") {
    return c.json({ error: "Owner role required" }, 403);
  }
  const recipients = await prisma.objectRecipient.findMany({
    where: {
      recipientApId: community.apId,
      type: "audience"
    },
    select: { objectApId: true }
  });
  const objectApIds = recipients.map((r) => r.objectApId);
  if (objectApIds.length === 0) {
    return c.json({ messages: [] });
  }
  const messages = await prisma.object.findMany({
    where: {
      apId: { in: objectApIds },
      type: "Note",
      ...before ? { published: { lt: before } } : {}
    },
    orderBy: { published: "desc" },
    take: limit
  });
  const senderApIds = [...new Set(messages.map((msg) => msg.attributedTo))];
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: senderApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: senderApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    })
  ]);
  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
  const result = messages.reverse().map((msg) => {
    const senderInfo = localActorMap.get(msg.attributedTo) || cachedActorMap.get(msg.attributedTo);
    return {
      id: msg.apId,
      sender: {
        ap_id: msg.attributedTo,
        username: formatUsername(msg.attributedTo),
        preferred_username: senderInfo?.preferredUsername || null,
        name: senderInfo?.name || null,
        icon_url: senderInfo?.iconUrl || null
      },
      content: msg.content,
      created_at: msg.published
    };
  });
  return c.json({ messages: result });
});
communities3.post("/:identifier/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const identifier = c.req.param("identifier");
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith("http") ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json();
  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: "Message content is required" }, 400);
  }
  if (content.length > MAX_COMMUNITY_MESSAGE_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_COMMUNITY_MESSAGE_LENGTH} chars)` }, 400);
  }
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier }
      ]
    }
  });
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityApId_actorApId: {
        communityApId: community.apId,
        actorApId: actor.ap_id
      }
    }
  });
  const policy = community.postPolicy || "members";
  const role = membership?.role;
  const isManager = role === "owner" || role === "moderator";
  if (policy !== "anyone" && !membership) {
    return c.json({ error: "Not a member" }, 403);
  }
  if (policy === "mods" && !isManager) {
    return c.json({ error: "Moderator role required" }, 403);
  }
  if (policy === "owners" && role !== "owner") {
    return c.json({ error: "Owner role required" }, 403);
  }
  const objectId = generateId();
  const objectApId2 = `${baseUrl}/ap/objects/${objectId}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const toJson = JSON.stringify([community.apId]);
  const audienceJson = JSON.stringify([community.apId]);
  await prisma.object.create({
    data: {
      apId: objectApId2,
      type: "Note",
      attributedTo: actor.ap_id,
      content,
      toJson,
      audienceJson,
      visibility: "unlisted",
      published: now,
      isLocal: 1
    }
  });
  await prisma.$executeRaw`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${objectApId2}, ${community.apId}, 'audience', ${now})
  `;
  const activityId = generateId();
  const activityApIdVal = `${baseUrl}/ap/activities/${activityId}`;
  await prisma.activity.create({
    data: {
      apId: activityApIdVal,
      type: "Create",
      actorApId: actor.ap_id,
      objectApId: objectApId2,
      rawJson: JSON.stringify({ to: JSON.parse(toJson) })
    }
  });
  await prisma.community.update({
    where: { apId: community.apId },
    data: { lastMessageAt: now }
  });
  return c.json({
    message: {
      id: objectApId2,
      sender: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url
      },
      content,
      created_at: now
    }
  }, 201);
});
communities3.patch("/:identifier/messages/:messageId", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const identifier = c.req.param("identifier");
  const messageId = decodeURIComponent(c.req.param("messageId"));
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith("http") ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json();
  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: "Message content is required" }, 400);
  }
  if (content.length > MAX_COMMUNITY_MESSAGE_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_COMMUNITY_MESSAGE_LENGTH} chars)` }, 400);
  }
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier }
      ]
    },
    select: { apId: true }
  });
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }
  const recipients = await prisma.$queryRaw`
    SELECT object_ap_id FROM object_recipients
    WHERE object_ap_id = ${messageId} AND recipient_ap_id = ${community.apId} AND type = 'audience'
    LIMIT 1
  `;
  if (recipients.length === 0) {
    return c.json({ error: "Message not found" }, 404);
  }
  const message = await prisma.object.findUnique({
    where: { apId: messageId },
    select: { apId: true, attributedTo: true }
  });
  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }
  if (message.attributedTo !== actor.ap_id) {
    return c.json({ error: "Only the author can edit this message" }, 403);
  }
  await prisma.object.update({
    where: { apId: messageId },
    data: {
      content,
      updated: (/* @__PURE__ */ new Date()).toISOString()
    }
  });
  return c.json({ success: true });
});
communities3.delete("/:identifier/messages/:messageId", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const identifier = c.req.param("identifier");
  const messageId = decodeURIComponent(c.req.param("messageId"));
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith("http") ? identifier : communityApId(baseUrl, identifier);
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier }
      ]
    },
    select: { apId: true }
  });
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }
  const recipientsForDelete = await prisma.$queryRaw`
    SELECT object_ap_id FROM object_recipients
    WHERE object_ap_id = ${messageId} AND recipient_ap_id = ${community.apId} AND type = 'audience'
    LIMIT 1
  `;
  if (recipientsForDelete.length === 0) {
    return c.json({ error: "Message not found" }, 404);
  }
  const message = await prisma.object.findUnique({
    where: { apId: messageId },
    select: { apId: true, attributedTo: true }
  });
  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityApId_actorApId: {
        communityApId: community.apId,
        actorApId: actor.ap_id
      }
    }
  });
  const isAuthor = message.attributedTo === actor.ap_id;
  const isManager = membership && managerRoles.has(membership.role);
  if (!isAuthor && !isManager) {
    return c.json({ error: "Permission denied" }, 403);
  }
  await prisma.$executeRaw`DELETE FROM object_recipients WHERE object_ap_id = ${messageId}`;
  await prisma.object.delete({ where: { apId: messageId } });
  return c.json({ success: true });
});
var messages_default = communities3;

// src/backend/routes/communities.ts
var communities4 = new Hono2();
communities4.route("/", base_default3);
communities4.route("/", membership_default);
communities4.route("/", messages_default);
var communities_default = communities4;

// src/backend/routes/dm.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/dm/conversations.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/dm/utils.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var MAX_DM_CONTENT_LENGTH = 5e3;
var MAX_DM_PAGE_LIMIT = 100;
function getConversationId(baseUrl, ap1, ap22) {
  const [p1, p2] = [ap1, ap22].sort();
  const hash = btoa(`${p1}:${p2}`).replace(/[^a-zA-Z0-9]/g, "").substring(0, 16);
  return `${baseUrl}/ap/conversations/${hash}`;
}
__name(getConversationId, "getConversationId");
async function resolveConversationId(prisma, baseUrl, actorApId2, otherApId) {
  const existing = await prisma.object.findFirst({
    where: {
      visibility: "direct",
      type: "Note",
      conversation: { not: null },
      OR: [
        {
          attributedTo: actorApId2,
          toJson: { contains: otherApId }
        },
        {
          attributedTo: otherApId,
          toJson: { contains: actorApId2 }
        }
      ]
    },
    orderBy: { published: "desc" },
    select: { conversation: true }
  });
  return existing?.conversation || getConversationId(baseUrl, actorApId2, otherApId);
}
__name(resolveConversationId, "resolveConversationId");

// src/backend/routes/dm/conversations.ts
var dm = new Hono2();
dm.get("/contacts", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const validConversations = await prisma.object.findMany({
    where: {
      visibility: "direct",
      type: "Note",
      conversation: { not: null },
      OR: [
        { attributedTo: actor.ap_id },
        { toJson: { contains: actor.ap_id } }
      ]
    },
    select: { conversation: true },
    distinct: ["conversation"]
  });
  const validConversationIds = validConversations.map((c2) => c2.conversation).filter((c2) => c2 !== null);
  if (validConversationIds.length > 0) {
    await prisma.dmReadStatus.deleteMany({
      where: {
        actorApId: actor.ap_id,
        conversationId: { notIn: validConversationIds }
      }
    });
  } else {
    await prisma.dmReadStatus.deleteMany({
      where: { actorApId: actor.ap_id }
    });
  }
  const archivedConversations = await prisma.dmArchivedConversation.findMany({
    where: { actorApId: actor.ap_id },
    select: { conversationId: true }
  });
  const archivedSet = new Set(archivedConversations.map((a) => a.conversationId));
  const dmObjects = await prisma.object.findMany({
    where: {
      visibility: "direct",
      type: "Note",
      conversation: { not: null },
      OR: [
        { attributedTo: actor.ap_id },
        { toJson: { contains: actor.ap_id } }
      ]
    },
    orderBy: { published: "desc" },
    select: {
      conversation: true,
      attributedTo: true,
      toJson: true,
      published: true,
      content: true
    },
    take: 2e3
    // Enough to cover many conversations while preventing unbounded results
  });
  const conversationMap = /* @__PURE__ */ new Map();
  for (const obj of dmObjects) {
    if (!obj.conversation)
      continue;
    if (archivedSet.has(obj.conversation))
      continue;
    let otherApId;
    if (obj.attributedTo === actor.ap_id) {
      try {
        const toArray = JSON.parse(obj.toJson);
        otherApId = toArray[0];
      } catch (err) {
        console.warn("[DM] Failed to parse toJson for contact:", err, { conversation: obj.conversation });
        continue;
      }
    } else {
      otherApId = obj.attributedTo;
    }
    if (!otherApId || otherApId === "")
      continue;
    if (!conversationMap.has(obj.conversation)) {
      conversationMap.set(obj.conversation, {
        conversation: obj.conversation,
        otherApId,
        lastMessageAt: obj.published,
        lastContent: obj.content,
        lastSender: obj.attributedTo
      });
    }
  }
  const readStatuses = await prisma.dmReadStatus.findMany({
    where: { actorApId: actor.ap_id }
  });
  const readStatusMap = new Map(readStatuses.map((r) => [r.conversationId, r.lastReadAt]));
  const conversationIds = Array.from(conversationMap.keys());
  const unreadCounts = /* @__PURE__ */ new Map();
  for (const convId of conversationIds) {
    unreadCounts.set(convId, 0);
  }
  if (conversationIds.length > 0) {
    const lastReadAtMap = /* @__PURE__ */ new Map();
    for (const convId of conversationIds) {
      const lastReadAt = readStatusMap.get(convId) || "1970-01-01T00:00:00Z";
      const convIds = lastReadAtMap.get(lastReadAt) || [];
      convIds.push(convId);
      lastReadAtMap.set(lastReadAt, convIds);
    }
    const countPromises = Array.from(lastReadAtMap.entries()).map(async ([lastReadAt, convIds]) => {
      const unreadMessages = await prisma.object.groupBy({
        by: ["conversation"],
        where: {
          conversation: { in: convIds },
          visibility: "direct",
          attributedTo: { not: actor.ap_id },
          published: { gt: lastReadAt }
        },
        _count: { apId: true }
      });
      for (const msg of unreadMessages) {
        if (msg.conversation) {
          unreadCounts.set(msg.conversation, msg._count.apId);
        }
      }
    });
    await Promise.all(countPromises);
  }
  const otherApIds = Array.from(new Set(Array.from(conversationMap.values()).map((c2) => c2.otherApId)));
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: otherApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: otherApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    })
  ]);
  const actorInfoMap = /* @__PURE__ */ new Map();
  for (const a of cachedActors) {
    actorInfoMap.set(a.apId, a);
  }
  for (const a of localActors) {
    actorInfoMap.set(a.apId, a);
  }
  const contactsResult = Array.from(conversationMap.values()).map((conv) => {
    const actorInfo = actorInfoMap.get(conv.otherApId);
    return {
      type: "user",
      ap_id: conv.otherApId,
      username: formatUsername(conv.otherApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      conversation_id: conv.conversation,
      last_message: conv.lastContent ? {
        content: conv.lastContent,
        is_mine: conv.lastSender === actor.ap_id
      } : null,
      last_message_at: conv.lastMessageAt,
      unread_count: unreadCounts.get(conv.conversation) || 0
    };
  });
  contactsResult.sort((a, b) => {
    const aTime = a.last_message_at || "";
    const bTime = b.last_message_at || "";
    return bTime.localeCompare(aTime);
  });
  const communityMemberships = await prisma.communityMember.findMany({
    where: { actorApId: actor.ap_id },
    include: {
      community: {
        select: {
          apId: true,
          preferredUsername: true,
          name: true,
          iconUrl: true,
          memberCount: true
        }
      }
    }
  });
  const communityApIds = communityMemberships.map((cm) => cm.community.apId);
  const lastMessagesMap = /* @__PURE__ */ new Map();
  if (communityApIds.length > 0) {
    const recentMessages = await prisma.object.findMany({
      where: {
        communityApId: { in: communityApIds }
      },
      orderBy: { published: "desc" },
      select: { communityApId: true, content: true, attributedTo: true, published: true },
      take: communityApIds.length * 10
    });
    for (const msg of recentMessages) {
      if (msg.communityApId && !lastMessagesMap.has(msg.communityApId)) {
        lastMessagesMap.set(msg.communityApId, {
          content: msg.content,
          attributedTo: msg.attributedTo,
          published: msg.published
        });
      }
    }
  }
  const communitiesResult = communityMemberships.map((cm) => {
    const lastMessage = lastMessagesMap.get(cm.community.apId);
    return {
      type: "community",
      ap_id: cm.community.apId,
      username: formatUsername(cm.community.apId),
      preferred_username: cm.community.preferredUsername,
      name: cm.community.name,
      icon_url: cm.community.iconUrl,
      member_count: cm.community.memberCount,
      last_message: lastMessage?.content ? {
        content: lastMessage.content,
        is_mine: lastMessage.attributedTo === actor.ap_id
      } : null,
      last_message_at: lastMessage?.published || null
    };
  });
  communitiesResult.sort((a, b) => {
    const aTime = a.last_message_at || "";
    const bTime = b.last_message_at || "";
    return bTime.localeCompare(aTime) || a.name.localeCompare(b.name);
  });
  const incomingDMs = await prisma.object.findMany({
    where: {
      visibility: "direct",
      type: "Note",
      toJson: { contains: actor.ap_id }
    },
    select: { conversation: true },
    distinct: ["conversation"]
  });
  const incomingConversations = incomingDMs.map((dm4) => dm4.conversation).filter((c2) => c2 !== null);
  const ourReplies = incomingConversations.length > 0 ? await prisma.object.findMany({
    where: {
      conversation: { in: incomingConversations },
      attributedTo: actor.ap_id
    },
    select: { conversation: true },
    distinct: ["conversation"]
  }) : [];
  const repliedConversations = new Set(ourReplies.map((r) => r.conversation));
  const requestCount = incomingConversations.filter((c2) => !repliedConversations.has(c2)).length;
  return c.json({
    mutual_followers: contactsResult,
    communities: communitiesResult,
    request_count: requestCount
  });
});
dm.get("/requests", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const incomingDMs = await prisma.object.findMany({
    where: {
      visibility: "direct",
      type: "Note",
      toJson: { contains: actor.ap_id }
    },
    orderBy: { published: "desc" },
    select: {
      apId: true,
      attributedTo: true,
      content: true,
      published: true,
      conversation: true
    },
    take: 1e3
    // Cap for safety while covering typical usage
  });
  const allConversations = [...new Set(incomingDMs.map((dm4) => dm4.conversation).filter((c2) => c2 !== null))];
  const ourRepliesInConversations = allConversations.length > 0 ? await prisma.object.findMany({
    where: {
      conversation: { in: allConversations },
      attributedTo: actor.ap_id
    },
    select: { conversation: true },
    distinct: ["conversation"]
  }) : [];
  const repliedConversationsSet = new Set(ourRepliesInConversations.map((r) => r.conversation));
  const requests = [];
  const seenConversations = /* @__PURE__ */ new Set();
  for (const dm4 of incomingDMs) {
    if (!dm4.conversation || seenConversations.has(dm4.conversation))
      continue;
    if (!repliedConversationsSet.has(dm4.conversation)) {
      seenConversations.add(dm4.conversation);
      requests.push({
        id: dm4.apId,
        senderApId: dm4.attributedTo,
        content: dm4.content,
        createdAt: dm4.published,
        conversation: dm4.conversation
      });
    }
  }
  const senderApIds = Array.from(new Set(requests.map((r) => r.senderApId)));
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: senderApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: senderApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    })
  ]);
  const actorInfoMap = /* @__PURE__ */ new Map();
  for (const a of cachedActors) {
    actorInfoMap.set(a.apId, a);
  }
  for (const a of localActors) {
    actorInfoMap.set(a.apId, a);
  }
  const result = requests.map((r) => {
    const actorInfo = actorInfoMap.get(r.senderApId);
    return {
      id: r.id,
      sender: {
        ap_id: r.senderApId,
        username: formatUsername(r.senderApId),
        preferred_username: actorInfo?.preferredUsername || null,
        name: actorInfo?.name || null,
        icon_url: actorInfo?.iconUrl || null
      },
      content: r.content,
      created_at: r.createdAt,
      conversation: r.conversation
    };
  });
  return c.json({ requests: result });
});
dm.post("/requests/reject", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  if (!body.sender_ap_id) {
    return c.json({ error: "sender_ap_id is required" }, 400);
  }
  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.sender_ap_id);
  const messagesToDelete = await prisma.object.findMany({
    where: {
      conversation: conversationId,
      attributedTo: body.sender_ap_id
    },
    select: { apId: true }
  });
  const messageApIds = messagesToDelete.map((m) => m.apId);
  if (messageApIds.length > 0) {
    await prisma.objectRecipient.deleteMany({
      where: { objectApId: { in: messageApIds } }
    });
  }
  await prisma.object.deleteMany({
    where: {
      conversation: conversationId,
      visibility: "direct",
      attributedTo: body.sender_ap_id
    }
  });
  if (body.block) {
    await prisma.block.upsert({
      where: {
        blockerApId_blockedApId: {
          blockerApId: actor.ap_id,
          blockedApId: body.sender_ap_id
        }
      },
      update: {},
      create: {
        blockerApId: actor.ap_id,
        blockedApId: body.sender_ap_id
      }
    });
  }
  return c.json({ success: true });
});
dm.post("/requests/accept", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json();
  if (!body.sender_ap_id) {
    return c.json({ error: "sender_ap_id is required" }, 400);
  }
  return c.json({ success: true, message: "Reply to the conversation to accept" });
});
dm.get("/conversations", async (c) => {
  return c.redirect("/api/dm/contacts");
});
dm.post("/conversations", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const body = await c.req.json();
  if (!body.participant_ap_id) {
    return c.json({ error: "participant_ap_id is required" }, 400);
  }
  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.participant_ap_id);
  const localActor = await prisma.actor.findUnique({
    where: { apId: body.participant_ap_id },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
  });
  const cachedActor = localActor ? null : await prisma.actorCache.findUnique({
    where: { apId: body.participant_ap_id },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
  });
  const otherInfo = localActor || cachedActor;
  if (!otherInfo) {
    return c.json({ error: "Actor not found" }, 404);
  }
  return c.json({
    conversation: {
      id: conversationId,
      other_participant: {
        ap_id: body.participant_ap_id,
        username: formatUsername(body.participant_ap_id),
        preferred_username: otherInfo.preferredUsername,
        name: otherInfo.name,
        icon_url: otherInfo.iconUrl
      },
      last_message_at: null,
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    }
  });
});
dm.post("/user/:encodedApId/typing", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const otherApId = decodeURIComponent(c.req.param("encodedApId"));
  if (!otherApId)
    return c.json({ error: "ap_id required" }, 400);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await prisma.dmTyping.upsert({
    where: {
      actorApId_recipientApId: {
        actorApId: actor.ap_id,
        recipientApId: otherApId
      }
    },
    update: { lastTypedAt: now },
    create: {
      actorApId: actor.ap_id,
      recipientApId: otherApId,
      lastTypedAt: now
    }
  });
  return c.json({ success: true, typed_at: now });
});
dm.get("/user/:encodedApId/typing", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const otherApId = decodeURIComponent(c.req.param("encodedApId"));
  if (!otherApId)
    return c.json({ error: "ap_id required" }, 400);
  const typing = await prisma.dmTyping.findUnique({
    where: {
      actorApId_recipientApId: {
        actorApId: otherApId,
        recipientApId: actor.ap_id
      }
    },
    select: { lastTypedAt: true }
  });
  if (!typing?.lastTypedAt) {
    return c.json({ is_typing: false, last_typed_at: null });
  }
  const lastTypedAt = typing.lastTypedAt;
  const lastTypedMs = Date.parse(lastTypedAt);
  const nowMs = Date.now();
  const isTyping = Number.isFinite(lastTypedMs) && nowMs - lastTypedMs <= 8e3;
  const isExpired = !Number.isFinite(lastTypedMs) || nowMs - lastTypedMs > 5 * 60 * 1e3;
  if (isExpired) {
    await prisma.dmTyping.delete({
      where: {
        actorApId_recipientApId: {
          actorApId: otherApId,
          recipientApId: actor.ap_id
        }
      }
    });
    return c.json({ is_typing: false, last_typed_at: null });
  }
  return c.json({ is_typing: isTyping, last_typed_at: lastTypedAt });
});
dm.post("/user/:encodedApId/read", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const otherApId = decodeURIComponent(c.req.param("encodedApId"));
  if (!otherApId)
    return c.json({ error: "ap_id required" }, 400);
  const baseUrl = c.env.APP_URL;
  const conversationId = await resolveConversationId(prisma, baseUrl, actor.ap_id, otherApId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await prisma.dmReadStatus.upsert({
    where: {
      actorApId_conversationId: {
        actorApId: actor.ap_id,
        conversationId
      }
    },
    update: { lastReadAt: now },
    create: {
      actorApId: actor.ap_id,
      conversationId,
      lastReadAt: now
    }
  });
  return c.json({ success: true, last_read_at: now });
});
dm.post("/user/:encodedApId/archive", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const otherApId = decodeURIComponent(c.req.param("encodedApId"));
  if (!otherApId)
    return c.json({ error: "ap_id required" }, 400);
  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await prisma.dmArchivedConversation.upsert({
    where: {
      actorApId_conversationId: {
        actorApId: actor.ap_id,
        conversationId
      }
    },
    update: {},
    create: {
      actorApId: actor.ap_id,
      conversationId,
      archivedAt: now
    }
  });
  return c.json({ success: true, archived_at: now });
});
dm.delete("/user/:encodedApId/archive", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const otherApId = decodeURIComponent(c.req.param("encodedApId"));
  if (!otherApId)
    return c.json({ error: "ap_id required" }, 400);
  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);
  await prisma.dmArchivedConversation.deleteMany({
    where: {
      actorApId: actor.ap_id,
      conversationId
    }
  });
  return c.json({ success: true });
});
dm.get("/archived", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const archivedConversations = await prisma.dmArchivedConversation.findMany({
    where: { actorApId: actor.ap_id },
    select: { conversationId: true, archivedAt: true }
  });
  if (archivedConversations.length === 0) {
    return c.json({ archived: [] });
  }
  const archivedSet = new Set(archivedConversations.map((a) => a.conversationId));
  const dmObjects = await prisma.object.findMany({
    where: {
      visibility: "direct",
      type: "Note",
      conversation: { not: null },
      OR: [
        { attributedTo: actor.ap_id },
        { toJson: { contains: actor.ap_id } }
      ]
    },
    orderBy: { published: "desc" },
    select: {
      conversation: true,
      attributedTo: true,
      toJson: true,
      published: true
    },
    take: 2e3
    // Cap for safety
  });
  const conversationMap = /* @__PURE__ */ new Map();
  for (const obj of dmObjects) {
    if (!obj.conversation)
      continue;
    if (!archivedSet.has(obj.conversation))
      continue;
    let otherApId;
    if (obj.attributedTo === actor.ap_id) {
      try {
        const toArray = JSON.parse(obj.toJson);
        otherApId = toArray[0];
      } catch (err) {
        console.warn("[DM] Failed to parse toJson for archived:", err, { conversation: obj.conversation });
        continue;
      }
    } else {
      otherApId = obj.attributedTo;
    }
    if (!otherApId || otherApId === "")
      continue;
    if (!conversationMap.has(obj.conversation)) {
      conversationMap.set(obj.conversation, {
        conversation: obj.conversation,
        otherApId,
        lastMessageAt: obj.published
      });
    }
  }
  const otherApIds = Array.from(new Set(Array.from(conversationMap.values()).map((c2) => c2.otherApId)));
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: otherApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: otherApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
    })
  ]);
  const actorInfoMap = /* @__PURE__ */ new Map();
  for (const a of cachedActors) {
    actorInfoMap.set(a.apId, a);
  }
  for (const a of localActors) {
    actorInfoMap.set(a.apId, a);
  }
  const archived = Array.from(conversationMap.values()).map((conv) => {
    const actorInfo = actorInfoMap.get(conv.otherApId);
    return {
      ap_id: conv.otherApId,
      username: formatUsername(conv.otherApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      conversation_id: conv.conversation,
      last_message_at: conv.lastMessageAt
    };
  });
  archived.sort((a, b) => {
    const aTime = a.last_message_at || "";
    const bTime = b.last_message_at || "";
    return bTime.localeCompare(aTime);
  });
  return c.json({ archived });
});
var conversations_default = dm;

// src/backend/routes/dm/messages.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var dm2 = new Hono2();
dm2.get("/user/:encodedApId/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const otherApId = decodeURIComponent(c.req.param("encodedApId"));
  const limit = parseLimit(c.req.query("limit"), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query("before");
  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);
  const whereClause = {
    visibility: "direct",
    type: "Note",
    conversation: conversationId,
    // Database-level authorization: only messages where actor is sender or recipient
    OR: [
      { attributedTo: actor.ap_id },
      { toJson: { contains: actor.ap_id } }
    ]
  };
  if (before) {
    whereClause.published = { lt: before };
  }
  const messages = await prisma.object.findMany({
    where: whereClause,
    orderBy: { published: "desc" },
    take: limit
  });
  const filteredMessages = messages.filter((msg) => {
    if (msg.attributedTo === actor.ap_id)
      return true;
    const toRecipients = safeJsonParse(msg.toJson, []);
    return toRecipients.includes(actor.ap_id);
  });
  const authorApIds = Array.from(new Set(filteredMessages.map((m) => m.attributedTo)));
  const localActors = await prisma.actor.findMany({
    where: { apId: { in: authorApIds } },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
  });
  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const remoteApIds = authorApIds.filter((id) => !localActorMap.has(id));
  const cachedActors = remoteApIds.length > 0 ? await prisma.actorCache.findMany({
    where: { apId: { in: remoteApIds } },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
  }) : [];
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
  const result = filteredMessages.reverse().map((msg) => {
    const localActor = localActorMap.get(msg.attributedTo);
    const cachedActor = cachedActorMap.get(msg.attributedTo);
    const authorInfo = localActor || cachedActor;
    return {
      id: msg.apId,
      sender: {
        ap_id: msg.attributedTo,
        username: formatUsername(msg.attributedTo),
        preferred_username: authorInfo?.preferredUsername || null,
        name: authorInfo?.name || null,
        icon_url: authorInfo?.iconUrl || null
      },
      content: msg.content,
      attachments: safeJsonParse(msg.attachmentsJson, []),
      created_at: msg.published
    };
  });
  return c.json({ messages: result, conversation_id: conversationId });
});
dm2.post("/user/:encodedApId/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const otherApId = decodeURIComponent(c.req.param("encodedApId"));
  const body = await c.req.json();
  const baseUrl = c.env.APP_URL;
  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: "Message content is required" }, 400);
  }
  if (content.length > MAX_DM_CONTENT_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_DM_CONTENT_LENGTH} chars)` }, 400);
  }
  const localActor = await prisma.actor.findUnique({
    where: { apId: otherApId },
    select: { apId: true, inbox: true }
  });
  const cachedActor = !localActor ? await prisma.actorCache.findUnique({
    where: { apId: otherApId },
    select: { apId: true, inbox: true }
  }) : null;
  const otherActor = localActor || cachedActor;
  if (!otherActor) {
    return c.json({ error: "User not found" }, 404);
  }
  const messageId = generateId();
  const apId = objectApId(baseUrl, messageId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);
  const toJson = JSON.stringify([otherApId]);
  const ccJson = JSON.stringify([]);
  const recipientIsLocal = await prisma.actor.findUnique({
    where: { apId: otherApId },
    select: { apId: true }
  });
  const isRecipientLocal = !!recipientIsLocal;
  const activityId = isRecipientLocal ? activityApId(baseUrl, generateId()) : null;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.object.create({
        data: {
          apId,
          type: "Note",
          attributedTo: actor.ap_id,
          content,
          visibility: "direct",
          toJson,
          ccJson,
          conversation: conversationId,
          published: now,
          isLocal: 1
        }
      });
      if (isRecipientLocal) {
        await tx.objectRecipient.upsert({
          where: {
            objectApId_recipientApId: {
              objectApId: apId,
              recipientApId: otherApId
            }
          },
          create: {
            objectApId: apId,
            recipientApId: otherApId,
            type: "to"
          },
          update: {}
          // No update needed, just ensure it exists
        });
        await tx.activity.create({
          data: {
            apId: activityId,
            type: "Create",
            actorApId: actor.ap_id,
            objectApId: apId,
            rawJson: JSON.stringify({ type: "Create", actor: actor.ap_id, object: apId }),
            direction: "inbound"
          }
        });
        await tx.inbox.create({
          data: {
            actorApId: otherApId,
            activityApId: activityId
          }
        });
      }
    });
  } catch (e) {
    console.error("[DM] Failed to insert message:", e);
    return c.json({ error: "Failed to send message" }, 500);
  }
  if (!isLocal(otherApId, baseUrl) && otherActor.inbox) {
    try {
      if (!isSafeRemoteUrl(otherActor.inbox)) {
        console.warn(`[DM] Blocked unsafe inbox URL: ${otherActor.inbox}`);
      } else {
        const createActivity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          id: activityApId(baseUrl, generateId()),
          type: "Create",
          actor: actor.ap_id,
          to: [otherApId],
          object: {
            id: apId,
            type: "Note",
            attributedTo: actor.ap_id,
            to: [otherApId],
            content,
            published: now,
            conversation: conversationId
          }
        };
        const keyId = `${actor.ap_id}#main-key`;
        const headers = await signRequest(actor.private_key_pem, keyId, "POST", otherActor.inbox, JSON.stringify(createActivity));
        await fetch(otherActor.inbox, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/activity+json" },
          body: JSON.stringify(createActivity)
        });
      }
    } catch (e) {
      console.error("Failed to deliver DM:", e);
    }
  }
  return c.json({
    message: {
      id: apId,
      sender: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url
      },
      content,
      created_at: now
    },
    conversation_id: conversationId
  }, 201);
});
dm2.patch("/messages/:messageId", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const messageId = c.req.param("messageId");
  const body = await c.req.json();
  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: "Content is required" }, 400);
  }
  if (content.length > MAX_DM_CONTENT_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_DM_CONTENT_LENGTH} chars)` }, 400);
  }
  const message = await prisma.object.findFirst({
    where: {
      apId: messageId,
      visibility: "direct",
      type: "Note"
    },
    select: { apId: true, attributedTo: true, conversation: true }
  });
  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }
  if (message.attributedTo !== actor.ap_id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await prisma.object.update({
    where: { apId: message.apId },
    data: {
      content,
      updated: now
    }
  });
  return c.json({
    success: true,
    message: {
      id: message.apId,
      content,
      updated_at: now
    }
  });
});
dm2.delete("/messages/:messageId", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const messageId = c.req.param("messageId");
  const message = await prisma.object.findFirst({
    where: {
      apId: messageId,
      visibility: "direct",
      type: "Note"
    },
    select: { apId: true, attributedTo: true, conversation: true }
  });
  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }
  if (message.attributedTo !== actor.ap_id) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await prisma.$transaction(async (tx) => {
    await tx.objectRecipient.deleteMany({
      where: { objectApId: message.apId }
    });
    await tx.object.delete({
      where: { apId: message.apId }
    });
  });
  return c.json({ success: true });
});
dm2.get("/conversations/:id/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const conversationId = c.req.param("id");
  const limit = parseLimit(c.req.query("limit"), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query("before");
  const whereClause = {
    visibility: "direct",
    type: "Note",
    conversation: conversationId,
    // Database-level authorization: only messages where actor is sender or recipient
    OR: [
      { attributedTo: actor.ap_id },
      { toJson: { contains: actor.ap_id } }
    ]
  };
  if (before) {
    whereClause.published = { lt: before };
  }
  const messages = await prisma.object.findMany({
    where: whereClause,
    orderBy: { published: "desc" },
    take: limit
  });
  const filteredMessages = messages.filter((msg) => {
    if (msg.attributedTo === actor.ap_id)
      return true;
    const toRecipients = safeJsonParse(msg.toJson, []);
    return toRecipients.includes(actor.ap_id);
  });
  const authorApIds = Array.from(new Set(filteredMessages.map((m) => m.attributedTo)));
  const localActors = await prisma.actor.findMany({
    where: { apId: { in: authorApIds } },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
  });
  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const remoteApIds = authorApIds.filter((id) => !localActorMap.has(id));
  const cachedActors = remoteApIds.length > 0 ? await prisma.actorCache.findMany({
    where: { apId: { in: remoteApIds } },
    select: { apId: true, preferredUsername: true, name: true, iconUrl: true }
  }) : [];
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));
  const result = filteredMessages.reverse().map((msg) => {
    const localActor = localActorMap.get(msg.attributedTo);
    const cachedActor = cachedActorMap.get(msg.attributedTo);
    const authorInfo = localActor || cachedActor;
    return {
      id: msg.apId,
      sender: {
        ap_id: msg.attributedTo,
        username: formatUsername(msg.attributedTo),
        preferred_username: authorInfo?.preferredUsername || null,
        name: authorInfo?.name || null,
        icon_url: authorInfo?.iconUrl || null
      },
      content: msg.content,
      created_at: msg.published
    };
  });
  return c.json({ messages: result });
});
dm2.post("/conversations/:id/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor)
    return c.json({ error: "Unauthorized" }, 401);
  const prisma = c.get("prisma");
  const conversationId = c.req.param("id");
  const body = await c.req.json();
  const baseUrl = c.env.APP_URL;
  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: "Message content is required" }, 400);
  }
  if (content.length > MAX_DM_CONTENT_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_DM_CONTENT_LENGTH} chars)` }, 400);
  }
  const existingMessages = await prisma.object.findMany({
    where: {
      conversation: conversationId,
      visibility: "direct"
    },
    select: {
      attributedTo: true,
      toJson: true
    },
    take: 10
  });
  let otherApId = null;
  for (const msg of existingMessages) {
    if (msg.attributedTo === actor.ap_id) {
      const recipients = safeJsonParse(msg.toJson, []);
      if (recipients.length > 0) {
        otherApId = recipients[0];
        break;
      }
    } else {
      const recipients = safeJsonParse(msg.toJson, []);
      if (recipients.includes(actor.ap_id)) {
        otherApId = msg.attributedTo;
        break;
      }
    }
  }
  if (!otherApId) {
    return c.json({ error: "Forbidden" }, 403);
  }
  const messageId = generateId();
  const apId = objectApId(baseUrl, messageId);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const toJson = JSON.stringify([otherApId]);
  const ccJson = JSON.stringify([]);
  const recipientIsLocal = await prisma.actor.findUnique({
    where: { apId: otherApId },
    select: { apId: true }
  });
  const isRecipientLocal = !!recipientIsLocal;
  await prisma.$transaction(async (tx) => {
    await tx.object.create({
      data: {
        apId,
        type: "Note",
        attributedTo: actor.ap_id,
        content,
        visibility: "direct",
        toJson,
        ccJson,
        conversation: conversationId,
        published: now,
        isLocal: 1
      }
    });
    if (isRecipientLocal) {
      await tx.objectRecipient.upsert({
        where: {
          objectApId_recipientApId: {
            objectApId: apId,
            recipientApId: otherApId
          }
        },
        create: {
          objectApId: apId,
          recipientApId: otherApId,
          type: "to"
        },
        update: {}
      });
    }
  });
  return c.json({
    message: {
      id: apId,
      sender: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url
      },
      content,
      created_at: now
    }
  }, 201);
});
var messages_default2 = dm2;

// src/backend/routes/dm.ts
var dm3 = new Hono2();
dm3.route("/", conversations_default);
dm3.route("/", messages_default2);
var dm_default = dm3;

// src/backend/routes/media.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var media = new Hono2();
var ALLOWED_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "video/mp4", "video/webm"];
var MAX_IMAGE_SIZE = 20 * 1024 * 1024;
var MAX_VIDEO_SIZE = 100 * 1024 * 1024;
var MAGIC_BYTES = {
  "image/jpeg": [
    { bytes: [255, 216, 255] }
    // JPEG/JFIF
  ],
  "image/png": [
    { bytes: [137, 80, 78, 71, 13, 10, 26, 10] }
    // PNG
  ],
  "image/gif": [
    { bytes: [71, 73, 70, 56, 55, 97] },
    // GIF87a
    { bytes: [71, 73, 70, 56, 57, 97] }
    // GIF89a
  ],
  "image/webp": [
    // RIFF....WEBP - check first 4 bytes (RIFF) and bytes 8-11 (WEBP)
    { bytes: [82, 73, 70, 70] }
    // RIFF header (we'll also check WEBP below)
  ],
  "video/mp4": [
    // ftyp box at offset 4 (bytes 4-7 are 'ftyp')
    // Common MP4 signatures: ftypisom, ftypmp42, ftypMSNV, ftypM4V, etc.
    { bytes: [102, 116, 121, 112] }
    // 'ftyp' at various offsets
  ],
  "video/webm": [
    { bytes: [26, 69, 223, 163] }
    // EBML/WebM/Matroska
  ]
};
function validateMagicBytes(buffer, mimeType) {
  const signatures = MAGIC_BYTES[mimeType];
  if (!signatures)
    return false;
  const bytes = new Uint8Array(buffer);
  if (mimeType === "image/webp") {
    const riff = [82, 73, 70, 70];
    const webp = [87, 69, 66, 80];
    if (bytes.length < 12)
      return false;
    const hasRiff = riff.every((b, i) => bytes[i] === b);
    const hasWebp = webp.every((b, i) => bytes[8 + i] === b);
    return hasRiff && hasWebp;
  }
  if (mimeType === "video/mp4") {
    const ftyp = [102, 116, 121, 112];
    if (bytes.length < 12)
      return false;
    const hasftypAt4 = ftyp.every((b, i) => bytes[4 + i] === b);
    const hasftypAt0 = ftyp.every((b, i) => bytes[i] === b);
    return hasftypAt4 || hasftypAt0;
  }
  for (const sig of signatures) {
    if (bytes.length < sig.bytes.length)
      continue;
    const matches = sig.bytes.every((byte, index) => {
      if (sig.mask) {
        return (bytes[index] & sig.mask[index]) === byte;
      }
      return bytes[index] === byte;
    });
    if (matches)
      return true;
  }
  return false;
}
__name(validateMagicBytes, "validateMagicBytes");
function getExtensionFromMimeType(mimeType) {
  const extensions = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm"
  };
  return extensions[mimeType] || null;
}
__name(getExtensionFromMimeType, "getExtensionFromMimeType");
function isValidMediaFilename(filename) {
  const pattern = /^[a-f0-9]+\.(jpg|png|gif|webp|mp4|webm)$/;
  if (!pattern.test(filename)) {
    return false;
  }
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\") || filename.includes("\0")) {
    return false;
  }
  return true;
}
__name(isValidMediaFilename, "isValidMediaFilename");
media.post("/upload", async (c) => {
  try {
    const actor = c.get("actor");
    if (!actor) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }
    const contentType = file.type;
    if (!ALLOWED_TYPES.includes(contentType)) {
      return c.json({
        error: "Invalid file type",
        allowed: ALLOWED_TYPES
      }, 400);
    }
    const isVideo = contentType.startsWith("video/");
    const maxSize = isVideo ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
    if (file.size > maxSize) {
      const maxMB = maxSize / 1024 / 1024;
      return c.json({
        error: `File too large. Maximum size is ${maxMB}MB for ${isVideo ? "videos" : "images"}`
      }, 413);
    }
    const arrayBuffer = await file.arrayBuffer();
    if (!validateMagicBytes(arrayBuffer, contentType)) {
      return c.json({
        error: "File content does not match declared type",
        hint: "The file appears to be a different format than specified"
      }, 400);
    }
    const id = generateId();
    const ext = getExtensionFromMimeType(contentType);
    if (!ext) {
      return c.json({ error: "Unsupported file type" }, 400);
    }
    const r2Key = `uploads/${id}.${ext}`;
    await c.env.MEDIA.put(r2Key, arrayBuffer, {
      httpMetadata: {
        contentType
      }
    });
    const prisma = c.get("prisma");
    await prisma.mediaUpload.create({
      data: {
        id,
        r2Key,
        uploaderApId: actor.ap_id,
        contentType,
        size: file.size
      }
    });
    const url = `/media/${id}.${ext}`;
    return c.json({
      url,
      r2_key: r2Key,
      content_type: contentType,
      id
    });
  } catch (error3) {
    console.error("Media upload failed:", error3 instanceof Error ? error3.message : "Unknown error");
    return c.json({ error: "Upload failed" }, 500);
  }
});
async function checkMediaAuthorization(prisma, mediaUrl, currentActorApId, r2Key) {
  const obj = await prisma.object.findFirst({
    where: {
      attachmentsJson: {
        contains: mediaUrl
      }
    },
    select: {
      apId: true,
      attributedTo: true,
      visibility: true,
      toJson: true
    }
  });
  if (!obj) {
    if (!currentActorApId) {
      return { allowed: false, reason: "Authentication required" };
    }
    const uploadRecord = await prisma.mediaUpload.findFirst({
      where: {
        r2Key,
        uploaderApId: currentActorApId
      }
    });
    if (!uploadRecord) {
      return { allowed: false, reason: "Not authorized to access this media" };
    }
    return { allowed: true };
  }
  if (obj.visibility === "public" || obj.visibility === "unlisted") {
    return { allowed: true };
  }
  if (!currentActorApId) {
    return { allowed: false, reason: "Authentication required" };
  }
  if (obj.attributedTo === currentActorApId) {
    return { allowed: true };
  }
  if (obj.visibility === "followers") {
    const follow2 = await prisma.follow.findUnique({
      where: {
        followerApId_followingApId: {
          followerApId: currentActorApId,
          followingApId: obj.attributedTo
        },
        status: "accepted"
      }
    });
    if (follow2) {
      return { allowed: true };
    }
    return { allowed: false, reason: "Not authorized" };
  }
  if (obj.visibility === "direct") {
    try {
      const recipients = JSON.parse(obj.toJson || "[]");
      if (recipients.includes(currentActorApId)) {
        return { allowed: true };
      }
    } catch {
    }
    return { allowed: false, reason: "Not authorized" };
  }
  return { allowed: false, reason: "Not authorized" };
}
__name(checkMediaAuthorization, "checkMediaAuthorization");
media.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    if (!id) {
      return c.notFound();
    }
    if (!isValidMediaFilename(id)) {
      return c.notFound();
    }
    const r2Key = `uploads/${id}`;
    if (!r2Key.startsWith("uploads/") || r2Key.includes("..")) {
      return c.notFound();
    }
    const actor = c.get("actor");
    const prisma = c.get("prisma");
    const mediaUrl = `/media/${id}`;
    const authResult = await checkMediaAuthorization(
      prisma,
      mediaUrl,
      actor?.ap_id || null,
      r2Key
    );
    if (!authResult.allowed) {
      return c.json({ error: authResult.reason || "Forbidden" }, 403);
    }
    const object = await c.env.MEDIA.get(r2Key);
    if (!object) {
      return c.notFound();
    }
    const contentType = object.httpMetadata?.contentType || "application/octet-stream";
    let cacheControl = "public, max-age=31536000";
    if (contentType.startsWith("video/")) {
      cacheControl = "public, max-age=604800";
    }
    return c.body(object.body, 200, {
      "Content-Type": contentType,
      "Cache-Control": cacheControl,
      "ETag": object.httpMetadata?.contentType || "true"
    });
  } catch (error3) {
    const errorMessage = error3 instanceof Error ? error3.message : "Unknown error";
    return c.json({ error: "Failed to fetch media", details: errorMessage }, 500);
  }
});
var media_default = media;

// src/backend/routes/activitypub.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/activitypub/utils.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var INSTANCE_ACTOR_USERNAME = "community";
var MAX_ROOM_STREAM_LIMIT = 50;
function roomApId(baseUrl, roomId) {
  return `${baseUrl}/ap/rooms/${roomId}`;
}
__name(roomApId, "roomApId");
async function getInstanceActor(c) {
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const apId = `${baseUrl}/ap/actor`;
  let actor = await prisma.instanceActor.findUnique({
    where: { apId }
  });
  if (!actor) {
    const { publicKeyPem, privateKeyPem } = await generateKeyPair();
    const now = (/* @__PURE__ */ new Date()).toISOString();
    actor = await prisma.instanceActor.create({
      data: {
        apId,
        preferredUsername: INSTANCE_ACTOR_USERNAME,
        name: "Yurucommu",
        summary: "Yurucommu Community",
        publicKeyPem,
        privateKeyPem,
        joinPolicy: "open",
        postingPolicy: "members",
        visibility: "public",
        createdAt: now,
        updatedAt: now
      }
    });
  }
  return {
    apId: actor.apId,
    preferredUsername: actor.preferredUsername,
    name: actor.name,
    summary: actor.summary,
    publicKeyPem: actor.publicKeyPem,
    privateKeyPem: actor.privateKeyPem,
    joinPolicy: actor.joinPolicy,
    postingPolicy: actor.postingPolicy,
    visibility: actor.visibility
  };
}
__name(getInstanceActor, "getInstanceActor");

// src/backend/routes/activitypub/inbox.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/routes/activitypub/inbox-types.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function getActivityObject(activity) {
  if (!activity.object || typeof activity.object === "string")
    return null;
  return activity.object;
}
__name(getActivityObject, "getActivityObject");
function getActivityObjectId(activity) {
  if (!activity.object)
    return null;
  if (typeof activity.object === "string")
    return activity.object;
  return activity.object.id || null;
}
__name(getActivityObjectId, "getActivityObjectId");

// src/backend/routes/activitypub/handlers/actorInboxHandlers.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
async function fetchRemoteInbox(c, actorApIdStr) {
  const prisma = c.get("prisma");
  const cached = await prisma.actorCache.findUnique({
    where: { apId: actorApIdStr },
    select: { inbox: true }
  });
  if (cached?.inbox) {
    if (!isSafeRemoteUrl(cached.inbox)) {
      console.warn(`[ActivityPub] Blocked unsafe inbox URL: ${cached.inbox}`);
      return null;
    }
    return cached.inbox;
  }
  try {
    if (!isSafeRemoteUrl(actorApIdStr)) {
      console.warn(`[ActivityPub] Blocked unsafe actor fetch: ${actorApIdStr}`);
      return null;
    }
    const res = await fetch(actorApIdStr, {
      headers: { "Accept": "application/activity+json, application/ld+json" }
    });
    if (!res.ok)
      return null;
    const actorData = await res.json();
    if (!actorData?.inbox || !isSafeRemoteUrl(actorData.inbox))
      return null;
    await prisma.actorCache.upsert({
      where: { apId: actorData.id },
      update: {
        type: actorData.type || "Person",
        preferredUsername: actorData.preferredUsername,
        name: actorData.name,
        summary: actorData.summary,
        iconUrl: actorData.icon?.url,
        inbox: actorData.inbox,
        outbox: actorData.outbox,
        publicKeyId: actorData.publicKey?.id,
        publicKeyPem: actorData.publicKey?.publicKeyPem,
        rawJson: JSON.stringify(actorData)
      },
      create: {
        apId: actorData.id,
        type: actorData.type || "Person",
        preferredUsername: actorData.preferredUsername,
        name: actorData.name,
        summary: actorData.summary,
        iconUrl: actorData.icon?.url,
        inbox: actorData.inbox,
        outbox: actorData.outbox,
        publicKeyId: actorData.publicKey?.id,
        publicKeyPem: actorData.publicKey?.publicKeyPem,
        rawJson: JSON.stringify(actorData)
      }
    });
    return actorData.inbox;
  } catch (e) {
    console.error("Failed to fetch remote actor:", e);
    return null;
  }
}
__name(fetchRemoteInbox, "fetchRemoteInbox");
async function handleGroupFollow(c, _activity, instanceActor, actorApIdStr, baseUrl, activityId) {
  const prisma = c.get("prisma");
  const existing = await prisma.follow.findUnique({
    where: {
      followerApId_followingApId: {
        followerApId: actorApIdStr,
        followingApId: instanceActor.apId
      }
    }
  });
  if (existing)
    return;
  let status = "accepted";
  if (instanceActor.joinPolicy === "approval") {
    status = "pending";
  } else if (instanceActor.joinPolicy === "invite") {
    status = "rejected";
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await prisma.follow.create({
    data: {
      followerApId: actorApIdStr,
      followingApId: instanceActor.apId,
      status,
      activityApId: activityId,
      acceptedAt: status === "accepted" ? now : null
    }
  });
  if (isLocal(actorApIdStr, baseUrl))
    return;
  if (status === "accepted" || status === "rejected") {
    const inboxUrl = await fetchRemoteInbox(c, actorApIdStr);
    if (!inboxUrl)
      return;
    if (!isSafeRemoteUrl(inboxUrl)) {
      console.warn(`[ActivityPub] Blocked unsafe inbox URL: ${inboxUrl}`);
      return;
    }
    const responseType = status === "accepted" ? "Accept" : "Reject";
    const responseId = activityApId(baseUrl, generateId());
    const responseActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: responseId,
      type: responseType,
      actor: instanceActor.apId,
      object: activityId
    };
    const keyId = `${instanceActor.apId}#main-key`;
    const headers = await signRequest(
      instanceActor.privateKeyPem,
      keyId,
      "POST",
      inboxUrl,
      JSON.stringify(responseActivity)
    );
    try {
      await fetchWithTimeout(inboxUrl, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/activity+json" },
        body: JSON.stringify(responseActivity),
        timeout: 15e3
        // 15 second timeout for ActivityPub federation
      });
    } catch (e) {
      console.error(`Failed to send ${responseType}:`, e);
    }
    await prisma.activity.create({
      data: {
        apId: responseId,
        type: responseType,
        actorApId: instanceActor.apId,
        objectApId: activityId,
        rawJson: JSON.stringify(responseActivity),
        direction: "outbound"
      }
    });
  }
}
__name(handleGroupFollow, "handleGroupFollow");
async function handleGroupUndo(c, activity, instanceActor) {
  const prisma = c.get("prisma");
  const objectId = getActivityObjectId(activity);
  if (!objectId)
    return;
  const follow2 = await prisma.follow.findFirst({
    where: {
      activityApId: objectId,
      followingApId: instanceActor.apId
    }
  });
  if (follow2) {
    await prisma.follow.delete({
      where: {
        followerApId_followingApId: {
          followerApId: follow2.followerApId,
          followingApId: follow2.followingApId
        }
      }
    });
    return;
  }
  if (getActivityObject(activity)?.type === "Follow") {
    await prisma.follow.deleteMany({
      where: {
        followerApId: activity.actor,
        followingApId: instanceActor.apId
      }
    });
  }
}
__name(handleGroupUndo, "handleGroupUndo");
async function handleGroupCreate(c, activity, instanceActor, actorApIdStr, baseUrl) {
  const prisma = c.get("prisma");
  const object = getActivityObject(activity);
  if (!object || object.type !== "Note")
    return;
  const roomUrl = object.room || activity.room;
  if (!roomUrl || typeof roomUrl !== "string")
    return;
  const match2 = roomUrl.match(/\/ap\/rooms\/([^\/]+)$/);
  if (!match2)
    return;
  const roomId = match2[1];
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { preferredUsername: roomId },
        { apId: roomId }
      ]
    },
    select: { apId: true, preferredUsername: true }
  });
  if (!community)
    return;
  const postingPolicy = instanceActor.postingPolicy || "members";
  if (postingPolicy !== "anyone") {
    const follow2 = await prisma.follow.findUnique({
      where: {
        followerApId_followingApId: {
          followerApId: actorApIdStr,
          followingApId: instanceActor.apId
        },
        status: "accepted"
      }
    });
    if (!follow2)
      return;
    if (postingPolicy === "mods" || postingPolicy === "owners")
      return;
  }
  const objectId = object.id || objectApId(baseUrl, generateId());
  const existing = await prisma.object.findUnique({
    where: { apId: objectId }
  });
  if (existing)
    return;
  const attachments = object.attachment ? JSON.stringify(object.attachment) : "[]";
  const now = object.published || (/* @__PURE__ */ new Date()).toISOString();
  await prisma.object.create({
    data: {
      apId: objectId,
      type: "Note",
      attributedTo: actorApIdStr,
      content: object.content || "",
      summary: object.summary || null,
      attachmentsJson: attachments,
      visibility: "group",
      communityApId: community.apId,
      published: now,
      isLocal: 0
    }
  });
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${objectId}, ${community.apId}, 'audience', ${now})
  `;
}
__name(handleGroupCreate, "handleGroupCreate");

// src/backend/routes/activitypub/handlers/userInboxHandlers.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
async function handleFollow(c, activity, recipient, actor, baseUrl) {
  const prisma = c.get("prisma");
  const activityId = activity.id || activityApId(baseUrl, generateId());
  const status = recipient.isPrivate ? "pending" : "accepted";
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const result = await prisma.follow.upsert({
    where: {
      followerApId_followingApId: {
        followerApId: actor,
        followingApId: recipient.apId
      }
    },
    update: {},
    // No update if already exists
    create: {
      followerApId: actor,
      followingApId: recipient.apId,
      status,
      activityApId: activityId,
      acceptedAt: status === "accepted" ? now : null
    }
  });
  const isNewFollow = result.activityApId === activityId;
  if (!isNewFollow)
    return;
  if (status === "accepted") {
    await prisma.actor.update({
      where: { apId: recipient.apId },
      data: { followerCount: { increment: 1 } }
    });
  }
  await prisma.activity.upsert({
    where: { apId: activityId },
    update: {},
    create: {
      apId: activityId,
      type: "Follow",
      actorApId: actor,
      objectApId: recipient.apId,
      rawJson: JSON.stringify(activity)
    }
  });
  await prisma.inbox.create({
    data: {
      actorApId: recipient.apId,
      activityApId: activityId,
      read: 0,
      createdAt: now
    }
  });
  if (!isLocal(actor, baseUrl)) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: actor },
      select: { inbox: true }
    });
    if (cachedActor?.inbox) {
      if (!isSafeRemoteUrl(cachedActor.inbox)) {
        console.warn(`[ActivityPub] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
        return;
      }
      const acceptId = activityApId(baseUrl, generateId());
      const acceptActivity = {
        "@context": "https://www.w3.org/ns/activitystreams",
        id: acceptId,
        type: "Accept",
        actor: recipient.apId,
        object: activityId
      };
      const keyId = `${recipient.apId}#main-key`;
      const headers = await signRequest(
        recipient.privateKeyPem,
        keyId,
        "POST",
        cachedActor.inbox,
        JSON.stringify(acceptActivity)
      );
      try {
        await fetchWithTimeout(cachedActor.inbox, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/activity+json" },
          body: JSON.stringify(acceptActivity),
          timeout: 15e3
          // 15 second timeout for ActivityPub federation
        });
      } catch (e) {
        console.error("Failed to send Accept:", e);
      }
      await prisma.activity.create({
        data: {
          apId: acceptId,
          type: "Accept",
          actorApId: recipient.apId,
          objectApId: activityId,
          rawJson: JSON.stringify(acceptActivity),
          direction: "outbound"
        }
      });
    }
  }
}
__name(handleFollow, "handleFollow");
async function handleAccept(c, activity) {
  const prisma = c.get("prisma");
  const followId = getActivityObjectId(activity);
  if (!followId)
    return;
  const follow2 = await prisma.follow.findFirst({
    where: { activityApId: followId }
  });
  if (!follow2)
    return;
  if (follow2.status === "accepted") {
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  try {
    await prisma.$transaction(async (tx) => {
      await tx.follow.update({
        where: {
          followerApId_followingApId: {
            followerApId: follow2.followerApId,
            followingApId: follow2.followingApId
          }
        },
        data: {
          status: "accepted",
          acceptedAt: now
        }
      });
      await tx.actor.update({
        where: { apId: follow2.followerApId },
        data: { followingCount: { increment: 1 } }
      });
      await tx.actor.update({
        where: { apId: follow2.followingApId },
        data: { followerCount: { increment: 1 } }
      });
    });
  } catch (e) {
    console.error("[ActivityPub] Transaction error in handleAccept:", e);
  }
}
__name(handleAccept, "handleAccept");
async function handleUndo(c, activity, recipient, actor, _baseUrl) {
  const prisma = c.get("prisma");
  const activityObject = getActivityObject(activity);
  const objectType = activityObject?.type;
  const objectId = getActivityObjectId(activity);
  if (!objectType && objectId) {
    const originalActivity = await prisma.activity.findUnique({
      where: { apId: objectId },
      select: { type: true, objectApId: true }
    });
    if (originalActivity) {
      if (originalActivity.type === "Follow") {
        const follow2 = await prisma.follow.findFirst({
          where: { activityApId: objectId }
        });
        if (follow2) {
          await prisma.follow.delete({
            where: {
              followerApId_followingApId: {
                followerApId: follow2.followerApId,
                followingApId: follow2.followingApId
              }
            }
          });
        }
        await prisma.actor.update({
          where: { apId: recipient.apId },
          data: { followerCount: { decrement: 1 } }
        });
      } else if (originalActivity.type === "Like" && originalActivity.objectApId) {
        const like = await prisma.like.findFirst({
          where: { activityApId: objectId }
        });
        if (like) {
          await prisma.like.delete({
            where: {
              actorApId_objectApId: {
                actorApId: like.actorApId,
                objectApId: like.objectApId
              }
            }
          });
        }
        await prisma.object.update({
          where: { apId: originalActivity.objectApId },
          data: { likeCount: { decrement: 1 } }
        });
      } else if (originalActivity.type === "Announce" && originalActivity.objectApId) {
        const announce = await prisma.announce.findFirst({
          where: { activityApId: objectId }
        });
        if (announce) {
          await prisma.announce.delete({
            where: {
              actorApId_objectApId: {
                actorApId: announce.actorApId,
                objectApId: announce.objectApId
              }
            }
          });
        }
        await prisma.object.update({
          where: { apId: originalActivity.objectApId },
          data: { announceCount: { decrement: 1 } }
        });
      }
      return;
    }
  }
  if (objectType === "Follow") {
    if (objectId) {
      const follow2 = await prisma.follow.findFirst({
        where: { activityApId: objectId }
      });
      if (follow2) {
        await prisma.follow.delete({
          where: {
            followerApId_followingApId: {
              followerApId: follow2.followerApId,
              followingApId: follow2.followingApId
            }
          }
        });
      } else {
        await prisma.follow.deleteMany({
          where: {
            followerApId: actor,
            followingApId: recipient.apId
          }
        });
      }
    } else {
      await prisma.follow.deleteMany({
        where: {
          followerApId: actor,
          followingApId: recipient.apId
        }
      });
    }
    await prisma.actor.update({
      where: { apId: recipient.apId },
      data: { followerCount: { decrement: 1 } }
    });
  } else if (objectType === "Like") {
    const likedObjectId = activityObject?.object;
    if (likedObjectId) {
      await prisma.like.deleteMany({
        where: {
          actorApId: actor,
          objectApId: likedObjectId
        }
      });
      await prisma.object.update({
        where: { apId: likedObjectId },
        data: { likeCount: { decrement: 1 } }
      });
    } else if (objectId) {
      const like = await prisma.like.findFirst({
        where: { activityApId: objectId }
      });
      if (like) {
        await prisma.like.delete({
          where: {
            actorApId_objectApId: {
              actorApId: like.actorApId,
              objectApId: like.objectApId
            }
          }
        });
        await prisma.object.update({
          where: { apId: like.objectApId },
          data: { likeCount: { decrement: 1 } }
        });
      } else {
        const recipientObjects = await prisma.object.findMany({
          where: { attributedTo: recipient.apId },
          select: { apId: true }
        });
        const objectApIds = recipientObjects.map((o) => o.apId);
        await prisma.like.deleteMany({
          where: {
            actorApId: actor,
            objectApId: { in: objectApIds }
          }
        });
      }
    }
  } else if (objectType === "Announce") {
    const announcedObjectId = activityObject?.object;
    if (announcedObjectId) {
      await prisma.announce.deleteMany({
        where: {
          actorApId: actor,
          objectApId: announcedObjectId
        }
      });
      await prisma.object.update({
        where: { apId: announcedObjectId },
        data: { announceCount: { decrement: 1 } }
      });
    } else if (objectId) {
      const announce = await prisma.announce.findFirst({
        where: { activityApId: objectId }
      });
      if (announce) {
        await prisma.announce.delete({
          where: {
            actorApId_objectApId: {
              actorApId: announce.actorApId,
              objectApId: announce.objectApId
            }
          }
        });
        await prisma.object.update({
          where: { apId: announce.objectApId },
          data: { announceCount: { decrement: 1 } }
        });
      }
    }
  }
}
__name(handleUndo, "handleUndo");
async function handleLike(c, activity, _recipient, actor, baseUrl) {
  const prisma = c.get("prisma");
  const objectId = getActivityObjectId(activity);
  if (!objectId)
    return;
  const activityId = activity.id || activityApId(baseUrl, generateId());
  const result = await prisma.like.upsert({
    where: {
      actorApId_objectApId: {
        actorApId: actor,
        objectApId: objectId
      }
    },
    update: {},
    // No update if already exists
    create: {
      actorApId: actor,
      objectApId: objectId,
      activityApId: activityId
    }
  });
  const isNewLike = result.activityApId === activityId;
  if (!isNewLike)
    return;
  await prisma.object.update({
    where: { apId: objectId },
    data: { likeCount: { increment: 1 } }
  });
  const likedObj = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { attributedTo: true }
  });
  if (likedObj && isLocal(likedObj.attributedTo, baseUrl)) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await prisma.activity.upsert({
      where: { apId: activityId },
      update: {},
      create: {
        apId: activityId,
        type: "Like",
        actorApId: actor,
        objectApId: objectId,
        rawJson: JSON.stringify(activity)
      }
    });
    await prisma.inbox.create({
      data: {
        actorApId: likedObj.attributedTo,
        activityApId: activityId,
        read: 0,
        createdAt: now
      }
    });
  }
}
__name(handleLike, "handleLike");
function isStoryType(type) {
  if (!type)
    return false;
  if (Array.isArray(type)) {
    return type.includes("Story");
  }
  return type === "Story";
}
__name(isStoryType, "isStoryType");
async function handleCreate(c, activity, _recipient, actor, baseUrl) {
  const prisma = c.get("prisma");
  const object = getActivityObject(activity);
  if (!object)
    return;
  if (isStoryType(object.type)) {
    await handleCreateStory(c, activity, actor, baseUrl);
    return;
  }
  if (object.type !== "Note")
    return;
  const objectId = object.id || objectApId(baseUrl, generateId());
  const existing = await prisma.object.findUnique({
    where: { apId: objectId }
  });
  if (existing)
    return;
  const attachments = object.attachment ? JSON.stringify(object.attachment) : "[]";
  await prisma.object.create({
    data: {
      apId: objectId,
      type: "Note",
      attributedTo: actor,
      content: object.content || "",
      summary: object.summary || null,
      attachmentsJson: attachments,
      inReplyTo: object.inReplyTo || null,
      visibility: object.to?.includes("https://www.w3.org/ns/activitystreams#Public") ? "public" : "unlisted",
      communityApId: null,
      published: object.published || (/* @__PURE__ */ new Date()).toISOString(),
      isLocal: 0
    }
  });
  await prisma.actor.update({
    where: { apId: actor },
    data: { postCount: { increment: 1 } }
  });
  if (object.inReplyTo) {
    await prisma.object.update({
      where: { apId: object.inReplyTo },
      data: { replyCount: { increment: 1 } }
    });
    const parentObj = await prisma.object.findUnique({
      where: { apId: object.inReplyTo },
      select: { attributedTo: true }
    });
    if (parentObj && isLocal(parentObj.attributedTo, baseUrl)) {
      const activityId = activity.id || activityApId(baseUrl, generateId());
      const now = (/* @__PURE__ */ new Date()).toISOString();
      await prisma.activity.upsert({
        where: { apId: activityId },
        update: {},
        create: {
          apId: activityId,
          type: "Create",
          actorApId: actor,
          objectApId: objectId,
          rawJson: JSON.stringify(activity)
        }
      });
      await prisma.inbox.create({
        data: {
          actorApId: parentObj.attributedTo,
          activityApId: activityId,
          read: 0,
          createdAt: now
        }
      });
    }
  }
}
__name(handleCreate, "handleCreate");
async function handleCreateStory(c, activity, actor, baseUrl) {
  const prisma = c.get("prisma");
  const object = getActivityObject(activity);
  if (!object)
    return;
  const objectId = object.id || objectApId(baseUrl, generateId());
  const existing = await prisma.object.findUnique({
    where: { apId: objectId }
  });
  if (existing)
    return;
  if (!object.attachment) {
    console.error("Remote story has no attachment:", objectId);
    return;
  }
  const attachmentArray = Array.isArray(object.attachment) ? object.attachment : [object.attachment];
  const attachment = attachmentArray[0];
  if (!attachment || !attachment.url) {
    console.error("Remote story attachment has no URL:", objectId);
    return;
  }
  let overlays = void 0;
  if (object.overlays) {
    if (!Array.isArray(object.overlays)) {
      overlays = void 0;
    } else {
      const filtered = object.overlays.filter(
        (o) => o && o.position && typeof o.position.x === "number" && typeof o.position.y === "number"
      );
      overlays = filtered.length > 0 ? filtered : void 0;
    }
  }
  const attachmentData = {
    attachment: {
      r2_key: "",
      // Remote stories don't have local R2 key
      content_type: attachment.mediaType || "image/jpeg",
      url: attachment.url,
      width: attachment.width || 1080,
      height: attachment.height || 1920
    },
    displayDuration: object.displayDuration || "PT5S",
    overlays
  };
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const endTime = object.endTime || new Date(Date.now() + 24 * 60 * 60 * 1e3).toISOString();
  await prisma.object.create({
    data: {
      apId: objectId,
      type: "Story",
      attributedTo: actor,
      content: "",
      attachmentsJson: JSON.stringify(attachmentData),
      endTime,
      published: object.published || now,
      isLocal: 0
    }
  });
  try {
    await prisma.actorCache.update({
      where: { apId: actor },
      data: {
        // ActorCache doesn't have postCount field, so this is a no-op
        // In the original code, this was also likely ineffective
      }
    });
  } catch {
  }
}
__name(handleCreateStory, "handleCreateStory");
async function handleDelete(c, activity) {
  const prisma = c.get("prisma");
  const objectId = getActivityObjectId(activity);
  if (!objectId)
    return;
  const actorId = typeof activity.actor === "string" ? activity.actor : null;
  if (!actorId) {
    console.warn(`[ActivityPub] Delete activity missing actor`);
    return;
  }
  const delObj = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { attributedTo: true, type: true, replyCount: true }
  });
  if (!delObj)
    return;
  if (delObj.attributedTo !== actorId) {
    console.warn(`[ActivityPub] Delete rejected: actor ${actorId} does not own object ${objectId} (owned by ${delObj.attributedTo})`);
    return;
  }
  if (delObj.type === "Story") {
    await prisma.storyVote.deleteMany({
      where: { storyApId: objectId }
    });
    await prisma.storyView.deleteMany({
      where: { storyApId: objectId }
    });
    await prisma.like.deleteMany({
      where: { objectApId: objectId }
    });
  }
  await prisma.object.delete({
    where: { apId: objectId }
  });
  await prisma.actor.update({
    where: { apId: delObj.attributedTo },
    data: { postCount: { decrement: 1 } }
  });
  if (delObj.type !== "Story") {
    await prisma.like.deleteMany({
      where: { objectApId: objectId }
    });
  }
}
__name(handleDelete, "handleDelete");
async function handleAnnounce(c, activity, _recipient, actor, baseUrl) {
  const prisma = c.get("prisma");
  const objectId = getActivityObjectId(activity);
  if (!objectId)
    return;
  const activityId = activity.id || activityApId(baseUrl, generateId());
  const result = await prisma.announce.upsert({
    where: {
      actorApId_objectApId: {
        actorApId: actor,
        objectApId: objectId
      }
    },
    update: {},
    // No update if already exists
    create: {
      actorApId: actor,
      objectApId: objectId,
      activityApId: activityId
    }
  });
  const isNewAnnounce = result.activityApId === activityId;
  if (!isNewAnnounce)
    return;
  await prisma.object.update({
    where: { apId: objectId },
    data: { announceCount: { increment: 1 } }
  });
  const announcedObj = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { attributedTo: true }
  });
  if (announcedObj && isLocal(announcedObj.attributedTo, baseUrl)) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await prisma.activity.upsert({
      where: { apId: activityId },
      update: {},
      create: {
        apId: activityId,
        type: "Announce",
        actorApId: actor,
        objectApId: objectId,
        rawJson: JSON.stringify(activity)
      }
    });
    await prisma.inbox.create({
      data: {
        actorApId: announcedObj.attributedTo,
        activityApId: activityId,
        read: 0,
        createdAt: now
      }
    });
  }
}
__name(handleAnnounce, "handleAnnounce");
async function handleUpdate(c, activity, actor) {
  const prisma = c.get("prisma");
  const object = getActivityObject(activity);
  if (!object)
    return;
  const objectId = object.id;
  if (!objectId)
    return;
  const existing = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { apId: true, attributedTo: true }
  });
  if (!existing || existing.attributedTo !== actor)
    return;
  if (object.type === "Note") {
    const attachments = object.attachment ? JSON.stringify(object.attachment) : void 0;
    await prisma.object.update({
      where: { apId: objectId },
      data: {
        content: object.content || void 0,
        summary: object.summary || void 0,
        attachmentsJson: attachments || void 0,
        updated: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
  }
}
__name(handleUpdate, "handleUpdate");
async function handleReject(c, activity) {
  const prisma = c.get("prisma");
  const followId = getActivityObjectId(activity);
  if (!followId)
    return;
  const follow2 = await prisma.follow.findFirst({
    where: { activityApId: followId }
  });
  if (!follow2)
    return;
  await prisma.follow.delete({
    where: {
      followerApId_followingApId: {
        followerApId: follow2.followerApId,
        followingApId: follow2.followingApId
      }
    }
  });
}
__name(handleReject, "handleReject");

// src/backend/routes/activitypub/inbox.ts
function parseSignatureHeader(signatureHeader) {
  const params = {};
  const regex = /(\w+)="([^"]+)"/g;
  let match2;
  while ((match2 = regex.exec(signatureHeader)) !== null) {
    params[match2[1]] = match2[2];
  }
  if (!params.keyId || !params.signature || !params.headers) {
    return null;
  }
  return {
    keyId: params.keyId,
    algorithm: params.algorithm || "rsa-sha256",
    headers: params.headers.split(" "),
    signature: params.signature
  };
}
__name(parseSignatureHeader, "parseSignatureHeader");
async function fetchActorPublicKey(keyId, c) {
  if (!isSafeRemoteUrl(keyId)) {
    console.warn(`[HTTP Signature] Blocked unsafe keyId URL: ${keyId}`);
    return null;
  }
  const prisma = c.get("prisma");
  const actorUrl = keyId.includes("#") ? keyId.split("#")[0] : keyId;
  const cached = await prisma.actorCache.findUnique({
    where: { apId: actorUrl },
    select: { publicKeyPem: true }
  });
  if (cached?.publicKeyPem) {
    return cached.publicKeyPem;
  }
  try {
    const res = await fetch(actorUrl, {
      headers: { "Accept": "application/activity+json, application/ld+json" }
    });
    if (!res.ok) {
      console.warn(`[HTTP Signature] Failed to fetch actor: ${res.status}`);
      return null;
    }
    const actorData = await res.json();
    if (!actorData?.publicKey?.publicKeyPem) {
      console.warn(`[HTTP Signature] Actor has no public key`);
      return null;
    }
    if (actorData.id && actorData.inbox && isSafeRemoteUrl(actorData.id) && isSafeRemoteUrl(actorData.inbox)) {
      await prisma.actorCache.upsert({
        where: { apId: actorData.id },
        update: {
          type: actorData.type || "Person",
          preferredUsername: actorData.preferredUsername,
          name: actorData.name,
          summary: actorData.summary,
          iconUrl: actorData.icon?.url,
          inbox: actorData.inbox,
          publicKeyPem: actorData.publicKey.publicKeyPem,
          rawJson: JSON.stringify(actorData)
        },
        create: {
          apId: actorData.id,
          type: actorData.type || "Person",
          preferredUsername: actorData.preferredUsername,
          name: actorData.name,
          summary: actorData.summary,
          iconUrl: actorData.icon?.url,
          inbox: actorData.inbox,
          publicKeyPem: actorData.publicKey.publicKeyPem,
          rawJson: JSON.stringify(actorData)
        }
      });
    }
    return actorData.publicKey.publicKeyPem;
  } catch (e) {
    console.error(`[HTTP Signature] Error fetching actor:`, e);
    return null;
  }
}
__name(fetchActorPublicKey, "fetchActorPublicKey");
var MAX_SIGNATURE_AGE_MS = 5 * 60 * 1e3;
async function verifyHttpSignature(c, body) {
  const signatureHeader = c.req.header("Signature");
  if (!signatureHeader) {
    return { valid: false, error: "Missing Signature header" };
  }
  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return { valid: false, error: "Invalid Signature header format" };
  }
  const dateHeader = c.req.header("date");
  if (dateHeader) {
    const requestDate = new Date(dateHeader);
    if (isNaN(requestDate.getTime())) {
      return { valid: false, error: "Invalid Date header format" };
    }
    const now = Date.now();
    const requestTime = requestDate.getTime();
    const timeDiff = Math.abs(now - requestTime);
    if (timeDiff > MAX_SIGNATURE_AGE_MS) {
      console.warn(`[HTTP Signature] Request too old/new: ${timeDiff}ms difference`);
      return { valid: false, error: "Request timestamp outside acceptable window" };
    }
  } else if (parsed.headers.includes("date")) {
    return { valid: false, error: "Missing Date header required by signature" };
  }
  if (parsed.algorithm !== "rsa-sha256") {
    return { valid: false, error: `Unsupported algorithm: ${parsed.algorithm}` };
  }
  const url = new URL(c.req.url);
  const signatureParts = [];
  for (const headerName of parsed.headers) {
    if (headerName === "(request-target)") {
      signatureParts.push(`(request-target): ${c.req.method.toLowerCase()} ${url.pathname}`);
    } else {
      const headerValue = c.req.header(headerName);
      if (!headerValue) {
        return { valid: false, error: `Missing required header: ${headerName}` };
      }
      signatureParts.push(`${headerName}: ${headerValue}`);
    }
  }
  const signatureString = signatureParts.join("\n");
  if (parsed.headers.includes("digest")) {
    const digestHeader = c.req.header("digest");
    if (!digestHeader) {
      return { valid: false, error: "Digest header missing but required by signature" };
    }
    const bodyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const expectedDigest = `SHA-256=${btoa(String.fromCharCode(...new Uint8Array(bodyHash)))}`;
    if (digestHeader !== expectedDigest) {
      return { valid: false, error: "Digest mismatch" };
    }
  }
  const publicKeyPem = await fetchActorPublicKey(parsed.keyId, c);
  if (!publicKeyPem) {
    return { valid: false, error: "Could not fetch public key" };
  }
  try {
    const pemContents = publicKeyPem.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
    const binaryKey = Uint8Array.from(atob(pemContents), (ch) => ch.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      binaryKey,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const signatureBytes = Uint8Array.from(atob(parsed.signature), (ch) => ch.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signatureBytes,
      new TextEncoder().encode(signatureString)
    );
    if (!valid) {
      return { valid: false, error: "Signature verification failed" };
    }
    return { valid: true, keyId: parsed.keyId };
  } catch (e) {
    console.error("[HTTP Signature] Verification error:", e);
    return { valid: false, error: "Signature verification error" };
  }
}
__name(verifyHttpSignature, "verifyHttpSignature");
var ap = new Hono2();
ap.post("/ap/actor/inbox", async (c) => {
  const prisma = c.get("prisma");
  const instanceActor = await getInstanceActor(c);
  const baseUrl = c.env.APP_URL;
  const body = await c.req.text();
  const signatureResult = await verifyHttpSignature(c, body);
  if (!signatureResult.valid) {
    console.warn(`[ActivityPub] Signature verification failed: ${signatureResult.error}`);
    return c.json({ error: "Signature verification failed" }, 401);
  }
  let activity;
  try {
    activity = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const activityId = typeof activity.id === "string" ? activity.id : activityApId(baseUrl, generateId());
  const actor = typeof activity.actor === "string" ? activity.actor : null;
  const activityType = typeof activity.type === "string" ? activity.type : null;
  const activityObjectId = getActivityObjectId(activity);
  if (!actor || !activityType) {
    return c.json({ error: "Invalid activity" }, 400);
  }
  const signingActorUrl = signatureResult.keyId?.includes("#") ? signatureResult.keyId.split("#")[0] : signatureResult.keyId;
  let actorMismatch = signingActorUrl !== actor;
  if (actorMismatch && signingActorUrl && actor) {
    try {
      const signingDomain = new URL(signingActorUrl).hostname;
      const actorDomain = new URL(actor).hostname;
      if (signingDomain === actorDomain) {
        console.info(`[ActivityPub] Accepting key delegation: signing key ${signingActorUrl} for actor ${actor} (same domain: ${signingDomain})`);
        actorMismatch = false;
      }
    } catch {
    }
  }
  if (actorMismatch) {
    console.warn(`[ActivityPub] Actor mismatch: activity actor ${actor} does not match signing key ${signingActorUrl}`);
    return c.json({ error: "Actor mismatch" }, 401);
  }
  const existingActivity = await prisma.activity.findUnique({
    where: { apId: activityId },
    select: { apId: true, rawJson: true }
  });
  if (existingActivity) {
    const existingRaw = existingActivity.rawJson;
    const newRaw = JSON.stringify(activity);
    if (existingRaw !== newRaw) {
      console.warn(`[ActivityPub] Duplicate activity ${activityId} received with different content`);
    }
    return c.json({ success: true });
  }
  await prisma.activity.create({
    data: {
      apId: activityId,
      type: activityType,
      actorApId: actor,
      objectApId: activityObjectId,
      rawJson: JSON.stringify(activity),
      direction: "inbound"
    }
  });
  switch (activityType) {
    case "Follow":
      await handleGroupFollow(c, activity, instanceActor, actor, baseUrl, activityId);
      break;
    case "Undo":
      await handleGroupUndo(c, activity, instanceActor);
      break;
    case "Create":
      await handleGroupCreate(c, activity, instanceActor, actor, baseUrl);
      break;
    default:
  }
  return c.json({ success: true });
});
ap.post("/ap/users/:username/inbox", async (c) => {
  const prisma = c.get("prisma");
  const username = c.req.param("username");
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);
  const recipient = await prisma.actor.findUnique({
    where: { apId }
  });
  if (!recipient)
    return c.json({ error: "Actor not found" }, 404);
  const body = await c.req.text();
  const signatureResult = await verifyHttpSignature(c, body);
  if (!signatureResult.valid) {
    console.warn(`[ActivityPub] Signature verification failed for ${username}: ${signatureResult.error}`);
    return c.json({ error: "Signature verification failed" }, 401);
  }
  let activity;
  try {
    activity = JSON.parse(body);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const activityId = typeof activity.id === "string" ? activity.id : activityApId(baseUrl, generateId());
  const actor = typeof activity.actor === "string" ? activity.actor : null;
  const activityType = typeof activity.type === "string" ? activity.type : null;
  const activityObjectId = getActivityObjectId(activity);
  if (!actor || !activityType) {
    return c.json({ error: "Invalid activity" }, 400);
  }
  const signingActorUrl = signatureResult.keyId?.includes("#") ? signatureResult.keyId.split("#")[0] : signatureResult.keyId;
  let actorMismatch = signingActorUrl !== actor;
  if (actorMismatch && signingActorUrl && actor) {
    try {
      const signingDomain = new URL(signingActorUrl).hostname;
      const actorDomain = new URL(actor).hostname;
      if (signingDomain === actorDomain) {
        console.info(`[ActivityPub] Accepting key delegation: signing key ${signingActorUrl} for actor ${actor} (same domain: ${signingDomain})`);
        actorMismatch = false;
      }
    } catch {
    }
  }
  if (actorMismatch) {
    console.warn(`[ActivityPub] Actor mismatch: activity actor ${actor} does not match signing key ${signingActorUrl}`);
    return c.json({ error: "Actor mismatch" }, 401);
  }
  const existingActivity = await prisma.activity.findUnique({
    where: { apId: activityId },
    select: { apId: true, rawJson: true }
  });
  if (existingActivity) {
    const existingRaw = existingActivity.rawJson;
    const newRaw = JSON.stringify(activity);
    if (existingRaw !== newRaw) {
      console.warn(`[ActivityPub] Duplicate activity ${activityId} received with different content. Original: ${existingRaw.substring(0, 200)}... New: ${newRaw.substring(0, 200)}...`);
    }
    return c.json({ success: true });
  }
  await prisma.activity.create({
    data: {
      apId: activityId,
      type: activityType,
      actorApId: actor,
      objectApId: activityObjectId,
      rawJson: JSON.stringify(activity),
      direction: "inbound"
    }
  });
  if (!isLocal(actor, baseUrl)) {
    const cached = await prisma.actorCache.findUnique({
      where: { apId: actor },
      select: { apId: true }
    });
    if (!cached) {
      try {
        if (!isSafeRemoteUrl(actor)) {
          console.warn(`[ActivityPub] Blocked unsafe actor fetch: ${actor}`);
        } else {
          const res = await fetch(actor, {
            headers: { "Accept": "application/activity+json, application/ld+json" }
          });
          if (res.ok) {
            const actorData = await res.json();
            if (actorData?.id !== actor) {
              console.warn(`[ActivityPub] Actor ID mismatch: fetched ${actor} but got id ${actorData?.id}`);
            } else if (actorData?.id && actorData?.inbox && isSafeRemoteUrl(actorData.id) && isSafeRemoteUrl(actorData.inbox)) {
              await prisma.actorCache.create({
                data: {
                  apId: actorData.id,
                  type: actorData.type || "Person",
                  preferredUsername: actorData.preferredUsername,
                  name: actorData.name,
                  summary: actorData.summary,
                  iconUrl: actorData.icon?.url,
                  inbox: actorData.inbox,
                  publicKeyPem: actorData.publicKey?.publicKeyPem,
                  rawJson: JSON.stringify(actorData)
                }
              });
            }
          }
        }
      } catch (e) {
        console.error("Failed to cache remote actor:", e);
      }
    }
  }
  switch (activityType) {
    case "Follow":
      await handleFollow(c, activity, recipient, actor, baseUrl);
      break;
    case "Accept":
      await handleAccept(c, activity);
      break;
    case "Undo":
      await handleUndo(c, activity, recipient, actor, baseUrl);
      break;
    case "Like":
      await handleLike(c, activity, recipient, actor, baseUrl);
      break;
    case "Create":
      await handleCreate(c, activity, recipient, actor, baseUrl);
      break;
    case "Delete":
      await handleDelete(c, activity);
      break;
    case "Announce":
      await handleAnnounce(c, activity, recipient, actor, baseUrl);
      break;
    case "Update":
      await handleUpdate(c, activity, actor);
      break;
    case "Reject":
      await handleReject(c, activity);
      break;
    case "Add":
    case "Remove":
    case "Block":
    case "Flag":
    case "Move":
      break;
    default:
      if (activityType) {
        console.warn(`[ActivityPub] Unhandled activity type: ${activityType} from ${actor}`);
      }
  }
  return c.json({ success: true });
});
var inbox_default = ap;

// src/backend/routes/activitypub/outbox.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var ap2 = new Hono2();
ap2.get("/ap/actor/outbox", async (c) => {
  const prisma = c.get("prisma");
  const instanceActor = await getInstanceActor(c);
  const page = c.req.query("page");
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 20;
  const offset = (pageNum - 1) * limit;
  const activities = await prisma.activity.findMany({
    where: {
      actorApId: instanceActor.apId,
      direction: "outbound"
    },
    select: { rawJson: true },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset
  });
  const totalCount = await prisma.activity.count({
    where: {
      actorApId: instanceActor.apId,
      direction: "outbound"
    }
  });
  const outboxUrl = `${instanceActor.apId}/outbox`;
  if (page) {
    return c.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${outboxUrl}?page=${pageNum}`,
      type: "OrderedCollectionPage",
      partOf: outboxUrl,
      orderedItems: activities.map((a) => JSON.parse(a.rawJson))
    });
  }
  return c.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: outboxUrl,
    type: "OrderedCollection",
    totalItems: totalCount,
    first: `${outboxUrl}?page=1`
  });
});
ap2.get("/ap/actor/followers", async (c) => {
  const prisma = c.get("prisma");
  const instanceActor = await getInstanceActor(c);
  const page = c.req.query("page");
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 50;
  const offset = (pageNum - 1) * limit;
  const followers = await prisma.follow.findMany({
    where: {
      followingApId: instanceActor.apId,
      status: "accepted"
    },
    select: { followerApId: true },
    orderBy: { acceptedAt: "desc" },
    take: limit,
    skip: offset
  });
  const totalCount = await prisma.follow.count({
    where: {
      followingApId: instanceActor.apId,
      status: "accepted"
    }
  });
  const followersUrl = `${instanceActor.apId}/followers`;
  if (page) {
    return c.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${followersUrl}?page=${pageNum}`,
      type: "OrderedCollectionPage",
      partOf: followersUrl,
      orderedItems: followers.map((f) => f.followerApId)
    });
  }
  return c.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: followersUrl,
    type: "OrderedCollection",
    totalItems: totalCount,
    first: `${followersUrl}?page=1`
  });
});
ap2.get("/ap/actor/following", async (c) => {
  const instanceActor = await getInstanceActor(c);
  const followingUrl = `${instanceActor.apId}/following`;
  return c.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: followingUrl,
    type: "OrderedCollection",
    totalItems: 0,
    first: `${followingUrl}?page=1`
  });
});
ap2.get("/ap/users/:username/outbox", async (c) => {
  const prisma = c.get("prisma");
  const username = c.req.param("username");
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);
  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true }
  });
  if (!actor)
    return c.json({ error: "Actor not found" }, 404);
  const page = c.req.query("page");
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 20;
  const offset = (pageNum - 1) * limit;
  const activities = await prisma.activity.findMany({
    where: {
      actorApId: apId,
      direction: "outbound"
    },
    select: { rawJson: true },
    orderBy: { createdAt: "desc" },
    take: limit,
    skip: offset
  });
  const totalCount = await prisma.activity.count({
    where: {
      actorApId: apId,
      direction: "outbound"
    }
  });
  const outboxUrl = `${apId}/outbox`;
  if (page) {
    return c.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${outboxUrl}?page=${pageNum}`,
      type: "OrderedCollectionPage",
      partOf: outboxUrl,
      orderedItems: activities.map((a) => JSON.parse(a.rawJson))
    });
  } else {
    return c.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: outboxUrl,
      type: "OrderedCollection",
      totalItems: totalCount,
      first: `${outboxUrl}?page=1`
    });
  }
});
ap2.get("/ap/users/:username/followers", async (c) => {
  const prisma = c.get("prisma");
  const username = c.req.param("username");
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);
  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true }
  });
  if (!actor)
    return c.json({ error: "Actor not found" }, 404);
  const page = c.req.query("page");
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 50;
  const offset = (pageNum - 1) * limit;
  const followers = await prisma.follow.findMany({
    where: {
      followingApId: apId,
      status: "accepted"
    },
    select: { followerApId: true },
    orderBy: { acceptedAt: "desc" },
    take: limit,
    skip: offset
  });
  const totalCount = await prisma.follow.count({
    where: {
      followingApId: apId,
      status: "accepted"
    }
  });
  const followersUrl = `${apId}/followers`;
  if (page) {
    return c.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${followersUrl}?page=${pageNum}`,
      type: "OrderedCollectionPage",
      partOf: followersUrl,
      orderedItems: followers.map((f) => f.followerApId)
    });
  } else {
    return c.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: followersUrl,
      type: "OrderedCollection",
      totalItems: totalCount,
      first: `${followersUrl}?page=1`
    });
  }
});
ap2.get("/ap/users/:username/following", async (c) => {
  const prisma = c.get("prisma");
  const username = c.req.param("username");
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);
  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true }
  });
  if (!actor)
    return c.json({ error: "Actor not found" }, 404);
  const page = c.req.query("page");
  const pageNum = page ? parseInt(page, 10) : 1;
  const limit = 50;
  const offset = (pageNum - 1) * limit;
  const following = await prisma.follow.findMany({
    where: {
      followerApId: apId,
      status: "accepted"
    },
    select: { followingApId: true },
    orderBy: { acceptedAt: "desc" },
    take: limit,
    skip: offset
  });
  const totalCount = await prisma.follow.count({
    where: {
      followerApId: apId,
      status: "accepted"
    }
  });
  const followingUrl = `${apId}/following`;
  if (page) {
    return c.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: `${followingUrl}?page=${pageNum}`,
      type: "OrderedCollectionPage",
      partOf: followingUrl,
      orderedItems: following.map((f) => f.followingApId)
    });
  } else {
    return c.json({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: followingUrl,
      type: "OrderedCollection",
      totalItems: totalCount,
      first: `${followingUrl}?page=1`
    });
  }
});
ap2.get("/ap/objects/:id", async (c) => {
  const prisma = c.get("prisma");
  const id = c.req.param("id");
  const baseUrl = c.env.APP_URL;
  const objApId = objectApId(baseUrl, id);
  const obj = await prisma.object.findUnique({
    where: { apId: objApId },
    select: {
      apId: true,
      type: true,
      attributedTo: true,
      content: true,
      summary: true,
      attachmentsJson: true,
      inReplyTo: true,
      visibility: true,
      published: true,
      likeCount: true,
      replyCount: true,
      announceCount: true
    }
  });
  if (!obj)
    return c.json({ error: "Object not found" }, 404);
  let attachments = [];
  try {
    attachments = JSON.parse(obj.attachmentsJson);
  } catch {
    attachments = [];
  }
  const objectResponse = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1"
    ],
    id: obj.apId,
    type: obj.type,
    attributedTo: obj.attributedTo,
    content: obj.content,
    summary: obj.summary,
    inReplyTo: obj.inReplyTo,
    published: obj.published,
    to: [
      obj.visibility === "public" ? "https://www.w3.org/ns/activitystreams#Public" : void 0,
      `${obj.attributedTo}/followers`
    ].filter(Boolean),
    attachment: attachments.length > 0 ? attachments : void 0,
    likes: {
      id: `${obj.apId}/likes`,
      type: "Collection",
      totalItems: obj.likeCount
    },
    replies: {
      id: `${obj.apId}/replies`,
      type: "Collection",
      totalItems: obj.replyCount
    }
  };
  Object.keys(objectResponse).forEach((key) => {
    if (objectResponse[key] === void 0) {
      delete objectResponse[key];
    }
  });
  c.header("Content-Type", "application/activity+json");
  return c.json(objectResponse);
});
var outbox_default = ap2;

// src/backend/routes/activitypub.ts
var ap3 = new Hono2();
ap3.get("/.well-known/webfinger", withCache({
  ttl: CacheTTL.WEBFINGER,
  cacheTag: CacheTags.WEBFINGER,
  queryParamsToInclude: ["resource"]
}), async (c) => {
  const prisma = c.get("prisma");
  const resource = c.req.query("resource");
  if (!resource)
    return c.json({ error: "resource parameter required" }, 400);
  let username = null;
  let domain2 = null;
  if (resource.startsWith("acct:")) {
    const acctPart = resource.slice(5);
    const [user, host] = acctPart.split("@");
    username = user;
    domain2 = host;
  } else if (resource.startsWith("http")) {
    try {
      const url = new URL(resource);
      domain2 = url.host;
      const match2 = resource.match(/\/users\/([^\/]+)$/);
      if (match2) {
        username = match2[1];
      }
    } catch {
      return c.json({ error: "Invalid resource format" }, 400);
    }
  } else {
    return c.json({ error: "Invalid resource format" }, 400);
  }
  if (!username || !domain2)
    return c.json({ error: "Invalid resource format" }, 400);
  const baseUrl = c.env.APP_URL;
  const currentDomain = getDomain(baseUrl);
  if (domain2 !== currentDomain) {
    return c.json({ error: "Actor not found" }, 404);
  }
  if (username === INSTANCE_ACTOR_USERNAME) {
    const instanceActor = await getInstanceActor(c);
    return c.json({
      subject: `acct:${INSTANCE_ACTOR_USERNAME}@${domain2}`,
      aliases: [instanceActor.apId],
      links: [
        {
          rel: "self",
          type: "application/activity+json",
          href: instanceActor.apId
        },
        {
          rel: "http://webfinger.net/rel/profile-page",
          type: "text/html",
          href: `${baseUrl}/groups`
        }
      ]
    });
  }
  const actor = await prisma.actor.findUnique({
    where: { preferredUsername: username },
    select: { apId: true, preferredUsername: true }
  });
  if (!actor)
    return c.json({ error: "Actor not found" }, 404);
  return c.json({
    subject: `acct:${username}@${domain2}`,
    aliases: [actor.apId],
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: actor.apId
      },
      {
        rel: "http://webfinger.net/rel/profile-page",
        type: "text/html",
        href: `${baseUrl}/users/${username}`
      }
    ]
  });
});
ap3.get("/ap/users/:username", withCache({
  ttl: CacheTTL.ACTIVITYPUB_ACTOR,
  cacheTag: CacheTags.ACTOR
}), async (c) => {
  const prisma = c.get("prisma");
  const username = c.req.param("username");
  const baseUrl = c.env.APP_URL;
  const apId = actorApId(baseUrl, username);
  const actor = await prisma.actor.findUnique({
    where: { apId },
    select: {
      apId: true,
      type: true,
      preferredUsername: true,
      name: true,
      summary: true,
      iconUrl: true,
      headerUrl: true,
      inbox: true,
      outbox: true,
      followersUrl: true,
      followingUrl: true,
      publicKeyPem: true,
      followerCount: true,
      followingCount: true,
      postCount: true,
      isPrivate: true,
      createdAt: true
    }
  });
  if (!actor)
    return c.json({ error: "Actor not found" }, 404);
  const actorResponse = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1"
    ],
    id: actor.apId,
    type: actor.type,
    preferredUsername: actor.preferredUsername,
    name: actor.name,
    summary: actor.summary,
    url: `${baseUrl}/users/${username}`,
    icon: actor.iconUrl ? { type: "Image", url: actor.iconUrl } : void 0,
    image: actor.headerUrl ? { type: "Image", url: actor.headerUrl } : void 0,
    inbox: actor.inbox,
    outbox: actor.outbox,
    followers: actor.followersUrl,
    following: actor.followingUrl,
    publicKey: {
      id: `${actor.apId}#main-key`,
      owner: actor.apId,
      publicKeyPem: actor.publicKeyPem
    },
    discoverable: !actor.isPrivate,
    published: actor.createdAt
  };
  Object.keys(actorResponse).forEach((key) => {
    if (actorResponse[key] === void 0) {
      delete actorResponse[key];
    }
  });
  c.header("Content-Type", "application/activity+json");
  return c.json(actorResponse);
});
ap3.get("/ap/actor", withCache({
  ttl: CacheTTL.ACTIVITYPUB_ACTOR,
  cacheTag: CacheTags.COMMUNITY
}), async (c) => {
  const baseUrl = c.env.APP_URL;
  const instanceActor = await getInstanceActor(c);
  const actorResponse = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
      {
        apc: "https://yurucommu.com/ns/apc#",
        rooms: { "@id": "apc:rooms", "@type": "@id" },
        joinPolicy: "apc:joinPolicy",
        postingPolicy: "apc:postingPolicy",
        visibility: "apc:visibility"
      }
    ],
    id: instanceActor.apId,
    type: "Group",
    preferredUsername: instanceActor.preferredUsername,
    name: instanceActor.name || "Yurucommu",
    summary: instanceActor.summary || "",
    inbox: `${baseUrl}/ap/actor/inbox`,
    outbox: `${baseUrl}/ap/actor/outbox`,
    followers: `${baseUrl}/ap/actor/followers`,
    following: `${baseUrl}/ap/actor/following`,
    publicKey: {
      id: `${instanceActor.apId}#main-key`,
      owner: instanceActor.apId,
      publicKeyPem: instanceActor.publicKeyPem
    },
    rooms: `${baseUrl}/ap/rooms`,
    joinPolicy: instanceActor.joinPolicy || "open",
    postingPolicy: instanceActor.postingPolicy || "members",
    visibility: instanceActor.visibility || "public"
  };
  c.header("Content-Type", "application/activity+json");
  return c.json(actorResponse);
});
ap3.get("/ap/rooms", withCache({
  ttl: CacheTTL.COMMUNITY,
  cacheTag: CacheTags.COMMUNITY
}), async (c) => {
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const rooms = await prisma.community.findMany({
    select: {
      preferredUsername: true,
      name: true,
      summary: true
    },
    orderBy: { createdAt: "asc" }
  });
  const items = rooms.map((room) => ({
    id: roomApId(baseUrl, room.preferredUsername),
    type: "Room",
    name: room.name,
    summary: room.summary || ""
  }));
  return c.json({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        "apc": "https://yurucommu.com/ns/apc#",
        "Room": "apc:Room"
      }
    ],
    id: `${baseUrl}/ap/rooms`,
    type: "OrderedCollection",
    totalItems: items.length,
    orderedItems: items
  });
});
ap3.get("/ap/rooms/:roomId", async (c) => {
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const roomId = c.req.param("roomId");
  const room = await prisma.community.findFirst({
    where: {
      OR: [
        { preferredUsername: roomId },
        { apId: roomId }
      ]
    },
    select: {
      preferredUsername: true,
      name: true,
      summary: true
    }
  });
  if (!room)
    return c.json({ error: "Room not found" }, 404);
  return c.json({
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        "apc": "https://yurucommu.com/ns/apc#",
        "Room": "apc:Room",
        "stream": { "@id": "apc:stream", "@type": "@id" }
      }
    ],
    id: roomApId(baseUrl, room.preferredUsername),
    type: "Room",
    name: room.name,
    summary: room.summary || "",
    stream: `${roomApId(baseUrl, room.preferredUsername)}/stream`
  });
});
ap3.get("/ap/rooms/:roomId/stream", async (c) => {
  const prisma = c.get("prisma");
  const baseUrl = c.env.APP_URL;
  const roomId = c.req.param("roomId");
  const limit = parseLimit(c.req.query("limit"), 20, MAX_ROOM_STREAM_LIMIT);
  const before = c.req.query("before");
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { preferredUsername: roomId },
        { apId: roomId }
      ]
    },
    select: {
      apId: true,
      preferredUsername: true
    }
  });
  if (!community)
    return c.json({ error: "Room not found" }, 404);
  const objects = await prisma.object.findMany({
    where: {
      type: "Note",
      communityApId: community.apId,
      ...before ? { published: { lt: before } } : {}
    },
    select: {
      apId: true,
      attributedTo: true,
      content: true,
      published: true
    },
    orderBy: { published: "desc" },
    take: limit
  });
  const items = objects.map((o) => ({
    id: o.apId,
    type: "Note",
    attributedTo: o.attributedTo,
    content: o.content,
    published: o.published,
    room: roomApId(baseUrl, community.preferredUsername)
  }));
  return c.json({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${roomApId(baseUrl, community.preferredUsername)}/stream`,
    type: "OrderedCollection",
    totalItems: items.length,
    orderedItems: items
  });
});
ap3.route("/", inbox_default);
ap3.route("/", outbox_default);
var activitypub_default = ap3;

// src/backend/routes/takos-proxy.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();

// src/backend/lib/takos-client.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var refreshLocks = /* @__PURE__ */ new Map();
async function getTakosClient(env2, prisma, session) {
  if (session.provider !== "takos" || !session.providerAccessToken) {
    return null;
  }
  let accessToken = await decrypt(session.providerAccessToken, env2.ENCRYPTION_KEY);
  const refreshToken = session.providerRefreshToken ? await decrypt(session.providerRefreshToken, env2.ENCRYPTION_KEY) : null;
  if (session.providerTokenExpiresAt) {
    const expiresAt = new Date(session.providerTokenExpiresAt);
    const now = /* @__PURE__ */ new Date();
    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1e3) {
      if (refreshToken) {
        const lockKey = session.id;
        let refreshPromise = refreshLocks.get(lockKey);
        if (!refreshPromise) {
          refreshPromise = refreshTakosToken(env2, refreshToken);
          refreshLocks.set(lockKey, refreshPromise);
          try {
            const newTokens = await refreshPromise;
            if (newTokens) {
              await updateSessionTokens(prisma, session.id, newTokens, env2.ENCRYPTION_KEY);
              accessToken = newTokens.access_token;
            } else {
              return null;
            }
          } finally {
            refreshLocks.delete(lockKey);
          }
        } else {
          const newTokens = await refreshPromise;
          if (newTokens) {
            accessToken = newTokens.access_token;
          } else {
            return null;
          }
        }
      } else {
        return null;
      }
    }
  }
  const baseUrl = env2.TAKOS_URL;
  if (!baseUrl)
    return null;
  const takosFetch = /* @__PURE__ */ __name(async (path, options = {}) => {
    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${accessToken}`
      }
    });
  }, "takosFetch");
  return {
    fetch: takosFetch,
    async getWorkspaces() {
      const res = await takosFetch("/workspaces");
      if (!res.ok)
        throw new Error(`Failed to get workspaces: ${res.status}`);
      return res.json();
    },
    async getRepos() {
      const res = await takosFetch("/repos");
      if (!res.ok)
        throw new Error(`Failed to get repos: ${res.status}`);
      return res.json();
    },
    async getUser() {
      const res = await takosFetch("/me");
      if (!res.ok)
        throw new Error(`Failed to get user: ${res.status}`);
      return res.json();
    }
  };
}
__name(getTakosClient, "getTakosClient");
async function refreshTakosToken(env2, refreshToken) {
  if (!env2.TAKOS_URL || !env2.TAKOS_CLIENT_ID || !env2.TAKOS_CLIENT_SECRET) {
    return null;
  }
  try {
    const res = await fetch(`${env2.TAKOS_URL}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: env2.TAKOS_CLIENT_ID,
        client_secret: env2.TAKOS_CLIENT_SECRET
      })
    });
    if (!res.ok) {
      console.error("Failed to refresh takos token:", await res.text());
      return null;
    }
    return res.json();
  } catch (err) {
    console.error("Error refreshing takos token:", err);
    return null;
  }
}
__name(refreshTakosToken, "refreshTakosToken");
async function updateSessionTokens(prisma, sessionId, tokens, encryptionKey) {
  const tokenExpiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1e3).toISOString() : void 0;
  const encryptedAccessToken = await encrypt(tokens.access_token, encryptionKey);
  const encryptedRefreshToken = tokens.refresh_token ? await encrypt(tokens.refresh_token, encryptionKey) : void 0;
  await prisma.session.update({
    where: { id: sessionId },
    data: {
      providerAccessToken: encryptedAccessToken,
      ...encryptedRefreshToken && { providerRefreshToken: encryptedRefreshToken },
      ...tokenExpiresAt && { providerTokenExpiresAt: tokenExpiresAt }
    }
  });
}
__name(updateSessionTokens, "updateSessionTokens");

// src/backend/routes/takos-proxy.ts
var takosProxy = new Hono2();
takosProxy.use("*", async (c, next) => {
  const actor = c.get("actor");
  if (!actor) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const sessionId = getCookie(c, "session");
  if (!sessionId) {
    return c.json({ error: "No session" }, 401);
  }
  const prisma = c.get("prisma");
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      provider: true,
      providerAccessToken: true,
      providerRefreshToken: true,
      providerTokenExpiresAt: true
    }
  });
  if (!session) {
    return c.json({ error: "Session not found" }, 401);
  }
  if (session.provider !== "takos") {
    return c.json({ error: "Not logged in with Takos" }, 400);
  }
  const client = await getTakosClient(c.env, prisma, session);
  if (!client) {
    return c.json({ error: "Failed to create Takos client" }, 500);
  }
  c.set("takosClient", client);
  await next();
});
takosProxy.get("/workspaces", async (c) => {
  const client = c.get("takosClient");
  if (!client) {
    return c.json({ error: "Takos client not available" }, 500);
  }
  try {
    const data = await client.getWorkspaces();
    return c.json(data);
  } catch (err) {
    console.error("Failed to get workspaces:", err);
    return c.json({ error: "Failed to get workspaces" }, 500);
  }
});
takosProxy.get("/repos", async (c) => {
  const client = c.get("takosClient");
  if (!client) {
    return c.json({ error: "Takos client not available" }, 500);
  }
  try {
    const data = await client.getRepos();
    return c.json(data);
  } catch (err) {
    console.error("Failed to get repos:", err);
    return c.json({ error: "Failed to get repos" }, 500);
  }
});
takosProxy.get("/user", async (c) => {
  const client = c.get("takosClient");
  if (!client) {
    return c.json({ error: "Takos client not available" }, 500);
  }
  try {
    const data = await client.getUser();
    return c.json(data);
  } catch (err) {
    console.error("Failed to get user:", err);
    return c.json({ error: "Failed to get user" }, 500);
  }
});
var takos_proxy_default = takosProxy;

// src/backend/middleware/rate-limit.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
var rateLimitStore = /* @__PURE__ */ new Map();
var CLEANUP_INTERVAL2 = 6e4;
var lastCleanup2 = Date.now();
function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup2 < CLEANUP_INTERVAL2)
    return;
  lastCleanup2 = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}
__name(cleanupExpired, "cleanupExpired");
var RateLimitConfigs = {
  // General API: 10,000 requests per minute
  general: { windowMs: 6e4, maxRequests: 1e4 },
  // Auth endpoints: 1,000 requests per minute (prevent brute force)
  auth: { windowMs: 6e4, maxRequests: 1e3, keyPrefix: "auth:" },
  // Post creation: 3,000 per minute
  postCreate: { windowMs: 6e4, maxRequests: 3e3, keyPrefix: "post:" },
  // Search: 3,000 per minute
  search: { windowMs: 6e4, maxRequests: 3e3, keyPrefix: "search:" },
  // Media upload: 2,000 per minute
  mediaUpload: { windowMs: 6e4, maxRequests: 2e3, keyPrefix: "media:" },
  // DM: 6,000 per minute
  dm: { windowMs: 6e4, maxRequests: 6e3, keyPrefix: "dm:" },
  // Federation inbox: 20,000 per minute (need to accept activities from other servers)
  inbox: { windowMs: 6e4, maxRequests: 2e4, keyPrefix: "inbox:" }
};
function getClientIP(c) {
  const cfIp = c.req.header("CF-Connecting-IP");
  if (cfIp && isValidIP(cfIp)) {
    return cfIp;
  }
  const xff = c.req.header("X-Forwarded-For");
  if (xff) {
    const firstIp = xff.split(",")[0]?.trim();
    if (firstIp && isValidIP(firstIp)) {
      return firstIp;
    }
  }
  const realIp = c.req.header("X-Real-IP");
  if (realIp && isValidIP(realIp)) {
    return realIp;
  }
  return "unknown";
}
__name(getClientIP, "getClientIP");
function isValidIP(ip) {
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ipv6Pattern = /^[0-9a-fA-F:]+$/;
  if (ipv4Pattern.test(ip)) {
    const parts = ip.split(".").map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }
  return ipv6Pattern.test(ip) && ip.includes(":");
}
__name(isValidIP, "isValidIP");
function rateLimit(config2) {
  return async (c, next) => {
    cleanupExpired();
    const actor = c.get("actor");
    const ip = getClientIP(c);
    const clientId = actor?.ap_id || ip;
    const key = `${config2.keyPrefix || ""}${clientId}`;
    const now = Date.now();
    let entry = rateLimitStore.get(key);
    if (!entry || entry.resetAt < now) {
      entry = {
        count: 1,
        resetAt: now + config2.windowMs
      };
      rateLimitStore.set(key, entry);
    } else {
      entry.count++;
    }
    const remaining = Math.max(0, config2.maxRequests - entry.count);
    const resetAt = Math.ceil(entry.resetAt / 1e3);
    c.header("X-RateLimit-Limit", config2.maxRequests.toString());
    c.header("X-RateLimit-Remaining", remaining.toString());
    c.header("X-RateLimit-Reset", resetAt.toString());
    if (entry.count > config2.maxRequests) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1e3);
      c.header("Retry-After", retryAfter.toString());
      return c.json({
        error: "Too many requests",
        retry_after: retryAfter
      }, 429);
    }
    await next();
  };
}
__name(rateLimit, "rateLimit");

// src/backend/middleware/csrf.ts
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_process();
init_virtual_unenv_global_polyfill_cloudflare_unenv_preset_node_console();
init_performance2();
function getOrigin(url) {
  if (!url)
    return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}
__name(getOrigin, "getOrigin");
function csrfProtection() {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (!["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
      return next();
    }
    const path = c.req.path;
    if (path.includes("/inbox") && path.includes("/ap/")) {
      return next();
    }
    const appUrl = c.env.APP_URL;
    const expectedOrigin = getOrigin(appUrl);
    const originHeader = c.req.header("Origin");
    const refererHeader = c.req.header("Referer");
    const requestOrigin = originHeader || getOrigin(refererHeader ?? null);
    if (!requestOrigin) {
      const xRequestedWith = c.req.header("X-Requested-With");
      if (xRequestedWith) {
        return next();
      }
      const contentType = c.req.header("Content-Type");
      if (contentType && contentType.includes("application/json")) {
        return next();
      }
      console.warn("CSRF check failed: missing Origin header and no CSRF-safe indicators");
      return c.json({ error: "CSRF validation failed: missing Origin header" }, 403);
    }
    if (requestOrigin !== expectedOrigin) {
      const isDev = appUrl?.includes("localhost") || appUrl?.includes("127.0.0.1");
      if (isDev && requestOrigin?.includes("localhost")) {
        return next();
      }
      console.warn(`CSRF check failed: expected ${expectedOrigin}, got ${requestOrigin}`);
      return c.json({ error: "CSRF validation failed" }, 403);
    }
    return next();
  };
}
__name(csrfProtection, "csrfProtection");

// src/backend/index.ts
var app = new Hono2();
app.onError(createErrorMiddleware());
app.use("*", async (c, next) => {
  await next();
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Cross-Origin-Embedder-Policy", "credentialless");
  const takosUrl = c.env.TAKOS_URL || "https://takos.jp";
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' https://unpkg.com wss: ${takosUrl}`,
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    `form-action 'self' ${takosUrl}`,
    "base-uri 'self'"
  ].join("; ");
  c.header("Content-Security-Policy", csp);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
});
app.use("*", async (c, next) => {
  const prisma = c.env.PRISMA ?? getPrismaD1(c.env.DB);
  c.set("prisma", prisma);
  await next();
});
app.use("/api/*", async (c, next) => {
  const sessionId = getCookie(c, "session");
  if (sessionId) {
    const prisma = c.get("prisma");
    const session = await prisma.session.findFirst({
      where: {
        id: sessionId,
        expiresAt: { gt: (/* @__PURE__ */ new Date()).toISOString() }
      },
      include: { member: true }
    });
    if (session) {
      const actor = {
        ap_id: session.member.apId,
        type: session.member.type,
        preferred_username: session.member.preferredUsername,
        name: session.member.name,
        summary: session.member.summary,
        icon_url: session.member.iconUrl,
        header_url: session.member.headerUrl,
        inbox: session.member.inbox,
        outbox: session.member.outbox,
        followers_url: session.member.followersUrl,
        following_url: session.member.followingUrl,
        public_key_pem: session.member.publicKeyPem,
        private_key_pem: session.member.privateKeyPem,
        takos_user_id: session.member.takosUserId,
        follower_count: session.member.followerCount,
        following_count: session.member.followingCount,
        post_count: session.member.postCount,
        is_private: session.member.isPrivate,
        role: session.member.role,
        created_at: session.member.createdAt
      };
      c.set("actor", actor);
    }
  }
  await next();
});
app.use("/api/*", csrfProtection());
app.use("/api/*", rateLimit(RateLimitConfigs.general));
app.use("/api/auth/*", rateLimit(RateLimitConfigs.auth));
app.use("/api/search/*", rateLimit(RateLimitConfigs.search));
app.use("/api/media/*", rateLimit(RateLimitConfigs.mediaUpload));
app.use("/api/dm/*", rateLimit(RateLimitConfigs.dm));
app.post("/api/posts", rateLimit(RateLimitConfigs.postCreate));
app.use("/ap/*/inbox", rateLimit(RateLimitConfigs.inbox));
app.route("/api/auth", auth_default);
app.route("/api/actors", actors_default);
app.route("/api/follow", follow_default);
app.route("/api/timeline", timeline_default);
app.route("/api/posts", posts_default);
app.get("/api/bookmarks", async (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/api/posts/bookmarks";
  const newReq = new Request(url.toString(), c.req.raw);
  return app.fetch(newReq, c.env, c.executionCtx);
});
app.route("/api/notifications", notifications_default);
app.route("/api/stories", stories_default);
app.route("/api/search", search_default);
app.route("/api/communities", communities_default);
app.route("/api/dm", dm_default);
app.route("/api/media", media_default);
app.route("/media", media_default);
app.route("/api/takos", takos_proxy_default);
app.route("/", activitypub_default);
app.all("*", async (c) => {
  if (!c.env.ASSETS) {
    return c.json({
      error: "Static assets not configured",
      message: "This instance is running in API-only mode. Frontend assets are not available.",
      hint: "Access /api/* endpoints for API functionality."
    }, 503);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});
var backend_default = app;
export {
  backend_default as default
};
/*! Bundled license information:

@prisma/client-runtime-utils/dist/index.js:
  (*! Bundled license information:
  
  decimal.js/decimal.mjs:
    (*!
     *  decimal.js v10.5.0
     *  An arbitrary-precision Decimal type for JavaScript.
     *  https://github.com/MikeMcl/decimal.js
     *  Copyright (c) 2025 Michael Mclaughlin <M8ch88l@gmail.com>
     *  MIT Licence
     *)
  *)

ky/distribution/index.js:
  (*! MIT License © Sindre Sorhus *)
*/
//# sourceMappingURL=index.js.map
