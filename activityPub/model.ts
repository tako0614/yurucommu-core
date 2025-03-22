import mongoose, { Schema } from "mongoose";
export const MessageModel = mongoose.model(
    "Note",
    new mongoose.Schema({
        id: {
            type: String,
            required: true,
            unique: true,
        },
        username: {
            type: String,
            required: true,
        },
        body: {
            type: String,
            required: true,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        actor: {
            type: String,
            required: false,
        },
        originalId: {
            type: String,
            required: false,
        },
        isRemote: {
            type: Boolean,
            default: false,
        },
        url: {
            type: String,
            required: false,
        },
        attachment: {
            type: [{}],
            required: false,
        },
    }),
);

const StorySchema = new Schema({
    id: {
        type: String,
        required: true,
        unique: true,
    },
    username: {
        type: String,
        required: true,
    },
    mediaType: {
        type: String,
        required: true,
    },
    mediaUrl: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    expiresAt: {
        type: Date,
        required: true,
    },
    actor: {
        type: String,
        required: true,
    },
    originalId: {
        type: String,
        required: true,
    },
    isRemote: {
        type: Boolean,
        required: true,
    },
    url: {
        type: String,
        required: true,
    },
    viewers: {
        type: [String],
        default: [],
    },
});

export const StoryModel = mongoose.model("Story", StorySchema);

const LikeSchema = new Schema({
    id: {
        type: String,
        required: true,
        unique: true,
    },
    username: {
        type: String,
        required: true,
    },
    targetId: {
        type: String,
        required: true,
    },
    actor: {
        type: String,
        required: true,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    isRemote: {
        type: Boolean,
        default: false,
    },
});

export const LikeModel = mongoose.model("Like", LikeSchema);
