import mongoose from "mongoose";

const approvalSchema = new mongoose.Schema({
  groupName: { type: String, required: true },
  actor: { type: String, required: true },
  activity: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

approvalSchema.index({ groupName: 1, actor: 1 }, {
  unique: true,
});

const Approval = mongoose.models.Approval ??
  mongoose.model("Approval", approvalSchema);

export default Approval;
export { approvalSchema };
