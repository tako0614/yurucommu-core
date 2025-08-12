import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const accountSchema = new mongoose.Schema({
  userName: { type: String, required: true },
  displayName: { type: String, default: "" },
  avatarInitial: { type: String, default: "" },
  privateKey: { type: String, default: "" },
  publicKey: { type: String, default: "" },
  followers: { type: [String], default: [] },
  following: { type: [String], default: [] },
});

accountSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
accountSchema.index({ userName: 1, tenant_id: 1 }, { unique: true });

const Account = mongoose.models.Account ??
  mongoose.model("Account", accountSchema);

export default Account;
export { accountSchema };
