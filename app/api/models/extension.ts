import mongoose from "mongoose";

interface IExtension {
  identifier: string;
  manifest: Record<string, unknown>;
  server?: string;
  client?: string;
  ui?: string;
  icon?: string;
  createdAt?: Date;
}

const extensionSchema = new mongoose.Schema({
  identifier: { type: String, required: true, unique: true },
  manifest: { type: Object, required: true },
  server: { type: String },
  client: { type: String },
  ui: { type: String },
  icon: { type: String },
  createdAt: { type: Date, default: Date.now },
});

export const Extension = mongoose.model<IExtension>(
  "Extension",
  extensionSchema,
);
