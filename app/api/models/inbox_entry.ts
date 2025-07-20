import mongoose from "mongoose";

// tenant_id でテナントを区別する
const inboxEntrySchema = new mongoose.Schema({
  tenant_id: { type: String, index: true },
  object_id: { type: String, required: true },
  received_at: { type: Date, default: Date.now },
});

// tenant_id + object_id の組み合わせで一意とする
inboxEntrySchema.index({ tenant_id: 1, object_id: 1 }, { unique: true });

const InboxEntry = mongoose.models.InboxEntry ??
  mongoose.model("InboxEntry", inboxEntrySchema, "inbox_entry");

export default InboxEntry;
export { inboxEntrySchema };
