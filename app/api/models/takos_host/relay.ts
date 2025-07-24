import mongoose from "mongoose";

const relaySchema = new mongoose.Schema({
  host: { type: String, required: true },
  inboxUrl: { type: String, required: true },
  tenant_id: { type: String, index: true },
  since: { type: Date, default: Date.now },
});

relaySchema.index({ host: 1, tenant_id: 1 }, { unique: true });

const HostRelay = mongoose.models.HostRelay ??
  mongoose.model("HostRelay", relaySchema);

export default HostRelay;
export { relaySchema };
