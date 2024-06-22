import mongoose from "mongoose"

export const serverInfoSchema = new mongoose.Schema({
    serverDomain: {
        type: String,
        required: true,
    },
    users: {
        type: Number,
    },
    remoteServers: {
        type: Number,
    },
    lastUpdate: {
        type: Date,
        default: Date.now,
    },
})
const ssessionID = mongoose.model("serverInfo", serverInfoSchema)
export default ssessionID
