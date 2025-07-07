import mongoose from "mongoose";

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: { type: String, default: "" },
  followers: { type: [String], default: [] },
  isPrivate: { type: Boolean, default: false },
  pendingFollowers: { type: [String], default: [] },
  avatar: { type: String, default: "" },
  banner: { type: String, default: "" },
  tags: { type: [String], default: [] },
  rules: { type: [String], default: [] },
  members: { type: [String], default: [] },
  moderators: { type: [String], default: [] },
  banned: { type: [String], default: [] },
  privateKey: { type: String, default: "" },
  publicKey: { type: String, default: "" },
}, { timestamps: true });

const Group = mongoose.model("Group", groupSchema);

export default Group;
export { groupSchema };
