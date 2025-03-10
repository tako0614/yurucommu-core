import mongoose from "mongoose";

const serverKeySchema = new mongoose.Schema({
  public: {
    type: String,
    required: true,
  },
  expire: {
    type: Date,
    default: Date.now() + 1000 * 60 * 60 * 24 * 30,
    required: true,
  },
  domain: {
    type: String,
    required: true,
  },
});

const serverKey = mongoose.model("remoteServerKey", serverKeySchema);

export default serverKey;
