import mongoose from "mongoose";
import { noteSchema } from "../../../takos/models/takos/note.ts";
import tenantScope from "../plugins/tenant_scope.ts";

noteSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const HostNote = mongoose.models.HostNote ??
  mongoose.model("HostNote", noteSchema, "notes");

export default HostNote;
export { noteSchema };
