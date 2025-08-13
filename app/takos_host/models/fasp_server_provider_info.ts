import mongoose from "mongoose";

const capabilitySchema = new mongoose.Schema({
  id: { type: String, required: true },
  version: { type: String, required: true },
}, { _id: false });

const providerInfoSchema = new mongoose.Schema({
  _id: { type: String, default: "provider" },
  name: { type: String, required: true },
  capabilities: { type: [capabilitySchema], default: [] },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

providerInfoSchema.pre("save", function (next) {
  (this as unknown as { updatedAt?: Date }).updatedAt = new Date();
  next();
});

const FaspServerProviderInfo = mongoose.models.FaspServerProviderInfo ??
  mongoose.model("FaspServerProviderInfo", providerInfoSchema);

export default FaspServerProviderInfo;

