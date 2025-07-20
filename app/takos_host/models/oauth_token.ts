import mongoose from "mongoose";

const oauthTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true },
  client: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "OAuthClient",
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "HostUser",
    required: true,
  },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
});

const OAuthToken = mongoose.models.OAuthToken ??
  mongoose.model("OAuthToken", oauthTokenSchema);

export default OAuthToken;
export { oauthTokenSchema };
