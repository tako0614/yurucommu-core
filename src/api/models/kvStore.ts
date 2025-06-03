import mongoose from "mongoose";

const kvStoreSchema = new mongoose.Schema({
  extensionId: {
    type: String,
    required: true,
    index: true,
  },
  key: {
    type: String,
    required: true,
    index: true,
  },
  value: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// 複合インデックス：拡張機能IDとキーでユニーク
kvStoreSchema.index({ extensionId: 1, key: 1 }, { unique: true });

export const KVStore = mongoose.model("KVStore", kvStoreSchema);
