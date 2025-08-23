import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

// DM一覧表示用にメタ情報を保持するコレクション
const directMessageSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  id: { type: String, required: true }, // 相手ユーザーまたはグループID
  name: { type: String, default: "" },
  icon: { type: String, default: "" },
  members: { type: [String], default: [] }, // 参加者一覧
});

directMessageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
directMessageSchema.index({ owner: 1, id: 1, tenant_id: 1 }, { unique: true });

const DirectMessage = mongoose.models.DirectMessage ??
  mongoose.model("DirectMessage", directMessageSchema);

export default DirectMessage;
export { directMessageSchema };
