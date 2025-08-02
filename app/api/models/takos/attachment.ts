import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema({
  _id: { type: String },
  attributedTo: { type: String, required: true },
  actor_id: { type: String, required: true, index: true },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date },
});

const Attachment = mongoose.models.Attachment ??
  mongoose.model("Attachment", attachmentSchema, "attachments");

export default Attachment;
export { attachmentSchema };
