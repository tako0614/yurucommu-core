import mongoose from "mongoose";
import { noteSchema } from "../../../takos/models/takos/note.ts";
import tenantScope from "../plugins/tenant_scope.ts";

// テナントスコープを付与して正規モデル名で登録
noteSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const Note = mongoose.models.Note ??
  mongoose.model("Note", noteSchema, "notes");

export default Note;
export { noteSchema };

