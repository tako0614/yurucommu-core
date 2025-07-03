import mongoose from "mongoose";

const microblogSchema = new mongoose.Schema({
  author: { type: String, required: true },
  content: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const Microblog = mongoose.model("Microblog", microblogSchema);

export default Microblog;
export { microblogSchema };
