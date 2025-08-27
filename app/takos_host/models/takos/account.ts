import mongoose from "mongoose";
import { accountSchema } from "../../../takos/models/takos/account.ts";

const HostAccount = mongoose.models.HostAccount ??
  mongoose.model("HostAccount", accountSchema, "accounts");

export default HostAccount;
export { accountSchema };
