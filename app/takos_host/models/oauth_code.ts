import mongoose from "mongoose";

const oauthCodeSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
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

const OAuthCode = mongoose.model("OAuthCode", oauthCodeSchema);

export default OAuthCode;
export { oauthCodeSchema };
