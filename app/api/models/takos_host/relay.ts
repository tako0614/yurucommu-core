import mongoose from "mongoose";

const relaySchema = new mongoose.Schema({
  host: { type: String, required: true },
  inboxUrl: { type: String, required: true },
  tenant_id: { type: String, index: true },
});

relaySchema.index({ host: 1, tenant_id: 1 }, { unique: true });

const Relay = mongoose.models.Relay ?? mongoose.model("Relay", relaySchema);

export default Relay;
export { relaySchema };
