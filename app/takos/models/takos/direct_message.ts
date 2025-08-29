import mongoose from "mongoose";

// DM は「所有者」と「相手」のみを保持する最小構成
const directMessageSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  id: { type: String, required: true }, // 相手ユーザー（ハンドル or IRI）
});

directMessageSchema.index({ owner: 1, id: 1 }, { unique: true });

const DirectMessage = mongoose.models.DirectMessage ??
  mongoose.model("DirectMessage", directMessageSchema);

export default DirectMessage;
export { directMessageSchema };
