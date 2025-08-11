import mongoose from "mongoose";
import { videoSchema } from "../takos/video.ts";

const HostVideo = mongoose.models.HostVideo ??
  mongoose.model("HostVideo", videoSchema, "videos");

export default HostVideo;
export { videoSchema };
