import mongoose from "mongoose";
import { messageSchema } from "../../../takos/models/takos/message.ts";
import tenantScope from "../plugins/tenant_scope.ts";

// テナントスコープを付与して正規モデル名で登録
messageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const Message = mongoose.models.Message ??
  mongoose.model("Message", messageSchema, "messages");

export default Message;
export { messageSchema };

