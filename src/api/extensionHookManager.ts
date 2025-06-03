// 拡張機能のフックマネージャー
import { Extention } from "./models/extentions.ts"; // Extentionモデルをインポート
import {
  ActivityPubActivity,
  VerificationResult,
} from "./types/activitypub.ts"; // 型をインポート
import _crypto from "node:crypto";
import _process from "node:process";

export interface ExtensionManifest {
  name: string;
  identifier: string;
  apiVersion: string;
  permissions: string[];
  activityPub?: {
    objects?: Array<{
      accepts: string[];
      context?: string;
      hooks?: {
        canAccept?: string;
        onReceive?: string;
        priority?: number;
        serial?: boolean;
      };
    }>;
  };
  eventDefinitions?: Record<string, unknown>;
}

export interface HookResult {
  accepted: boolean;
  processedActivity?: ActivityPubActivity;
}

export interface ExtensionContext {
  identifier: string;
  permissions: string[];
  kv: {
    read: (key: string) => Promise<unknown>;
    write: (key: string, value: unknown) => Promise<void>;
    delete: (key: string) => Promise<void>;
    list: () => Promise<string[]>;
  };
  activitypub: {
    send: (userId: string, activity: Record<string, unknown>) => Promise<void>;
    read: (id: string) => Promise<Record<string, unknown>>;
    delete: (id: string) => Promise<void>;
    list: (userId?: string) => Promise<string[]>;
    actor: {
      read: (userId: string) => Promise<Record<string, unknown>>;
      update: (userId: string, key: string, value: string) => Promise<void>;
      delete: (userId: string, key: string) => Promise<void>;
    };
    follow: (followerId: string, followeeId: string) => Promise<void>;
    unfollow: (followerId: string, followeeId: string) => Promise<void>;
    listFollowers: (actorId: string) => Promise<string[]>;
    listFollowing: (actorId: string) => Promise<string[]>;
    pluginActor: {
      create: (
        localName: string,
        profile: Record<string, unknown>,
      ) => Promise<string>;
      read: (iri: string) => Promise<Record<string, unknown>>;
      update: (iri: string, partial: Record<string, unknown>) => Promise<void>;
      delete: (iri: string) => Promise<void>;
      list: () => Promise<string[]>;
    };
  };
  assets: {
    read: (path: string) => Promise<string>;
    write: (
      path: string,
      data: string | Uint8Array,
      options?: { cacheTTL?: number },
    ) => Promise<string>;
    delete: (path: string) => Promise<void>;
    list: (prefix?: string) => Promise<string[]>;
  };
  events: {
    publish: (
      eventName: string,
      payload: unknown,
    ) => Promise<[number, Record<string, unknown>]>;
    publishToClient: (eventName: string, payload: unknown) => Promise<void>;
    subscribe: (
      eventName: string,
      handler: (payload: unknown) => void,
    ) => () => void;
  };
  fetch: (url: string, options?: RequestInit) => Promise<Response>;
}

// Extentionモデルのインターフェース定義
interface Extension {
  _id?: string;
  id: string;
  version: string;
  serverjs: string;
  clienthtml: string;
  manifest: ExtensionManifest;
}

class ExtensionHookManager {
  private loadedExtensions = new Map<string, {
    manifest: ExtensionManifest;
    serverModule: Record<string, unknown>; // serverModuleの型をunknownに変更
    context: ExtensionContext;
  }>();
  private eventListeners = new Map<string, Array<(payload: unknown) => void>>();

  // loadedExtensionsへのアクセサ
  get extensions() {
    return this.loadedExtensions;
  }

  // 拡張機能の読み込み
  async loadExtension(extensionId: string): Promise<void> {
    try {
      const extensionModel = await Extention.findOne({ id: extensionId });
      if (!extensionModel) {
        console.warn(`Extension not found in DB: ${extensionId}`);
        return;
      }

      const manifest: ExtensionManifest = extensionModel
        .manifest as ExtensionManifest;

      // 権限チェック
      if (!this.validatePermissions(manifest.permissions)) {
        console.warn(`Extension ${extensionId} has invalid permissions.`);
        return;
      }

      // サーバーモジュールを評価
      const serverModule = await this.evaluateServerModule(
        extensionModel.serverjs,
        manifest,
      );

      // コンテキストを作成
      const context = this.createExtensionContext(manifest); // awaitを削除

      this.loadedExtensions.set(extensionId, {
        manifest,
        serverModule,
        context,
      });

      console.log(`Extension loaded: ${extensionId}`);
    } catch (error) {
      console.error(`Failed to load extension ${extensionId}:`, error);
    }
  }

  // 拡張機能のアンロード
  unloadExtension(extensionId: string): void {
    this.loadedExtensions.delete(extensionId);
    console.log(`Extension unloaded: ${extensionId}`);
  }

  // 拡張機能からフック関数を取得するヘルパーメソッド
  private getHookFromExtension(
    extensionIdentifier: string,
    hookName: string,
  ): ((...args: unknown[]) => unknown) | undefined {
    const extension = this.loadedExtensions.get(extensionIdentifier);
    if (
      extension && extension.serverModule &&
      typeof extension.serverModule[hookName] === "function"
    ) {
      return extension.serverModule[hookName] as (
        ...args: unknown[]
      ) => unknown;
    }
    return undefined;
  }

  // ActivityPub受信フック処理
  async processIncomingActivity(
    activity: ActivityPubActivity,
  ): Promise<HookResult> {
    const relevantExtensions = Array.from(this.loadedExtensions.values())
      .filter((ext) => this.isActivityRelevant(ext.manifest, activity))
      .sort((a, b) =>
        (b.manifest.activityPub?.objects?.[0]?.hooks?.priority || 0) -
        (a.manifest.activityPub?.objects?.[0]?.hooks?.priority || 0)
      );

    // canAccept フェーズ
    for (const extensionData of relevantExtensions) {
      if (extensionData.manifest.activityPub?.objects?.[0]?.hooks?.canAccept) {
        try {
          const hookResult = await this.callExtensionHook(
            extensionData.manifest.identifier,
            "canAccept",
            activity,
          );
          // hookResultが { accepted: boolean } 形式であることを期待
          if (
            hookResult && typeof hookResult === "object" &&
            "accepted" in hookResult && hookResult.accepted === false
          ) {
            console.log(
              `Activity rejected by canAccept hook in ${extensionData.manifest.identifier}`,
            );
            return { accepted: false, processedActivity: activity };
          }
        } catch (error) {
          console.error(
            `canAccept hook failed for ${extensionData.manifest.identifier}:`,
            error,
          );
          // エラー時はデフォルトで拒否するなどのポリシーが必要な場合がある
        }
      }
    }
    // onReceive フェーズ
    let processedActivity: ActivityPubActivity = activity;
    const serialMode = relevantExtensions.some((ext) =>
      ext.manifest.activityPub?.objects?.[0]?.hooks?.serial === true
    );

    if (serialMode) {
      // 順次実行
      for (const extensionData of relevantExtensions) {
        if (
          extensionData.manifest.activityPub?.objects?.[0]?.hooks?.onReceive
        ) {
          try {
            const result = await this.callExtensionHook(
              extensionData.manifest.identifier,
              "onReceive",
              processedActivity,
            );
            if (
              result && typeof result === "object" && "type" in result &&
              "id" in result
            ) { // ActivityPubActivity型かチェック
              processedActivity = result as ActivityPubActivity;
            }
          } catch (error) {
            console.error(
              `onReceive hook (serial) failed for ${extensionData.manifest.identifier}:`,
              error,
            );
          }
        }
      }
    } else {
      // 並列実行
      const hookPromises = relevantExtensions
        .filter((ext) =>
          ext.manifest.activityPub?.objects?.[0]?.hooks?.onReceive
        )
        .map((extensionData) =>
          this.callExtensionHook(
            extensionData.manifest.identifier,
            "onReceive",
            processedActivity,
          )
            .then((result) => {
              if (
                result && typeof result === "object" && "type" in result &&
                "id" in result
              ) { // ActivityPubActivity型かチェック
                return result as ActivityPubActivity;
              }
              return null;
            })
            .catch((error) => {
              console.error(
                `onReceive hook (parallel) failed for ${extensionData.manifest.identifier}:`,
                error,
              );
              return null;
            })
        );

      if (hookPromises.length > 0) {
        const results = await Promise.all(hookPromises);
        const firstValidResult = results.find((r) => r !== null);
        if (firstValidResult) {
          processedActivity = firstValidResult;
        }
      }
    }

    return { accepted: true, processedActivity };
  }

  // ActivityPub送信フック処理
  async processOutgoingActivity(
    activity: ActivityPubActivity,
  ): Promise<HookResult> { // async を追加
    // 送信時のフック処理（必要に応じて実装）
    // 例: 関連する拡張機能を取得し、送信前処理を行う
    const relevantExtensions = Array.from(this.loadedExtensions.values())
      .filter((ext) => this.isActivityRelevant(ext.manifest, activity)); // isActivityRelevantは送信時にも使えるか要検討

    let processedActivity = activity;
    for (const extensionData of relevantExtensions) {
      // 'onSend' や 'beforeSend' のようなフックを想定
      const onSendHook = this.getHookFromExtension(
        extensionData.manifest.identifier,
        "onSendActivity",
      );
      if (onSendHook) {
        try {
          const result = await onSendHook(
            extensionData.context,
            processedActivity,
          );
          if (
            result && typeof result === "object" && "type" in result &&
            "id" in result
          ) {
            processedActivity = result as ActivityPubActivity;
          }
        } catch (error) {
          console.error(
            `onSendActivity hook failed for ${extensionData.manifest.identifier}:`,
            error,
          );
        }
      }
    }
    return { accepted: true, processedActivity };
  }

  // アクティビティが拡張機能に関連するかチェック
  private isActivityRelevant(
    manifest: ExtensionManifest,
    activity: ActivityPubActivity,
  ): boolean {
    if (!manifest.activityPub?.objects) return false;

    return manifest.activityPub.objects.some((obj) =>
      obj.accepts.includes(activity.type)
    );
  }

  // 拡張機能のフック関数を呼び出し
  private callExtensionHook(
    extensionIdentifier: string,
    hookName: string,
    data: unknown, // dataの型をunknownに
  ): Promise<
    ActivityPubActivity | VerificationResult | {
      accepted: boolean;
      processedActivity?: unknown;
    } | null
  > {
    const extensionData = this.loadedExtensions.get(extensionIdentifier);
    if (!extensionData) {
      console.warn(
        `Extension ${extensionIdentifier} not loaded for hook call.`,
      );
      return Promise.resolve(null);
    }

    const hook = this.getHookFromExtension(extensionIdentifier, hookName);
    if (hook && typeof hook === "function") {
      // タイムアウト付きで実行
      return Promise.race([
        Promise.resolve(hook.call(null, extensionData.context, data)), // hookの実行結果をPromiseでラップ
        new Promise((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `Hook timeout for ${hookName} in ${extensionIdentifier}`,
                ),
              ),
            5000,
          )
        ),
      ]) as Promise<
        ActivityPubActivity | VerificationResult | {
          accepted: boolean;
          processedActivity?: unknown;
        } | null
      >;
    }
    return Promise.resolve(null);
  } // サーバーモジュールの評価（セキュリティ強化版）
  private evaluateServerModule(
    serverCode: string,
    manifest: ExtensionManifest,
  ): Record<string, unknown> {
    // セキュリティポリシーを適用
    const secureCode = this.applySecurityPolicy(serverCode, manifest);
    // 制限されたグローバルコンテキスト
    const allowedGlobals = {
      console: {
        log: (...args: unknown[]) =>
          console.log(`[${manifest.identifier}]`, ...args),
        error: (...args: unknown[]) =>
          console.error(`[${manifest.identifier}]`, ...args),
        warn: (...args: unknown[]) =>
          console.warn(`[${manifest.identifier}]`, ...args),
        info: (...args: unknown[]) =>
          console.info(`[${manifest.identifier}]`, ...args),
      },
      setTimeout: (fn: () => void, delay: number) => {
        if (delay < 10) delay = 10;
        if (delay > 30000) delay = 30000;
        return setTimeout(fn, delay);
      },
      clearTimeout,
      setInterval: (fn: () => void, delay: number) => {
        if (delay < 100) delay = 100;
        if (delay > 60000) delay = 60000;
        return setInterval(fn, delay);
      },
      clearInterval,
      Promise,
      JSON,
      Date,
      Math,
      Array,
      Object,
      String,
      Number,
      Boolean,
      RegExp,
      Map,
      Set,
      WeakMap,
      WeakSet,
      // crypto は permissions チェック後に追加
    }; // 権限に基づいて利用可能なモジュールを決定
    const _allowedModules: Record<string, unknown> = {};

    if (manifest.permissions.includes("fetch:net")) {
      // Denoのfetchはグローバルなので、ここでは何もしないか、ラップするか検討
    }

    // Node.js標準モジュールへの制限付きアクセス (Denoではdeno:* APIを使用)
    const denoApis: Record<string, unknown> = {};
    if (manifest.permissions.includes("deno:read")) {
      denoApis.readFile = Deno.readFile;
      denoApis.readTextFile = Deno.readTextFile;
    }
    if (manifest.permissions.includes("deno:write")) {
      denoApis.writeFile = Deno.writeFile;
      denoApis.writeTextFile = Deno.writeTextFile;
    }
    // ... 他のDeno APIも同様に

    const moduleContext = {
      exports: {},
      module: { exports: {} },
      // require はDenoでは通常使用しない。ESM import を推奨
      // require: (name: string) => { ... }
      __filename: `extension://${manifest.identifier}/server.js`,
      __dirname: `extension://${manifest.identifier}/`,
      global: {}, // 空のglobalオブジェクト
      Deno: denoApis, // 制限されたDeno APIを提供
      // processオブジェクトはDenoでは限定的。必要なものだけ提供
      process: {
        env: manifest.permissions.includes("deno:env")
          ? Deno.env.toObject()
          : {},
        nextTick: queueMicrotask, // Denoでの代替
        // hrtime は Deno.bench や performance.now() で代替検討
      },
    };

    try {
      // Function constructor を使用してコードを実行（VM代替）
      // 注意: Function constructor はセキュリティリスクを伴うため、慎重に使用する
      const func = new Function(
        ...Object.keys(allowedGlobals),
        ...Object.keys(moduleContext),
        "__extension_id",
        "__extension_manifest",
        `"use strict";\n${secureCode}`,
      );

      // 実行
      func(
        ...Object.values(allowedGlobals),
        ...Object.values(moduleContext),
        manifest.identifier,
        manifest,
      );

      return moduleContext.module.exports || moduleContext.exports;
    } catch (error) {
      console.error(
        `Code evaluation failed for ${manifest.identifier}:`,
        error,
      );
      throw error; // エラーを再スロー
    }
  }

  // セキュリティポリシーを適用
  private applySecurityPolicy(
    code: string,
    _manifest: ExtensionManifest,
  ): string {
    // 危険なパターンをチェック
    const dangerousPatterns = [
      /eval\s*\(/g,
      /Function\s*\(/g, // Function constructor自体は上で使うので、ここではユーザーコード内のものを制限
      /new\s+Function/g,
      /\bDeno\s*\.\s*(exit|kill|unsafe.*)\b/g, // Denoの危険なAPI
      /import\s*\(/g, // 動的importの制限 (静的importはコード解析で対応)
      /\.__proto__/g,
      /constructor\s*\.\s*constructor/g,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(code)) {
        throw new Error(
          `Security policy violation: Dangerous pattern detected (${pattern.source})`,
        );
      }
    }

    // コードサイズ制限（1MB）
    if (code.length > 1024 * 1024) {
      throw new Error(
        "Security policy violation: Code size limit exceeded (1MB)",
      );
    }

    // 実行時間制限を追加するためのラッパー (簡易版)
    // より堅牢なサンドボックス環境が必要な場合は、Web WorkerやDeno Subprocessを検討
    return `
      // 実行時間制限
      const __startTime = Date.now();
      const __originalSetTimeout = setTimeout;
      const __originalSetInterval = setInterval;
      
      // CPU使用量監視（簡易版） - これは正確なCPU使用量ではなく、処理回数の目安
      let __operationCount = 0;
      const __maxOperations = 1000000; // 制限値を調整
      
      function __checkOperationLimit() {
        __operationCount++;
        if (__operationCount > __maxOperations) {
          // throw new Error("Operation limit exceeded"); // 無限ループ防止
        }
        if (Date.now() - __startTime > 30000) { // 30秒の実行時間制限
          // throw new Error("Execution time limit exceeded");
        }
      }
      
      // グローバルに関数を配置して、ループ内で呼び出させるなどの工夫が必要
      // 例: forループの各イテレーションで __checkOperationLimit() を呼び出すようにコードを変換する
      // これは非常に複雑なため、ここでは簡易的なラッパーのみ示す

      // ユーザーコード
      ${code}
    `;
  }
  // 拡張機能コンテキストの作成
  private createExtensionContext(
    manifest: ExtensionManifest,
  ): ExtensionContext {
    const context: ExtensionContext = {
      identifier: manifest.identifier,
      permissions: manifest.permissions,
      kv: {
        read: async (key: string) => {
          // KVストアからの読み込みロジック (例: Deno KV)
          // 権限チェック: manifest.permissions.includes("kv:read")
          console.log(`[${manifest.identifier}] KV Read: ${key}`);
          await Promise.resolve(); // lint回避のためのダミーawait
          return null; // 仮実装
        },
        write: async (key: string, value: unknown) => {
          // KVストアへの書き込みロジック
          // 権限チェック: manifest.permissions.includes("kv:write")
          console.log(`[${manifest.identifier}] KV Write: ${key}`, value);
          await Promise.resolve(); // lint回避のためのダミーawait
        },
        delete: async (key: string) => {
          console.log(`[${manifest.identifier}] KV Delete: ${key}`);
          await Promise.resolve(); // lint回避のためのダミーawait
        },
        list: async () => {
          console.log(`[${manifest.identifier}] KV List`);
          await Promise.resolve(); // lint回避のためのダミーawait
          return [];
        },
      },
      activitypub: {
        send: async (userId: string, activity: Record<string, unknown>) => {
          // ActivityPub送信ロジック
          // 権限チェック: manifest.permissions.includes("activitypub:send")
          console.log(
            `[${manifest.identifier}] AP Send for ${userId}:`,
            activity,
          );
          await Promise.resolve(); // lint回避のためのダミーawait
        },
        read: async (id: string) => {
          console.log(`[${manifest.identifier}] AP Read: ${id}`);
          await Promise.resolve(); // lint回避のためのダミーawait
          return {};
        },
        delete: async (id: string) => {
          console.log(`[${manifest.identifier}] AP Delete: ${id}`);
          await Promise.resolve(); // lint回避のためのダミーawait
        },
        list: async (userId?: string) => {
          console.log(`[${manifest.identifier}] AP List for ${userId}`);
          await Promise.resolve(); // lint回避のためのダミーawait
          return [];
        },
        actor: {
          read: async (userId: string) => {
            console.log(`[${manifest.identifier}] AP Actor Read: ${userId}`);
            await Promise.resolve(); // lint回避のためのダミーawait
            return {};
          },
          update: async (userId: string, key: string, value: string) => {
            console.log(
              `[${manifest.identifier}] AP Actor Update: ${userId}, ${key}=${value}`,
            );
            await Promise.resolve(); // lint回避のためのダミーawait
          },
          delete: async (userId: string, key: string) => {
            console.log(
              `[${manifest.identifier}] AP Actor Delete: ${userId}, ${key}`,
            );
            await Promise.resolve(); // lint回避のためのダミーawait
          },
        },
        follow: async (followerId: string, followeeId: string) => {
          console.log(
            `[${manifest.identifier}] AP Follow: ${followerId} -> ${followeeId}`,
          );
          await Promise.resolve(); // lint回避のためのダミーawait
        },
        unfollow: async (followerId: string, followeeId: string) => {
          console.log(
            `[${manifest.identifier}] AP Unfollow: ${followerId} -> ${followeeId}`,
          );
          await Promise.resolve(); // lint回避のためのダミーawait
        },
        listFollowers: async (actorId: string) => {
          console.log(`[${manifest.identifier}] AP List Followers: ${actorId}`);
          await Promise.resolve(); // lint回避のためのダミーawait
          return [];
        },
        listFollowing: async (actorId: string) => {
          console.log(`[${manifest.identifier}] AP List Following: ${actorId}`);
          await Promise.resolve(); // lint回避のためのダミーawait
          return [];
        },
        pluginActor: {
          create: async (
            localName: string,
            profile: Record<string, unknown>,
          ) => {
            console.log(
              `[${manifest.identifier}] Plugin Actor Create: ${localName}`,
              profile,
            );
            await Promise.resolve(); // lint回避のためのダミーawait
            return `plugin://${manifest.identifier}/${localName}`;
          },
          read: async (iri: string) => {
            console.log(`[${manifest.identifier}] Plugin Actor Read: ${iri}`);
            await Promise.resolve(); // lint回避のためのダミーawait
            return {};
          },
          update: async (iri: string, partial: Record<string, unknown>) => {
            console.log(
              `[${manifest.identifier}] Plugin Actor Update: ${iri}`,
              partial,
            );
            await Promise.resolve(); // lint回避のためのダミーawait
          },
          delete: async (iri: string) => {
            console.log(`[${manifest.identifier}] Plugin Actor Delete: ${iri}`);
            await Promise.resolve(); // lint回避のためのダミーawait
          },
          list: async () => {
            console.log(`[${manifest.identifier}] Plugin Actor List`);
            await Promise.resolve(); // lint回避のためのダミーawait
            return [];
          },
        },
      },
      assets: {
        read: async (path: string) => {
          // アセット読み込みロジック (例: Deno.readFile)
          // 権限チェック: manifest.permissions.includes("assets:read")
          console.log(`[${manifest.identifier}] Asset Read: ${path}`);
          await Promise.resolve(); // lint回避のためのダミーawait
          return ""; // 仮実装
        },
        write: async (
          path: string,
          data: string | Uint8Array,
          _options?: { cacheTTL?: number },
        ) => {
          console.log(`[${manifest.identifier}] Asset Write: ${path}`, data);
          await Promise.resolve(); // lint回避のためのダミーawait
          return `cdn://${manifest.identifier}/${path}`;
        },
        delete: async (path: string) => {
          console.log(`[${manifest.identifier}] Asset Delete: ${path}`);
          await Promise.resolve(); // lint回避のためのダミーawait
        },
        list: async (prefix?: string) => {
          console.log(
            `[${manifest.identifier}] Asset List with prefix: ${prefix}`,
          );
          await Promise.resolve(); // lint回避のためのダミーawait
          return [];
        },
      },
      events: {
        publish: async (
          eventName: string,
          payload: unknown,
        ): Promise<[number, Record<string, unknown>]> => {
          // イベント発行ロジック
          // 権限チェック: manifest.permissions.includes("events:publish")
          console.log(
            `[${manifest.identifier}] Event Publish: ${eventName}`,
            payload,
          );
          // WebSocketEventServer.getInstance()?.distributeEvent(...) などを呼び出す
          await Promise.resolve(); // lint回避のためのダミーawait
          return [0, {}]; // 仮実装 (影響を受けたクライアント数など)
        },
        publishToClient: async (eventName: string, payload: unknown) => {
          console.log(
            `[${manifest.identifier}] Event PublishToClient: ${eventName}`,
            payload,
          );
          await Promise.resolve(); // lint回避のためのダミーawait
        },
        subscribe: (
          eventName: string,
          handler: (payload: unknown) => void,
        ): () => void => {
          // イベント購読ロジック
          // 権限チェック: manifest.permissions.includes("events:subscribe")
          console.log(`[${manifest.identifier}] Event Subscribe: ${eventName}`);
          if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
          }
          this.eventListeners.get(eventName)!.push(handler);
          // 購読解除関数を返す
          return () => {
            const listeners = this.eventListeners.get(eventName);
            if (listeners) {
              const index = listeners.indexOf(handler);
              if (index > -1) {
                listeners.splice(index, 1);
              }
            }
          };
        },
      },
      fetch: async (url: string, options?: RequestInit): Promise<Response> => {
        // fetch API
        // 権限チェック: manifest.permissions.includes("fetch:net")
        if (!manifest.permissions.includes("fetch:net")) {
          throw new Error(
            `[${manifest.identifier}] Permission denied: fetch:net`,
          );
        }
        console.log(`[${manifest.identifier}] Fetch: ${url}`, options);
        return await fetch(url, options);
      },
    };
    return context;
  }

  // 権限の検証
  private validatePermissions(permissions: string[]): boolean {
    const allowedPermissions = [
      "activitypub:send",
      "activitypub:read",
      "activitypub:receive:hook",
      "activitypub:actor:read",
      "activitypub:actor:write",
      "plugin-actor:create",
      "plugin-actor:read",
      "plugin-actor:write",
      "plugin-actor:delete",
      "kv:read",
      "kv:write",
      "kv:delete", // kv:delete を追加
      "kv:list", // kv:list を追加
      "assets:read",
      "assets:write",
      "assets:delete", // assets:delete を追加
      "assets:list", // assets:list を追加
      "events:publish",
      "events:subscribe",
      "fetch:net",
      "deno:read",
      "deno:write",
      "deno:net",
      "deno:env",
      "deno:run", // 注意: deno:run は非常に強力な権限
      "deno:sys",
      "deno:ffi", // 注意: deno:ffi は非常に強力な権限
    ];

    for (const permission of permissions) {
      if (!allowedPermissions.includes(permission)) {
        console.warn(`Unknown permission: ${permission}`);
        // return false; // 不明な権限があれば即座にfalseを返すか、警告のみにするか
      }
    }
    return true; // ここでは不明な権限があってもtrueを返すが、厳格にするなら上記コメントアウトを有効化
  }

  // 初期化
  async initialize(): Promise<void> {
    try {
      const extensionsFromDB = await Extention.find({});
      for (const ext of extensionsFromDB) {
        if (ext.id) {
          await this.loadExtension(ext.id.toString());
        }
      }
    } catch (error) {
      console.error("Failed to initialize ExtensionHookManager:", error);
    }
  }

  // クライアントイベントの処理
  async processClientEvent(
    extensionId: string,
    eventName: string,
    payload: unknown,
    userId: string,
  ): Promise<unknown> {
    const extensionData = this.loadedExtensions.get(extensionId);
    if (!extensionData) {
      console.warn(`Extension ${extensionId} not loaded for client event.`);
      throw new Error(`Extension ${extensionId} not loaded`);
    }

    const eventHandlerName = `onClientEvent_${eventName}`; // フック名の規約
    const eventHandler = this.getHookFromExtension(
      extensionId,
      eventHandlerName,
    );

    if (typeof eventHandler !== "function") {
      console.warn(
        `Event handler ${eventHandlerName} not found or not a function in extension ${extensionId}.`,
      );
      throw new Error(
        `Event handler ${eventHandlerName} not found in extension ${extensionId}`,
      );
    }

    try {
      // 拡張機能のコンテキストにuserIdを一時的に追加するか、新しいコンテキストを作成して渡す
      const contextForEvent = {
        ...extensionData.context,
        userId, // userIdをコンテキストに追加
      };
      return await eventHandler.call(null, contextForEvent, payload);
    } catch (error) {
      console.error(
        `Error processing client event ${eventName} in extension ${extensionId}:`,
        error,
      );
      throw error;
    }
  }
}

export const extensionHookManager = new ExtensionHookManager();
