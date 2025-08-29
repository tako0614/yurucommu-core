import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const sessionSchema = new mongoose.Schema({
  sessionId: {
    type: String,
    required: true,
    unique: true,
  },
  deviceId: {
    type: String,
    required: true,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 },
  },
  lastDecryptAt: {
    type: Date,
    default: Date.now,
  },
});

sessionSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const Session = mongoose.models.Session ??
  mongoose.model("Session", sessionSchema);

export default Session;
export { sessionSchema };

