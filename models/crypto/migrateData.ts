import mongoose from "mongoose";

const migrateDataSchema = new mongoose.Schema({
    migrateid: {
        type: String,
        required: true,
        unique: true,
    },
    migrateKey: {
        type: String,
        required: true,
    },
    migrateSignKey: {
        type: String,
    },
    migrateData: {
        type: String,
    },
    sign: {
        type: String,
    },
    timestamp: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
    requesterSessionid: {
        type: String,
        required: true,
    },
    accepterSessionid: {
        type: String,
    },
    accept: {
        type: Boolean,
        default: false,
    },
    sended: {
        type: Boolean,
        default: false,
    },
});

const MigrateData = mongoose.model("migrateData", migrateDataSchema);

export default MigrateData;
