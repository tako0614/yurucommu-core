import mongoose from "mongoose";

const faspClientBackfillSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, default: "pending" },
  createdAt: { type: Date, default: Date.now },
  continuedAt: { type: Date, default: null },
}, { collection: "fasp_client_backfills" });

const FaspClientBackfill = mongoose.models.FaspClientBackfill ??
  mongoose.model("FaspClientBackfill", faspClientBackfillSchema);

export default FaspClientBackfill;
export { faspClientBackfillSchema };
