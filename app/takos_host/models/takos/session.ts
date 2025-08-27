import mongoose from "mongoose";
import { sessionSchema } from "../../../takos/models/takos/session.ts";
import tenantScope from "../plugins/tenant_scope.ts";

sessionSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const HostSession = mongoose.models.HostSession ??
  mongoose.model("HostSession", sessionSchema, "sessions");

export default HostSession;
export { sessionSchema };
