import mongoose from "mongoose";

const videoSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
  },
  attributedTo: { type: String, required: true },
  actor_id: { type: String, required: true, index: true },
  content: { type: String, default: "" },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  published: { type: Date, default: Date.now },
  tenant_id: { type: String, index: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date },
  aud: {
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
  },
});

const HostVideo = mongoose.models.HostVideo ??
  mongoose.model("HostVideo", videoSchema);

export default HostVideo;
export { videoSchema };
