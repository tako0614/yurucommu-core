import { isMail } from "../util/takoFunction.ts";
import mongoose from "npm:mongoose@^6.7";
/*const tempUsersSchema = new Schema({
	author: String,
	title: String,
	body: String,
});*/
/*
const UsersSchema = new Schema({
	author: String,
	title: String,
	body: String,
});*/
const UsersSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        uniqued: true
    },
    mail: {
        type: String,
        required: true,
        unique: true,
    },
    salt: {
        type: String,
        required: true
    },
    uuid: {
        type: String,
        required: true
    },
    timestamp: true
})
