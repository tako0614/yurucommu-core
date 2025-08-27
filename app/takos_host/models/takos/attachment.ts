import mongoose from "mongoose";
import { attachmentSchema } from "../../../takos/models/takos/attachment.ts";
import tenantScope from "../plugins/tenant_scope.ts";

attachmentSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const HostAttachment = mongoose.models.HostAttachment ??
  mongoose.model("HostAttachment", attachmentSchema, "attachments");

export default HostAttachment;
export { attachmentSchema };
