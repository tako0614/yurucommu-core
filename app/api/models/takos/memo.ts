import mongoose from "mongoose";

const memoSchema = new mongoose.Schema({
  user: { type: String, required: true, index: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Memo = mongoose.models.Memo ?? mongoose.model("Memo", memoSchema);

export default Memo;
export { memoSchema };
