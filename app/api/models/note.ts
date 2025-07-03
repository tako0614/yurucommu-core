import mongoose from "mongoose";

const noteSchema = new mongoose.Schema({
  attributedTo: { type: String, required: true },
  content: { type: String, required: true },
  to: { type: [String], default: [] },
  cc: { type: [String], default: [] },
  published: { type: Date, default: Date.now },
});

const Note = mongoose.model("Note", noteSchema);

export default Note;
export { noteSchema };
