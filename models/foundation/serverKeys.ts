import mongoose from "mongoose";

const serverKeySchema = new mongoose.Schema({
  public: {
    type: String,
    required: true,
  },
  private: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now(),
    required: true,
  },
  expire: {
    type: Date,
    default: Date.now() + 1000 * 60 * 60 * 24 * 30,
    required: true,
  },
});

const serverKey = mongoose.model("serverKey", serverKeySchema);

export default serverKey;
