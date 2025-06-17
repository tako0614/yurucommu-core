// Permission types based on the specification
export type Permission =
  | "fetch:net"
  | "activitypub:send"
  | "activitypub:read"
  | "activitypub:receive:hook"
  | "activitypub:actor:read"
  | "activitypub:actor:write"
  | "plugin-actor:create"
  | "plugin-actor:read"
  | "plugin-actor:write"
  | "plugin-actor:delete"
  | "kv:read"
  | "kv:write"
  | "cdn:read"
  | "cdn:write"
  | "events:publish"
  | "deno:read"
  | "deno:write"
  | "deno:net"
  | "deno:env"
  | "deno:run"
  | "deno:sys"
  | "deno:ffi"
  | "extensions:invoke"
  | "extensions:export";

/**
 * AST解析結果
 */
export interface ModuleAnalysis {
  filePath: string;
  exports: ExportInfo[];
  imports: ImportInfo[];
  decorators: DecoratorInfo[];
  jsDocTags: JSDocTagInfo[];
}

export interface ExportInfo {
  name: string;
  type: "function" | "const" | "class" | "type";
  isDefault: boolean;
  line: number;
  column: number;
  /**
   * If this export is a const initialized with `new SomeClass()`
   * this holds the class name.
   */
  instanceOf?: string;
}

export interface ImportInfo {
  source: string;
  imports: { name: string; alias?: string }[];
  isTypeOnly: boolean;
  line: number;
}

export interface DecoratorInfo {
  name: string;
  args: unknown[];
  targetFunction: string;
  /** メソッドが属するクラス名 (あれば) */
  targetClass?: string;
  line: number;
}

export interface JSDocTagInfo {
  tag: string;
  value: string;
  targetFunction: string;
  /** メソッドが属するクラス名 (あれば) */
  targetClass?: string;
  line: number;
}

/**
 * Virtual Entrypoint 生成用型
 */
export interface VirtualEntry {
  type: "server" | "client";
  exports: string[];
  imports: string[];
  content: string;
}

/**
 * ビルド結果
 */
export interface BuildResult {
  success: boolean;
  manifest: ExtensionManifest;
  files: {
    server?: string;
    client?: string;
    ui?: string[];
  };
  metrics: BuildMetrics;
  errors: string[];
  warnings: string[];
}

export interface BuildMetrics {
  buildStartTime: number;
  buildEndTime: number;
  totalDuration: number;
  bundlingDuration: number;
  validationDuration: number;
  compressionDuration: number;
  outputSize: {
    server: number;
    client: number;
    ui: number;
    total: number;
  };
  functionCounts: {
    server: number;
    client: number;
    events: number;
  };
  warnings: string[];
  errors: string[];
}

/**
 * Takopack manifest
 */
export interface ExtensionManifest {
  name: string;
  description?: string;
  version: string;
  identifier: string;
  /** アイコンファイルへのパス */
  icon?: string;
  apiVersion?: string;
  permissions?: Permission[];
  /** 依存拡張の宣言 */
  extensionDependencies?: Array<{
    identifier: string;
    version: string;
  }>;
  /** 他拡張へ公開するAPI */
  exports?: {
    server?: string[];
    background?: string[];
    ui?: string[];
  };
  server: {
    entry: string;
  };
  client: {
    entryUI: string;
    entryBackground: string;
  };
  eventDefinitions?: Record<string, EventDefinition>;
  activityPub?: {
    objects: ActivityPubConfig[];
  };
}

export interface EventDefinition {
  source: "client" | "server" | "background" | "ui";
  handler: string;
}

export interface ActivityPubConfig {
  accepts: string[];
  context: string;
  hooks: {
    canAccept?: string;
    onReceive: string;
    priority?: number;
    serial?: boolean;
  };
}

/**
 * CLI コマンド引数
 */
export interface CommandArgs {
  command: "build" | "watch" | "dev" | "init" | "types";
  config?: string;
  outDir?: string;
  dev?: boolean;
  verbose?: boolean;
  context?: "server" | "client" | "ui" | "all";
  includeCustomTypes?: boolean;
}

/**
 * CLI インターフェース
 */
export interface CLIInterface {
  run(args?: string[]): Promise<void>;
  executeCommand(args: CommandArgs): Promise<void>;
  handleBuild(args: CommandArgs): Promise<void>;
  handleWatch(args: CommandArgs): Promise<void>;
  handleDev(args: CommandArgs): Promise<void>;
  handleInit(args: CommandArgs): Promise<void>;
  handleTypes(args: CommandArgs): Promise<void>;
  loadConfig(configPath?: string): Promise<TakopackConfig>;
  showHelp(): void;
  showVersion(): void;
}

/**
 * Takopack 設定定義（config.tsから移動）
 */
export interface TakopackConfig {
  /** マニフェスト設定 */
  manifest: {
    name: string;
    identifier: string;
    version: string;
    description?: string;
    icon?: string;
    permissions?: Permission[];
    extensionDependencies?: Array<{ identifier: string; version: string }>;
    exports?: {
      server?: string[];
      background?: string[];
      ui?: string[];
    };
  };

  /** エントリポイント設定 */
  entries: {
    server?: string[];
    client?: string[];
    ui?: string[];
  };

  /** ビルド設定 */
  build?: {
    target?: string;
    dev?: boolean;
    analysis?: boolean;
    outDir?: string;
    minify?: boolean;
  };

  /** プラグイン設定 */
  plugins?: TakopackPlugin[];
}

/**
 * プラグインインターフェース
 */
export interface TakopackPlugin {
  name: string;
  setup(build: PluginContext): void | Promise<void>;
}

export interface PluginContext {
  onTransform?: (
    callback: (
      args: TransformArgs,
    ) => TransformResult | Promise<TransformResult>,
  ) => void;
  onGenerate?: (callback: (args: GenerateArgs) => void | Promise<void>) => void;
}

export interface TransformArgs {
  filePath: string;
  code: string;
  isEntry: boolean;
}

export interface TransformResult {
  code?: string;
  map?: string;
}

export interface GenerateArgs {
  manifest: ExtensionManifest;
  files: Map<string, string>;
}

/**
 * Takos API Type Definitions
 * globalThis.takos で利用可能な型安全なAPI
 */

// Common types
export type SerializableValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | SerializableObject
  | SerializableArray;
export interface SerializableObject {
  [key: string]: SerializableValue;
}
export interface SerializableArray extends Array<SerializableValue> {}

// ActivityPub 関連型
export interface ActivityPubActivity extends SerializableObject {
  id?: string;
  type: string;
  actor?: string;
  object?: SerializableValue;
  target?: string;
  published?: string;
}

export interface ActivityPubActor extends SerializableObject {
  id: string;
  type: string;
  preferredUsername?: string;
  name?: string;
  summary?: string;
  icon?: { type: string; url: string };
}

// Event 関連型
export interface TakosEvent<T = SerializableValue> {
  name: string;
  payload: T;
  timestamp: number;
  source: "server" | "client" | "ui" | "background";
}

export type EventHandler<T = SerializableValue> = (
  payload: T,
) => void | Promise<void>;

// Assets 関連型
export interface AssetWriteOptions {
  cacheTTL?: number;
}

// Takos API Interfaces
export interface TakosKVAPI {
  read(key: string): Promise<SerializableValue>;
  write(key: string, value: SerializableValue): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface TakosActivityPubActorAPI {
  read(userId: string): Promise<ActivityPubActor>;
  update(userId: string, key: string, value: string): Promise<void>;
  delete(userId: string, key: string): Promise<void>;
}

export interface TakosActivityPubPluginActorAPI {
  create(localName: string, profile: SerializableObject): Promise<string>;
  read(iri: string): Promise<ActivityPubActor>;
  update(iri: string, partial: Partial<ActivityPubActor>): Promise<void>;
  delete(iri: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface TakosActivityPubAPI {
  send(userId: string, activity: ActivityPubActivity): Promise<void>;
  read(id: string): Promise<ActivityPubActivity>;
  delete(id: string): Promise<void>;
  list(userId?: string): Promise<string[]>;
  follow(followerId: string, followeeId: string): Promise<void>;
  unfollow(followerId: string, followeeId: string): Promise<void>;
  listFollowers(actorId: string): Promise<string[]>;
  listFollowing(actorId: string): Promise<string[]>;
  actor: TakosActivityPubActorAPI;
  pluginActor: TakosActivityPubPluginActorAPI;
}

export interface Extension {
  identifier: string;
  version: string;
  isActive: boolean;
  activate(): Promise<{
    publish(name: string, payload?: SerializableValue): Promise<SerializableValue>;
  }>;
}

export interface TakosExtensionsAPI {
  get(identifier: string): Extension | undefined;
  readonly all: Extension[];
}

export interface TakosCdnAPI {
  read(path: string): Promise<string>;
  write(
    path: string,
    data: string | Uint8Array,
    options?: AssetWriteOptions,
  ): Promise<string>;
  delete(path: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

// Context-aware Events API
export interface TakosEventsAPI {
  publish(
    eventName: string,
    payload: SerializableValue,
    options?: { push?: boolean },
  ): Promise<[200 | 400 | 500, SerializableObject] | void>;
}

// Main Takos API Interface
export interface TakosAPI {
  kv: TakosKVAPI;
  fetch(url: string, options?: RequestInit): Promise<Response>;
}

export interface TakosServerAPI extends TakosAPI {
  activitypub: TakosActivityPubAPI;
  ap: TakosActivityPubAPI;
  cdn: TakosCdnAPI;
  events: TakosEventsAPI;
  extensions: TakosExtensionsAPI;
  activateExtension(
    identifier: string,
    ): Promise<
      { publish(name: string, payload?: SerializableValue): Promise<SerializableValue> } | undefined
    >;
}

export interface TakosClientAPI extends TakosAPI {
  events: TakosEventsAPI;
  extensions: TakosExtensionsAPI;
  activateExtension(
    identifier: string,
  ): Promise<
    { publish(name: string, payload?: SerializableValue): Promise<SerializableValue> } | undefined
  >;
}

export interface TakosUIAPI {
  events: TakosEventsAPI;
  extensions: TakosExtensionsAPI;
  activateExtension(
    identifier: string,
  ): Promise<
    { publish(name: string, payload?: SerializableValue): Promise<SerializableValue> } | undefined
  >;
  // UI環境では一部のAPIは制限される
}

/**
 * GlobalThis 型拡張インターフェース
 * 各実行コンテキストに応じた適切なTakos APIを提供
 */
// Server Context用の型 (server.js)
export interface GlobalThisWithServerTakos {
  takos: TakosServerAPI | undefined;
}

// Client Context用の型 (client.js - background)
export interface GlobalThisWithClientTakos {
  takos: TakosClientAPI | undefined;
}

// UI Context用の型 (index.html)
export interface GlobalThisWithUITakos {
  takos: TakosUIAPI | undefined;
}

/**
 * TypeScript型定義生成機能
 */
export interface TypeGenerationOptions {
  /** 生成する型定義のスコープ */
  context: "server" | "client" | "ui";
  /** 出力ファイルパス */
  outputPath: string;
  /** カスタム型定義を含めるか */
  includeCustomTypes?: boolean;
}

/**
 * 型定義生成結果
 */
export interface TypeGenerationResult {
  /** 生成されたファイルパス */
  filePath: string;
  /** 生成された型定義の内容 */
  content: string;
  /** 含まれる型の数 */
  typeCount: number;
}
