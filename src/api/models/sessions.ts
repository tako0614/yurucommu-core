import mongoose, { Document, Schema } from "mongoose";

export interface ISession extends Document {
  token: string;
  userId?: string;
  expiresAt: Date;
  createdAt: Date;
}

const sessionSchema: Schema = new Schema({
  token: { type: String, required: true, unique: true },
  userId: { type: String },
  expiresAt: { type: Date, required: true, index: { expires: "1h" } }, // 1時間後に自動削除
  createdAt: { type: Date, default: Date.now },
});

export const Session = mongoose.model<ISession>("Session", sessionSchema);
