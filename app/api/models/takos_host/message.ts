import mongoose from "mongoose";
import { messageSchema } from "../takos/message.ts";

const HostMessage = mongoose.models.HostMessage ??
  mongoose.model("HostMessage", messageSchema, "messages");

export default HostMessage;
export { messageSchema };
