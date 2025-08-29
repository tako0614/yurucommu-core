import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

// DM は「所有者」と「相手」のみを保持する最小構成
const directMessageSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  id: { type: String, required: true }, // 相手ユーザー（ハンドル or IRI）
});

// members removed in base schema; keep tenant scoping and index
directMessageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
directMessageSchema.index({ owner: 1, id: 1, tenant_id: 1 }, { unique: true });

// コア実装が利用する正規のモデル名で登録する
const DirectMessage = mongoose.models.DirectMessage ??
  mongoose.model("DirectMessage", directMessageSchema, "direct_messages");

export default DirectMessage;
export { directMessageSchema };
