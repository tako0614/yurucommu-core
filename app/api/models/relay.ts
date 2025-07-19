import mongoose from "mongoose";

const relaySchema = new mongoose.Schema({
  host: { type: String, required: true, unique: true },
  inboxUrl: { type: String, required: true },
});

relaySchema.index({ host: 1 });

const Relay = mongoose.model("Relay", relaySchema);

export default Relay;
export { relaySchema };
