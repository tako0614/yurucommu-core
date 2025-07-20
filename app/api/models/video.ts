import mongoose from "mongoose";

const videoSchema = new mongoose.Schema({
  _id: { type: String },
  attributedTo: { type: String, required: true },
  actor_id: { type: String, required: true, index: true },
  content: { type: String, default: "" },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  tenant_id: { type: String, index: true },
  published: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date },
  aud: {
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
  },
});

videoSchema.pre("save", function (next) {
  const self = this as unknown as {
    $locals?: { env?: Record<string, string> };
  };
  const env = self.$locals?.env;
  if (!this.tenant_id && env?.ACTIVITYPUB_DOMAIN) {
    this.tenant_id = env.ACTIVITYPUB_DOMAIN;
  }
  next();
});

const Video = mongoose.models.Video ??
  mongoose.model("Video", videoSchema, "videos");

export default Video;
export { videoSchema };
