import mongoose from "mongoose";

type TenantScopeOptions = {
  envKey: string;
};

function getEnv(ctx: unknown): Record<string, string> {
  const c = ctx as {
    $locals?: { env?: Record<string, string> };
    getOptions?: () => { $locals?: { env?: Record<string, string> } };
  };
  if (c?.$locals?.env) return c.$locals.env;
  const opt = c?.getOptions?.()?.$locals?.env;
  if (opt) return opt;
  return Deno.env.toObject();
}

export default function tenantScope(
  schema: mongoose.Schema,
  options: TenantScopeOptions,
) {
  if (!schema.path("tenant_id")) {
    schema.add({ tenant_id: { type: String, index: true } });
  }

  const getTenantId = function (this: unknown) {
    const env = getEnv(this);
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
        (this as mongoose.Query<unknown, unknown>).where({
          tenant_id: tenantId,
        });
      }
      next();
    });
  }
}
