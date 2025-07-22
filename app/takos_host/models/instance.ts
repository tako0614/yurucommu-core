import mongoose from "mongoose";

const instanceSchema = new mongoose.Schema({
  host: { type: String, required: true, unique: true },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "HostUser",
    required: true,
  },
  env: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});

const Instance = mongoose.models.Instance ??
  mongoose.model("Instance", instanceSchema);

export default Instance;
export { instanceSchema };
