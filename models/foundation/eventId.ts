import mongoose from "mongoose";

const eventIdSchema = new mongoose.Schema({
    eventId: {
        type: String,
        required: true,
    },
    domain: {
        type: String,
        required: true,
    },
    timestamp: {
        type: Date,
    },
});

const EventId = mongoose.model("eventId", eventIdSchema);

export default EventId;
