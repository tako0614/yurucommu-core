import mongoose from "mongoose";

// DM一覧表示用にメタ情報を保持するコレクション
const directMessageSchema = new mongoose.Schema({
  owner: { type: String, required: true },
  id: { type: String, required: true }, // 相手ユーザーまたはグループID
  name: { type: String, default: "" },
  icon: { type: String, default: "" },
  // Note: members removed — direct message rooms are identified by owner+id
});

directMessageSchema.index({ owner: 1, id: 1 }, { unique: true });

const DirectMessage = mongoose.models.DirectMessage ??
  mongoose.model("DirectMessage", directMessageSchema);

export default DirectMessage;
export { directMessageSchema };
