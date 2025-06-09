import mongoose from "mongoose";

const extensionSchema = new mongoose.Schema({
  identifier: { type: String, required: true, unique: true },
  manifest: { type: Object, required: true },
  server: { type: String },
  client: { type: String },
  ui: { type: String },
  icon: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export const Extension = mongoose.model("Extension", extensionSchema);
