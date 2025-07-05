import mongoose from "mongoose";

const activityPubObjectSchema = new mongoose.Schema({
  type: { type: String, required: true }, // Note, Image, Article, Story, CommunityPost など
  attributedTo: { type: String, required: true },
  content: { type: String },
  to: { type: [String], default: [] },
  cc: { type: [String], default: [] },
  published: { type: Date, default: Date.now },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} }, // type固有の追加情報
});

const ActivityPubObject = mongoose.model("ActivityPubObject", activityPubObjectSchema);

export default ActivityPubObject;
export { activityPubObjectSchema };
