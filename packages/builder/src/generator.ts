import type {
  ActivityPubConfig,
  EventDefinition,
  ExportInfo,
  ModuleAnalysis,
  TypeGenerationOptions,
  TypeGenerationResult,
  VirtualEntry,
} from "./types.ts";

/**
 * Virtual Entrypoint Generator
 *
 * AST解析結果から仮想エントリポイントを生成
 * - server.js用のエクスポート統合
 * - client.js用のエクスポート統合
 * - manifest.json用の設定生成
 * - TypeScript型定義ファイル生成
 */
export class VirtualEntryGenerator {
  /**
   * サーバー用Virtual Entrypoint生成
   */
  generateServerEntry(analyses: ModuleAnalysis[]): VirtualEntry {
    const exports: string[] = [];
    const imports: string[] = [];
    const wrappers: string[] = [];
    const classMap = new Map<string, Set<string>>();
    const exportInfoMap = new Map<string, ExportInfo>();
    const eventDefinitions: Record<string, EventDefinition> = {};
    const eventWrappers = new Map<
      string,
      { className?: string; handler: string }
    >();
    const activityPubConfigs: ActivityPubConfig[] = [];

    analyses.forEach((analysis) => {
      // import文を収集
      analysis.imports.forEach((imp) => {
        if (!imp.isTypeOnly) {
          imports.push(
            `import ${
              this.formatImportClause(imp.imports)
            } from "${imp.source}";`,
          );
        }
      });

      // export関数を収集
      analysis.exports.forEach((exp) => {
        exportInfoMap.set(exp.name, exp);
        if (exp.type === "function") {
          exports.push(exp.name);
          imports.push(
            `export { ${exp.name} } from "${
              this.relativePath(analysis.filePath)
            }";`,
          );
        } else if (exp.type === "const" && exp.instanceOf) {
          imports.push(
            `import { ${exp.name} } from "${
              this.relativePath(analysis.filePath)
            }";`,
          );
          classMap.set(exp.name, new Set());
        } else if (exp.type === "const") {
          exports.push(exp.name);
          imports.push(
            `export { ${exp.name} } from "${
              this.relativePath(analysis.filePath)
            }";`,
          );
        } else if (exp.type === "class") {
          imports.push(
            `import { ${exp.name} } from "${
              this.relativePath(analysis.filePath)
            }";`,
          );
          classMap.set(exp.name, new Set());
        }
      });

      // JSDocタグからActivityPubとイベント設定を生成
      this.processJSDocTags(
        analysis,
        eventDefinitions,
        activityPubConfigs,
        classMap,
        eventWrappers,
      );

      // デコレータからActivityPubとイベント設定を生成
      this.processDecorators(
        analysis,
        eventDefinitions,
        activityPubConfigs,
        classMap,
        eventWrappers,
      );
    });

    // ラッパー関数生成
    classMap.forEach((methods, className) => {
      const info = exportInfoMap.get(className);
      if (info && info.type === "const" && info.instanceOf) {
        methods.forEach((m) => {
          const wrapperName = `${m}`;
          wrappers.push(
            `export const ${wrapperName} = (...args: any[]) => ${className}.${m}(...args);`,
          );
          exports.push(wrapperName);
        });
      } else {
        const instance = `__${className}`;
        wrappers.push(`const ${instance} = new ${className}();`);
        methods.forEach((m) => {
          const wrapperName = `${m}`;
          wrappers.push(
            `export const ${wrapperName} = (...args: any[]) => ${instance}.${m}(...args);`,
          );
          exports.push(wrapperName);
        });
      }
    });

    // Event wrappers using event names
    eventWrappers.forEach((info, eventName) => {
      const wrapperName = eventName;
      if (info.className) {
        wrappers.push(
          `export const ${wrapperName} = (...args: any[]) => ${info.className}.${info.handler}(...args);`,
        );
      } else {
        wrappers.push(
          `export const ${wrapperName} = (...args: any[]) => ${info.handler}(...args);`,
        );
      }
      exports.push(wrapperName);
    });

    const content = this.buildEntryContent([...imports, ...wrappers], exports, {
      eventDefinitions,
      activityPubConfigs,
    });

    return {
      type: "server",
      exports: Array.from(new Set(exports)),
      imports: Array.from(new Set(imports)),
      content,
    };
  }

  /**
   * クライアント用Virtual Entrypoint生成
   */
  generateClientEntry(analyses: ModuleAnalysis[]): VirtualEntry {
    const exports: string[] = [];
    const imports: string[] = [];
    const wrappers: string[] = [];
    const classMap = new Map<string, Set<string>>();
    const exportInfoMap = new Map<string, ExportInfo>();
    const eventWrappers = new Map<
      string,
      { className?: string; handler: string }
    >();

    analyses.forEach((analysis) => {
      // import文を収集
      analysis.imports.forEach((imp) => {
        if (!imp.isTypeOnly) {
          imports.push(
            `import ${
              this.formatImportClause(imp.imports)
            } from "${imp.source}";`,
          );
        }
      });

      // export関数を収集
      analysis.exports.forEach((exp) => {
        exportInfoMap.set(exp.name, exp);
        if (exp.type === "function") {
          exports.push(exp.name);
          imports.push(
            `export { ${exp.name} } from "${
              this.relativePath(analysis.filePath)
            }";`,
          );
        } else if (exp.type === "const" && exp.instanceOf) {
          imports.push(
            `import { ${exp.name} } from "${
              this.relativePath(analysis.filePath)
            }";`,
          );
          classMap.set(exp.name, new Set());
        } else if (exp.type === "const") {
          exports.push(exp.name);
          imports.push(
            `export { ${exp.name} } from "${
              this.relativePath(analysis.filePath)
            }";`,
          );
        } else if (exp.type === "class") {
          imports.push(
            `import { ${exp.name} } from "${
              this.relativePath(analysis.filePath)
            }";`,
          );
          classMap.set(exp.name, new Set());
        }
      });

      // JSDoc / Decorator 処理してメソッド登録
      this.processJSDocTags(
        analysis,
        {},
        [],
        classMap,
        eventWrappers,
      );
      this.processDecorators(
        analysis,
        {},
        [],
        classMap,
        eventWrappers,
      );
    });

    // ラッパー生成
    classMap.forEach((methods, className) => {
      const info = exportInfoMap.get(className);
      if (info && info.type === "const" && info.instanceOf) {
        methods.forEach((m) => {
          const wrapperName = `${m}`;
          wrappers.push(
            `export const ${wrapperName} = (...args: any[]) => ${className}.${m}(...args);`,
          );
          exports.push(wrapperName);
        });
      } else {
        const instance = `__${className}`;
        wrappers.push(`const ${instance} = new ${className}();`);
        methods.forEach((m) => {
          const wrapperName = `${m}`;
          wrappers.push(
            `export const ${wrapperName} = (...args: any[]) => ${instance}.${m}(...args);`,
          );
          exports.push(wrapperName);
        });
      }
    });

    eventWrappers.forEach((info, eventName) => {
      const wrapperName = eventName;
      if (info.className) {
        wrappers.push(
          `export const ${wrapperName} = (...args: any[]) => ${info.className}.${info.handler}(...args);`,
        );
      } else {
        wrappers.push(
          `export const ${wrapperName} = (...args: any[]) => ${info.handler}(...args);`,
        );
      }
      exports.push(wrapperName);
    });

    const content = this.buildEntryContent([...imports, ...wrappers], exports);

    return {
      type: "client",
      exports: Array.from(new Set(exports)),
      imports: Array.from(new Set(imports)),
      content,
    };
  }

  /**
   * JSDocタグを処理してイベント・ActivityPub設定を生成
   */
  private processJSDocTags(
    analysis: ModuleAnalysis,
    eventDefinitions: Record<string, EventDefinition>,
    activityPubConfigs: ActivityPubConfig[],
    classMap: Map<string, Set<string>>,
    eventWrappers: Map<string, { className?: string; handler: string }>,
  ): void {
    analysis.jsDocTags.forEach((tag) => {
      if (tag.tag === "activity") {
        // @activity("Note", { priority: 100, serial: true })
        const handlerName = tag.targetFunction;
        const activityConfig = this.parseActivityTag(
          tag.value,
          handlerName,
        );
        if (activityConfig) {
          activityPubConfigs.push(activityConfig);
        }
      } else if (tag.tag === "event") {
        // @event("myEvent", { source: "client" })
        const handlerName = tag.targetFunction;
        const eventConfig = this.parseEventTag(tag.value, handlerName);
        if (eventConfig) {
          const eventName = this.extractEventName(tag.value);
          if (eventName) {
            eventDefinitions[eventName] = eventConfig;
            eventWrappers.set(eventName, {
              className: tag.targetClass,
              handler: handlerName,
            });
          }
        }
      }

      if (tag.targetClass && classMap.has(tag.targetClass)) {
        classMap.get(tag.targetClass)!.add(tag.targetFunction);
      }
    });
  }

  /**
   * デコレータを処理してイベント・ActivityPub設定を生成
   */
  private processDecorators(
    analysis: ModuleAnalysis,
    eventDefinitions: Record<string, EventDefinition>,
    activityPubConfigs: ActivityPubConfig[],
    classMap: Map<string, Set<string>>,
    eventWrappers: Map<string, { className?: string; handler: string }>,
  ): void {
    analysis.decorators.forEach((decorator) => {
      if (decorator.name === "activity") {
        // @activity("Note", { priority: 100 })
        const handlerName = decorator.targetFunction;
        const activityConfig = this.parseActivityDecorator(
          decorator.args,
          handlerName,
        );
        if (activityConfig) {
          activityPubConfigs.push(activityConfig);
        }
      } else if (decorator.name === "event") {
        // @event("myEvent", { source: "client" })
        const handlerName = decorator.targetFunction;
        const eventConfig = this.parseEventDecorator(
          decorator.args,
          handlerName,
        );
        if (eventConfig) {
          const eventName = typeof decorator.args[0] === "string"
            ? decorator.args[0]
            : "";
          if (eventName) {
            eventDefinitions[eventName] = eventConfig;
            eventWrappers.set(eventName, {
              className: decorator.targetClass,
              handler: handlerName,
            });
          }
        }
      }

      if (decorator.targetClass && classMap.has(decorator.targetClass)) {
        classMap.get(decorator.targetClass)!.add(decorator.targetFunction);
      }
    });
  }

  /**
   * @activityタグをパース
   */
  private parseActivityTag(
    value: string,
    targetFunction: string,
  ): ActivityPubConfig | null {
    try {
      // @activity("Note", { priority: 100, serial: true }) 形式をパース
      const match = value.match(/^["']([^"']+)["'](?:,\s*({.+}))?/);
      if (!match) return null;

      const object = match[1];

      return {
        object,
        hook: targetFunction,
      };
    } catch {
      return null;
    }
  }

  /**
   * @activityデコレータをパース
   */
  private parseActivityDecorator(
    args: unknown[],
    targetFunction: string,
  ): ActivityPubConfig | null {
    if (args.length === 0) return null;

    const object = args[0] as string;

    return {
      object,
      hook: targetFunction,
    };
  }

  /**
   * @eventタグをパース
   */
  private parseEventTag(
    value: string,
    targetFunction: string,
  ): EventDefinition | null {
    try {
      // @event("myEvent", { source: "client" }) 形式をパース
      const match = value.match(/^["']([^"']+)["'](?:,\s*({.+}))?/);
      if (!match) return null;

      const options = match[2] ? JSON.parse(match[2]) : {};

      return {
        source: options.source || "client",
        handler: targetFunction,
      };
    } catch {
      return null;
    }
  }
  /**
   * @eventデコレータをパース
   */
  private parseEventDecorator(
    args: unknown[],
    targetFunction: string,
  ): EventDefinition | null {
    if (args.length === 0) return null;

    const options = (args[1] as Record<string, unknown>) || {};

    return {
      source:
        (typeof options.source === "string" ? options.source : "client") as
          | "client"
          | "server"
          | "background"
          | "ui",
      handler: targetFunction,
    };
  }

  /**
   * イベント名を抽出
   */
  private extractEventName(value: string): string | null {
    const match = value.match(/^["']([^"']+)["']/);
    return match ? match[1] : null;
  }

  /**
   * import句をフォーマット
   */
  private formatImportClause(
    imports: { name: string; alias?: string }[],
  ): string {
    const clauses = imports.map((imp) => {
      if (imp.name === "default") {
        return imp.alias || "default";
      } else if (imp.name === "*") {
        return `* as ${imp.alias}`;
      } else {
        return imp.alias ? `${imp.name} as ${imp.alias}` : imp.name;
      }
    });

    if (clauses.length === 1 && imports[0].name === "default") {
      return clauses[0];
    } else {
      return `{ ${clauses.join(", ")} }`;
    }
  } /**
   * 相対パス変換
   */

  private relativePath(filePath: string): string {
    // virtual entryは .takopack-tmp フォルダ内にあるため、
    // 元ファイルへは ../ を使って戻る必要がある
    let path = filePath;
    if (
      !path.startsWith("./") && !path.startsWith("../") && !path.startsWith("/")
    ) {
      path = "../" + path;
    }

    return path;
  }
  /**
   * エントリポイントコンテンツを構築
   */
  private buildEntryContent(
    imports: string[],
    _exports: string[],
    metadata?: {
      eventDefinitions?: Record<string, EventDefinition>;
      activityPubConfigs?: ActivityPubConfig[];
    },
  ): string {
    const content: string[] = [];

    // imports
    content.push("// Auto-generated virtual entry point");
    content.push("// DO NOT EDIT MANUALLY");
    content.push("");

    if (imports.length > 0) {
      content.push(...Array.from(new Set(imports)));
      content.push("");
    }

    // metadata comment (for debugging)
    if (metadata) {
      content.push("/*");
      content.push(" * Generated metadata:");
      if (
        metadata.eventDefinitions &&
        Object.keys(metadata.eventDefinitions).length > 0
      ) {
        content.push(" * Event Definitions:");
        content.push(
          ` *   ${
            JSON.stringify(metadata.eventDefinitions, null, 2).replace(
              /\n/g,
              "\n *   ",
            )
          }`,
        );
      }
      if (
        metadata.activityPubConfigs && metadata.activityPubConfigs.length > 0
      ) {
        content.push(" * ActivityPub Configs:");
        content.push(
          ` *   ${
            JSON.stringify(metadata.activityPubConfigs, null, 2).replace(
              /\n/g,
              "\n *   ",
            )
          }`,
        );
      }
      content.push(" */");
      content.push("");
    }

    return content.join("\n");
  }

  /**
   * TypeScript型定義ファイルを生成
   */
  generateTypeDefinitions(
    options: TypeGenerationOptions,
  ): TypeGenerationResult {
    const content = this.buildTypeDefinitionContent(options);

    return {
      filePath: options.outputPath,
      content,
      typeCount: this.countTypesInContent(content),
    };
  }

  /**
   * コンテキストに応じた型定義内容を構築
   */
  private buildTypeDefinitionContent(options: TypeGenerationOptions): string {
    const lines: string[] = [];

    // Header
    lines.push("// Auto-generated TypeScript definitions for Takos Extension");
    lines.push("// DO NOT EDIT MANUALLY");
    lines.push("// Generated at: " + new Date().toISOString());
    lines.push("");

    // Core types import
    lines.push("// Core Takos API Types");
    lines.push(this.generateCoreTypesDefinition());
    lines.push("");

    // Context-specific globalThis extension
    lines.push(
      "// GlobalThis type extension for " + options.context + " context",
    );
    lines.push(this.generateGlobalThisExtension(options.context));
    lines.push("");

    // Custom types if requested
    if (options.includeCustomTypes) {
      lines.push("// Custom project types");
      lines.push(this.generateCustomTypesDefinition());
      lines.push("");
    }

    return lines.join("\n");
  }

  /**
   * 基本的なTakos API型定義を生成
   */
  private generateCoreTypesDefinition(): string {
    return `
// Serializable value types for safe communication
export type SerializableValue = 
  | string 
  | number 
  | boolean 
  | null 
  | SerializableObject 
  | SerializableArray;

export interface SerializableObject {
  [key: string]: SerializableValue;
}

export interface SerializableArray extends Array<SerializableValue> {}

// Event types
export interface TakosEvent<T = SerializableValue> {
  name: string;
  payload: T;
  timestamp: number;
  source: 'server' | 'client' | 'ui' | 'background';
}

export type EventHandler<T = SerializableValue> = (payload: T) => void | Promise<void>;

// KV API
export interface TakosKVAPI {
  read(key: string): Promise<SerializableValue>;
  write(key: string, value: SerializableValue): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

// Assets API
export interface TakosCdnAPI {
  read(assetId: string): Promise<Uint8Array>;
  write(assetId: string, data: Uint8Array, options?: { cacheTTL?: number }): Promise<void>;
  delete(assetId: string): Promise<void>;
  list(): Promise<string[]>;
}`;
  }

  /**
   * コンテキスト別のglobalThis拡張を生成
   */
  private generateGlobalThisExtension(context: string): string {
    switch (context) {
      case "server":
        return `
declare global {
  namespace globalThis {
    var takos: {
      kv: TakosKVAPI;
      activityPub: {
        send(userId: string, activity: SerializableObject): Promise<void>;
        read(id: string): Promise<SerializableObject>;
        delete(id: string): Promise<void>;
        list(userId?: string): Promise<string[]>;
        actor: {
          read(userId: string): Promise<SerializableObject>;
          update(userId: string, key: string, value: string): Promise<void>;
          delete(userId: string, key: string): Promise<void>;
        };
        pluginActor: {
          create(localName: string, profile: SerializableObject): Promise<string>;
          read(iri: string): Promise<SerializableObject>;
          update(iri: string, partial: SerializableObject): Promise<void>;
          delete(iri: string): Promise<void>;
          list(): Promise<string[]>;
        };
      };
      cdn: TakosCdnAPI;
      events: {
        publish<T = SerializableValue>(name: string, payload: T): Promise<void>;
      };
    } | undefined;
  }
}`;

      case "client":
        return `
export interface GlobalThisWithClientTakos {
  takos: {
    kv: TakosKVAPI;
    cdn: TakosCdnAPI;
    events: {
      publish<T = SerializableValue>(name: string, payload: T): Promise<void>;
    };
  } | undefined;
}

declare const globalThis: GlobalThisWithClientTakos;`;

      case "ui":
        return `
export interface GlobalThisWithUITakos {
  takos: {
    events: {
      publish<T = SerializableValue>(name: string, payload: T): Promise<void>;
    };
  } | undefined;
}

declare const globalThis: GlobalThisWithUITakos;`;

      default:
        return "// Unknown context";
    }
  }

  /**
   * カスタム型定義を生成
   */
  private generateCustomTypesDefinition(): string {
    return `
// Custom project-specific types can be added here
// These types will be extracted from your project code

export interface CustomEventPayload {
  // Add your custom event payload types here
  [eventName: string]: SerializableValue;
}

export interface CustomActivityPubActivity {
  // Add your custom ActivityPub activity types here
  "@context": string | string[];
  type: string;
  actor: string;
  object?: SerializableValue;
  target?: SerializableValue;
  [key: string]: SerializableValue;
}`;
  }

  /**
   * 型定義内容から型の数をカウント
   */
  private countTypesInContent(content: string): number {
    const typeDeclarations = content.match(/(interface|type|declare)\s+\w+/g) ||
      [];
    return typeDeclarations.length;
  }
}
