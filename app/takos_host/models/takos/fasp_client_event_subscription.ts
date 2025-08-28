import mongoose from "mongoose";
import { faspClientEventSubscriptionSchema } from "../../../takos/models/takos/fasp_client_event_subscription.ts";
import tenantScope from "../plugins/tenant_scope.ts";

faspClientEventSubscriptionSchema.plugin(tenantScope, { envKey: "ACTIVITYPUB_DOMAIN" });

const HostFaspClientEventSubscription = mongoose.models.HostFaspClientEventSubscription ??
  mongoose.model("HostFaspClientEventSubscription", faspClientEventSubscriptionSchema);

export default HostFaspClientEventSubscription;
export { faspClientEventSubscriptionSchema };