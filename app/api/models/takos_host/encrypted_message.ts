import mongoose from "mongoose";
import { encryptedMessageSchema } from "../takos/encrypted_message.ts";

const HostEncryptedMessage = mongoose.models.HostEncryptedMessage ??
  mongoose.model(
    "HostEncryptedMessage",
    encryptedMessageSchema,
    "encryptedmessages",
  );

export default HostEncryptedMessage;
export { encryptedMessageSchema };
