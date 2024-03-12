import { stringToIdentifier } from "$fresh/src/server/init_safe_deps.ts";
import mongoose from "npm:mongoose@^6.7";

const csrfTokenSchama = new mongoose.Schema({
    token: {
        type: String,
        required: true,
        unique: true
    },
    timestamp: true
})
