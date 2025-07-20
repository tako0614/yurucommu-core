import mongoose from "mongoose";

const domainSchema = new mongoose.Schema({
  domain: { type: String, required: true, unique: true },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "HostUser",
    required: true,
  },
  token: { type: String, required: true },
  verified: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
});

const HostDomain = mongoose.models.HostDomain ??
  mongoose.model("HostDomain", domainSchema);

export default HostDomain;
export { domainSchema };
