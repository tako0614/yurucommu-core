import mongoose from "mongoose";
import { handshakeMessageSchema } from "../takos/handshake_message.ts";

const HostHandshakeMessage = mongoose.models.HostHandshakeMessage ??
  mongoose.model(
    "HostHandshakeMessage",
    handshakeMessageSchema,
    "handshakemessages",
  );

export default HostHandshakeMessage;
export { handshakeMessageSchema };
