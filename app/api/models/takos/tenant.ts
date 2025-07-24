import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  domain: { type: String, required: true },
  created_at: { type: Date, default: Date.now },
});

tenantSchema.index({ _id: 1 }, { unique: true });

const Tenant = mongoose.models.Tenant ??
  mongoose.model("Tenant", tenantSchema);

export default Tenant;
export { tenantSchema };
