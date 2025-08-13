import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const pendingInviteSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
  },
  roomId: { type: String, required: true, index: true },
  userName: { type: String, required: true, index: true },
  deviceId: { type: String, required: true },
  expiresAt: { type: Date, required: true }, // 招待の有効期限
  acked: { type: Boolean, default: false },
  tenant_id: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
});

pendingInviteSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
pendingInviteSchema.index({
  roomId: 1,
  userName: 1,
  deviceId: 1,
  tenant_id: 1,
});

const PendingInvite = mongoose.models.PendingInvite ??
  mongoose.model("PendingInvite", pendingInviteSchema);

export default PendingInvite;
export { pendingInviteSchema };
