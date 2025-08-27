import mongoose from "mongoose";
import { attachmentSchema } from "../takos/attachment.ts";

const HostAttachment = mongoose.models.HostAttachment ??
  mongoose.model("HostAttachment", attachmentSchema, "attachments");

export default HostAttachment;
export { attachmentSchema };
