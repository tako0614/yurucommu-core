import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const noteSchema = new mongoose.Schema({
  _id: { type: String },
  attributedTo: { type: String, required: true },
  actor_id: { type: String, required: true, index: true },
  content: { type: String, default: "" },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  published: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date },
  aud: {
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
  },
});

noteSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const Note = mongoose.models.Note ??
  mongoose.model("Note", noteSchema, "notes");

export default Note;
export { noteSchema };
