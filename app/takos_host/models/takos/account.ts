import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const accountSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  displayName: { type: String, default: "" },
  avatarInitial: { type: String, default: "" },
  privateKey: { type: String, default: "" },
  publicKey: { type: String, default: "" },
  followers: { type: [String], default: [] },
  following: { type: [String], default: [] },
  groups: { type: [String], default: [] },
  // クライアント表示用のグループ上書き（リモートグループの別名/アイコン差し替え等）
  groupOverrides: { type: mongoose.Schema.Types.Mixed, default: {} },
});

// ホスト環境ではテナントスコープを付与し、
// コア実装が参照する正規のモデル名で登録する
accountSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
accountSchema.index({ userName: 1, tenant_id: 1 }, { unique: true });

const Account = mongoose.models.Account ??
  mongoose.model("Account", accountSchema, "accounts");

export default Account;
export { accountSchema };
