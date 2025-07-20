export interface EncryptedKeyPairData {
  _id?: string;
  userName: string;
  content: string;
  createdAt?: Date;
}

import EncryptedKeyPair from "../models/encrypted_keypair.ts";

export async function findEncryptedKeyPair(
  userName: string,
): Promise<EncryptedKeyPairData | null> {
  return await EncryptedKeyPair.findOne({ userName }).lean<
    EncryptedKeyPairData | null
  >();
}

export async function upsertEncryptedKeyPair(
  userName: string,
  content: string,
): Promise<void> {
  await EncryptedKeyPair.findOneAndUpdate({ userName }, { content }, {
    upsert: true,
  });
}

export async function deleteEncryptedKeyPair(userName: string): Promise<void> {
  await EncryptedKeyPair.deleteOne({ userName });
}
