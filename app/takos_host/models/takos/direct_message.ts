import mongoose from "mongoose";
import { directMessageSchema } from "../../../takos/models/takos/direct_message.ts";
import tenantScope from "../plugins/tenant_scope.ts";

// members removed in base schema; keep tenant scoping and index
directMessageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
directMessageSchema.index({ owner: 1, id: 1, tenant_id: 1 }, { unique: true });

// コア実装が利用する正規のモデル名で登録する
const DirectMessage = mongoose.models.DirectMessage ??
  mongoose.model("DirectMessage", directMessageSchema, "direct_messages");

export default DirectMessage;
export { directMessageSchema };
