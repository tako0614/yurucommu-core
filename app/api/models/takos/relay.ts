import mongoose from "mongoose";

const relaySchema = new mongoose.Schema({
  host: { type: String, required: true, unique: true },
  inboxUrl: { type: String, required: true },
  since: { type: Date, default: Date.now },
});

const Relay = mongoose.models.Relay ?? mongoose.model("Relay", relaySchema);

export default Relay;
export { relaySchema };
