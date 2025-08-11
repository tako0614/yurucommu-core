import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const videoSchema = new mongoose.Schema({
  _id: { type: String },
  attributedTo: { type: String, required: true },
  actor_id: { type: String, required: true, index: true },
  content: { type: String, default: "" },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  published: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date },
  aud: {
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
  },
});

videoSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const Video = mongoose.models.Video ??
  mongoose.model("Video", videoSchema, "videos");

export default Video;
export { videoSchema };
