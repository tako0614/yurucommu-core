import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
  tenant_id: { type: String, index: true },
  name: { type: String, required: true },
  description: { type: String, default: "" },
  followers: { type: [String], default: [] },
  isPrivate: { type: Boolean, default: false },
  pendingFollowers: { type: [String], default: [] },
  avatar: { type: String, default: "" },
  banner: { type: String, default: "" },
  tags: { type: [String], default: [] },
  rules: { type: [String], default: [] },
  members: { type: [String], default: [] },
  moderators: { type: [String], default: [] },
  banned: { type: [String], default: [] },
  privateKey: { type: String, default: "" },
  publicKey: { type: String, default: "" },
}, { timestamps: true });

groupSchema.index({ name: 1, tenant_id: 1 }, { unique: true });

groupSchema.pre("save", function (next) {
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

const Group = mongoose.model("Group", groupSchema);

export default Group;
export { groupSchema };
