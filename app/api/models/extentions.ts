import mongoose from "mongoose";
const extentionShema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
  },
  version: {
    type: String,
    required: true,
  },
  serverjs: {
    type: String,
    required: true,
  },
  clienthtml: {
    type: String,
    required: true,
  },
  manifest: {
    type: Object,
    required: true,
  },
});

export const Extention = mongoose.model("Extention", extentionShema);
