import mongoose from "mongoose";

const serverClientSchema = new mongoose.Schema({
  serverId: { type: String, required: true, unique: true },
  name: { type: String, default: "" },
  baseUrl: { type: String, required: true },
  publicKey: { type: String, required: true },
  keyId: { type: String, default: "" },
  secret: { type: String, default: "" },
  status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
  approvedAt: { type: Date, default: null },
  rejectedAt: { type: Date, default: null },
  updatedAt: { type: Date, default: Date.now },
});

serverClientSchema.index({ baseUrl: 1 }, { unique: false });

serverClientSchema.pre("save", function (next) {
  (this as unknown as { updatedAt?: Date }).updatedAt = new Date();
  next();
});

const FaspServerClient = mongoose.models.FaspServerClient ??
  mongoose.model("FaspServerClient", serverClientSchema);

export default FaspServerClient;

