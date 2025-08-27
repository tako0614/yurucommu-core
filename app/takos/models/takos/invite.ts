import mongoose from "mongoose";

const inviteSchema = new mongoose.Schema({
  groupName: { type: String, required: true },
  actor: { type: String, required: true },
  inviter: { type: String, default: "" },
  expiresAt: { type: Date },
  remainingUses: { type: Number, default: 1 },
  accepted: { type: Boolean, default: false },
}, { timestamps: true });

inviteSchema.index({ groupName: 1, actor: 1 }, { unique: true });

const Invite = mongoose.models.Invite ?? mongoose.model("Invite", inviteSchema);

export default Invite;
export { inviteSchema };
