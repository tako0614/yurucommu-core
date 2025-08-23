import mongoose from "mongoose";

const memoSchema = new mongoose.Schema({
  user: { type: String, required: true, index: true },
  content: { type: String, required: true },
  // DM と同様に柔軟な添付形式を許可（url, mediaType, preview 等を含みうる）
  attachments: { type: [mongoose.Schema.Types.Mixed], default: [] },
  createdAt: { type: Date, default: Date.now },
});

const Memo = mongoose.models.Memo ?? mongoose.model("Memo", memoSchema);

export default Memo;
export { memoSchema };
