import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

// MLS の暗号状態はクライアントで管理し、サーバーでは保持しない
const chatroomSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  id: { type: String, required: true },
  name: { type: String, default: "" },
  icon: { type: String, default: "" },
  userSet: {
    type: {
      name: { type: Boolean, default: false },
      icon: { type: Boolean, default: false },
    },
    default: { name: false, icon: false },
  },
  members: { type: [String], default: [] },
});

chatroomSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });
chatroomSchema.index({ owner: 1, id: 1, tenant_id: 1 }, { unique: true });

const Chatroom = mongoose.models.Chatroom ??
  mongoose.model("Chatroom", chatroomSchema);

export default Chatroom;
export { chatroomSchema };
