// イベント定義のタイプ
export type EventSource = "server" | "client" | "ui" | "background";

export interface EventDefinition {
  source: EventSource;
  handler: string;
}

export interface ExtensionEventRegistry {
  [eventName: string]: EventDefinition;
}

// イベントハンドラーの関数型
export type EventHandler = (...args: unknown[]) => unknown | Promise<unknown>;

/**
 * Takopack拡張機能のベースクラス
 */
export class TakopackExtension {
  private _events: ExtensionEventRegistry = {};

  /**
   * サーバーサイドイベントハンドラーを登録
   */
  server(eventName: string, handler: EventHandler): this {
    this._events[eventName] = {
      source: "server",
      handler: handler.name || "anonymous"
    };
    return this;
  }

  /**
   * クライアントサイドイベントハンドラーを登録
   */
  client(eventName: string, handler: EventHandler): this {
    this._events[eventName] = {
      source: "client", 
      handler: handler.name || "anonymous"
    };
    return this;
  }

  /**
   * UIサイドイベントハンドラーを登録
   */
  ui(eventName: string, handler: EventHandler): this {
    this._events[eventName] = {
      source: "ui",
      handler: handler.name || "anonymous"
    };
    return this;
  }

  /**
   * バックグラウンドイベントハンドラーを登録
   */
  background(eventName: string, handler: EventHandler): this {
    this._events[eventName] = {
      source: "background",
      handler: handler.name || "anonymous"
    };
    return this;
  }

  /**
   * 登録されたイベント定義を取得
   */
  getEventDefinitions(): ExtensionEventRegistry {
    return { ...this._events };
  }
}

/**
 * サーバー専用拡張機能クラス
 */
export class ServerExtension extends TakopackExtension {
  constructor() {
    super();
  }
}

/**
 * クライアント専用拡張機能クラス  
 */
export class ClientExtension extends TakopackExtension {
  constructor() {
    super();
  }
}

/**
 * UI専用拡張機能クラス
 */
export class UIExtension extends TakopackExtension {
  constructor() {
    super();
  }
}

/**
 * 拡張機能のメインクラス
 * 全レイヤーで利用可能
 */
export class Takos extends TakopackExtension {
  constructor() {
    super();
  }

  /**
   * ファクトリーメソッド：新しいTakosインスタンスを作成
   */
  static create(): Takos {
    return new Takos();
  }
}

// デフォルトエクスポート
export default Takos;
