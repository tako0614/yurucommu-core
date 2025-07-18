import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema({
  tenant_id: { type: String, index: true },
  sessionId: {
    type: String,
    required: true,
    unique: true,
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
});

sessionSchema.pre("save", function (next) {
  const self = this as unknown as {
    $locals?: { env?: Record<string, string> };
    tenant_id?: string;
  };
  const env = self.$locals?.env;
  if (!self.tenant_id && env?.ACTIVITYPUB_DOMAIN) {
    self.tenant_id = env.ACTIVITYPUB_DOMAIN;
  }
  next();
});

const Session = mongoose.model("Session", sessionSchema);

export default Session;
export { sessionSchema };
