import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
  },
  attributedTo: { type: String, required: true },
  actor_id: { type: String, required: true, index: true },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  tenant_id: { type: String, index: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date },
});

const HostAttachment = mongoose.models.HostAttachment ??
  mongoose.model("HostAttachment", attachmentSchema);

export default HostAttachment;
export { attachmentSchema };
