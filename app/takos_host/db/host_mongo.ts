import { MongoDB } from "../../takos/db/mongo.ts";

// ホスト専用の MongoDB ラッパ
// $locals に tenantId を必ず注入し、テナントスコープ・プラグインが
// Deno.env に依存せず動作するようにする。
export class HostMongoDB extends MongoDB {
  private _tenantId: string;
  constructor(env: Record<string, string>) {
    super(env);
    this._tenantId = env["ACTIVITYPUB_DOMAIN"] ?? "";
  }

  protected override withEnv<Q>(q: Q): Q {
    // deno-lint-ignore no-explicit-any
    return (q as any).setOptions?.({
      $locals: { env: (this as unknown as { env: Record<string, string> })["env"], tenantId: this._tenantId },
    }) ?? q;
  }

  // deno-lint-ignore no-explicit-any
  protected override attachEnv(doc: any) {
    try {
      const env = (this as unknown as { env: Record<string, string> })["env"];
      doc.$locals = { ...(doc.$locals ?? {}), env, tenantId: this._tenantId };
    } catch { /* ignore */ }
    return doc;
  }
}
