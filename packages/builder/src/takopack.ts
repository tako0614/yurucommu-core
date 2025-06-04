import { ClientExtension, ServerExtension, UIExtension } from "./classes.ts";

/**
 * Simple container to aggregate extension classes.
 *
 * Example usage:
 * ```ts
 * const app = new TakoPack();
 * app.useServer(MyServer);
 * app.useClient(MyClient);
 * export const functions = app.functions;
 * ```
 */
export class TakoPack {
  private serverClasses: Array<typeof ServerExtension> = [];
  private clientClasses: Array<typeof ClientExtension> = [];
  private uiClasses: Array<typeof UIExtension> = [];

  useServer(cls: typeof ServerExtension): this {
    this.serverClasses.push(cls);
    return this;
  }

  useClient(cls: typeof ClientExtension): this {
    this.clientClasses.push(cls);
    return this;
  }

  useUI(cls: typeof UIExtension): this {
    this.uiClasses.push(cls);
    return this;
  }

  /**
   * Exposed for builder to pick up exported classes.
   * Contains all registered classes grouped by context.
   */
  get functions() {
    return {
      server: this.serverClasses,
      client: this.clientClasses,
      ui: this.uiClasses,
    };
  }
}
