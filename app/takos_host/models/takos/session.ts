import mongoose from "mongoose";
import { sessionSchema } from "../../../takos/models/takos/session.ts";
import tenantScope from "../plugins/tenant_scope.ts";

sessionSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const Session = mongoose.models.Session ??
  mongoose.model("Session", sessionSchema);

export default Session;
export { sessionSchema };

