import mongoose from "mongoose";

const inboxEntrySchema = new mongoose.Schema({
  object_id: { type: String, required: true },
  received_at: { type: Date, default: Date.now },
});

inboxEntrySchema.index({ object_id: 1 }, { unique: true });

const InboxEntry = mongoose.models.InboxEntry ??
  mongoose.model("InboxEntry", inboxEntrySchema, "inbox_entry");

export default InboxEntry;
export { inboxEntrySchema };
