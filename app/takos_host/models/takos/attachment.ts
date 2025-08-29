import mongoose from "mongoose";
import { attachmentSchema } from "../../../takos/models/takos/attachment.ts";
import tenantScope from "../plugins/tenant_scope.ts";

attachmentSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

// コア実装が利用する正規のモデル名で登録する
const Attachment = mongoose.models.Attachment ??
  mongoose.model("Attachment", attachmentSchema, "attachments");

export default Attachment;
export { attachmentSchema };
