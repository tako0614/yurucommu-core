import mongoose from "mongoose";
import { encryptedKeyPairSchema } from "../takos/encrypted_keypair.ts";

const HostEncryptedKeyPair = mongoose.models.HostEncryptedKeyPair ??
  mongoose.model(
    "HostEncryptedKeyPair",
    encryptedKeyPairSchema,
    "encryptedkeypairs",
  );

export default HostEncryptedKeyPair;
export { encryptedKeyPairSchema };
