import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, default: "" },
  followers: { type: [String], default: [] },
});

const Group = mongoose.model("Group", groupSchema);

export default Group;
export { groupSchema };
