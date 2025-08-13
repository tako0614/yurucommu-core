import mongoose from "mongoose";

const faspClientSchema = new mongoose.Schema({
  tenant: { type: String, required: true, unique: true },
  secret: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

faspClientSchema.pre("save", function (next) {
  (this as unknown as { updatedAt?: Date }).updatedAt = new Date();
  next();
});

const FaspClient = mongoose.models.FaspClient ??
  mongoose.model("FaspClient", faspClientSchema);

export default FaspClient;

