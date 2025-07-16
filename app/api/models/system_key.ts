import mongoose from "mongoose";

const systemKeySchema = new mongoose.Schema({
  domain: { type: String, required: true, unique: true },
  privateKey: { type: String, required: true },
  publicKey: { type: String, required: true },
});

const SystemKey = mongoose.model("SystemKey", systemKeySchema, "system_key");

export default SystemKey;
export { systemKeySchema };
