import mongoose from "mongoose";

const relaySchema = new mongoose.Schema({
  inboxUrl: { type: String, required: true, unique: true },
});

const Relay = mongoose.model("Relay", relaySchema);

export default Relay;
export { relaySchema };
