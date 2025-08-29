import mongoose from "mongoose";
import { accountSchema } from "../../../takos/models/takos/account.ts";
import tenantScope from "../plugins/tenant_scope.ts";

// ホスト環境ではテナントスコープを付与し、
// コア実装が参照する正規のモデル名で登録する
accountSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
accountSchema.index({ userName: 1, tenant_id: 1 }, { unique: true });

const Account = mongoose.models.Account ??
  mongoose.model("Account", accountSchema, "accounts");

export default Account;
export { accountSchema };
