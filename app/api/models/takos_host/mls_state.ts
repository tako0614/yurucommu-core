import mongoose from "mongoose";
import { mlsStateSchema } from "../takos/mls_state.ts";

const HostMLSState = mongoose.models.HostMLSState ??
  mongoose.model("HostMLSState", mlsStateSchema, "mlsstates");

export default HostMLSState;
export { mlsStateSchema };
