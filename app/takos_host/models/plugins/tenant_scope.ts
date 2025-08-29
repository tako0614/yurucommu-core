import mongoose from "mongoose";

// テナントスコープ設定用オプション
type TenantScopeOptions = {
  // 互換のために残す（MongoDB ラッパが $locals.env に同キーを注入）
  envKey: string;
};

// DB ラッパ（MongoDB クラス）が各クエリ/ドキュメントに注入する $locals.env を
// 優先的に使用し、プロセス環境(Deno.env)には依存しないようにする。
function getInjectedEnv(ctx: unknown): Record<string, string> | undefined {
  const c = ctx as {
    $locals?: { env?: Record<string, string> };
    getOptions?: () => { $locals?: { env?: Record<string, string> } };
  };
  if (c?.$locals?.env) return c.$locals.env;
  return c?.getOptions?.()?.$locals?.env;
}

function getInjectedTenantId(ctx: unknown): string | undefined {
  const c = ctx as {
    $locals?: { tenantId?: string };
    getOptions?: () => { $locals?: { tenantId?: string } };
  };
  if (c?.$locals?.tenantId) return c.$locals.tenantId;
  return c?.getOptions?.()?.$locals?.tenantId;
}

export default function tenantScope(
  schema: mongoose.Schema,
  options: TenantScopeOptions,
) {
  // takos 本体のスキーマには tenant_id を含めないが、ホスト側では
  // プラグインで付与する（インデックスも付与）。
  if (!schema.path("tenant_id")) {
    schema.add({ tenant_id: { type: String, index: true } });
  }

  const getTenantId = function (this: unknown) {
    // 最優先は $locals.tenantId（DB ラッパが直接注入）
    const injected = getInjectedTenantId(this);
    if (typeof injected === "string") return injected;
    // 後方互換: $locals.env[envKey] を参照
    const env = getInjectedEnv(this) ?? {};
    return env[options.envKey] ?? "";
  };

  schema.pre("save", function (next) {
    const tenantId = getTenantId.call(this);
    if (
      (this as mongoose.Document & { tenant_id?: string }).tenant_id ===
        undefined
    ) {
      (this as mongoose.Document & { tenant_id?: string }).tenant_id = tenantId;
    }
    next();
  });

  const queryHooks = [
    "find",
    "findOne",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
    "findOneAndUpdate",
    "findOneAndDelete",
    "findOneAndRemove",
    "update",
    "delete",
  ];

  for (const hook of queryHooks) {
    schema.pre(hook, function (next) {
      const tenantId = getTenantId.call(this);
      const q = (this as mongoose.Query<unknown, unknown>).getQuery();
      if (q.tenant_id === undefined) {
        (this as mongoose.Query<unknown, unknown>).where({ tenant_id: tenantId });
      }
      next();
    });
  }
}
