import mongoose from "mongoose";
import tenantScope from "../plugins/tenant_scope.ts";

const faspClientEventSubscriptionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: "fasp_client_event_subscriptions" });

faspClientEventSubscriptionSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const HostFaspClientEventSubscription = mongoose.models.HostFaspClientEventSubscription ??
  mongoose.model("HostFaspClientEventSubscription", faspClientEventSubscriptionSchema);

export default HostFaspClientEventSubscription;
export { faspClientEventSubscriptionSchema };