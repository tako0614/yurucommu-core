import mongoose from "mongoose";
import { noteSchema } from "../takos/note.ts";

const HostNote = mongoose.models.HostNote ??
  mongoose.model("HostNote", noteSchema, "notes");

export default HostNote;
export { noteSchema };
