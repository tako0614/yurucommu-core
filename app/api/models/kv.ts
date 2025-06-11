import mongoose from "mongoose";

interface IKVItem {
  identifier: string;
  side: "server" | "client";
  key: string;
  value: unknown;
}

const kvSchema = new mongoose.Schema<IKVItem>({
  identifier: { type: String, required: true },
  side: { type: String, required: true, enum: ["server", "client"] },
  key: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed },
});
kvSchema.index({ identifier: 1, side: 1, key: 1 }, { unique: true });

export const KVItem = mongoose.model<IKVItem>("KVItem", kvSchema);
