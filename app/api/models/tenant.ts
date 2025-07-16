import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema({
  _id: { type: String },
  domain: { type: String, required: true, unique: true },
  created_at: { type: Date, default: Date.now },
});

const Tenant = mongoose.model("Tenant", tenantSchema, "tenant");

export default Tenant;
export { tenantSchema };
