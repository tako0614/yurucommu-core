import mongoose from "mongoose";

const oauthClientSchema = new mongoose.Schema({
  clientId: { type: String, required: true, unique: true },
  clientSecret: { type: String, required: true },
  redirectUri: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

const OAuthClient = mongoose.models.OAuthClient ??
  mongoose.model("OAuthClient", oauthClientSchema);

export default OAuthClient;
export { oauthClientSchema };
