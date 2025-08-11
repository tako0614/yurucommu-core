import mongoose from "mongoose";
import { keyPackageSchema } from "../takos/key_package.ts";

const HostKeyPackage = mongoose.models.HostKeyPackage ??
  mongoose.model("HostKeyPackage", keyPackageSchema, "keypackages");

export default HostKeyPackage;
export { keyPackageSchema };
