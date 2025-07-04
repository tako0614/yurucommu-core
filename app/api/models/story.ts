import mongoose, { Schema, Document } from "mongoose";

export interface IStory extends Document {
  author: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  backgroundColor: string;
  textColor: string;
  createdAt: Date;
  expiresAt: Date;
  views: number;
}

const storySchema = new Schema<IStory>({
  author: {
    type: String,
    required: true,
  },
  content: {
    type: String,
    required: true,
    maxlength: 200,
  },
  mediaUrl: {
    type: String,
    required: false,
  },
  mediaType: {
    type: String,
    enum: ['image', 'video'],
    required: false,
  },
  backgroundColor: {
    type: String,
    default: "#1DA1F2",
  },
  textColor: {
    type: String,
    default: "#FFFFFF",
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  expiresAt: {
    type: Date,
    required: true,
  },
  views: {
    type: Number,
    default: 0,
  },
});

// TTL インデックス設定（期限切れストーリーの自動削除）
storySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Story = mongoose.model<IStory>("Story", storySchema);

export default Story;
