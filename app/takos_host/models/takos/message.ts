import mongoose from "mongoose";
import { messageSchema } from "../../../takos/models/takos/message.ts";
import tenantScope from "../plugins/tenant_scope.ts";

messageSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const HostMessage = mongoose.models.HostMessage ??
  mongoose.model("HostMessage", messageSchema, "messages");

export default HostMessage;
export { messageSchema };
