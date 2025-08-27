import mongoose from "mongoose";

const faspClientEventSubscriptionSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
}, { collection: "fasp_client_event_subscriptions" });

const FaspClientEventSubscription =
  mongoose.models.FaspClientEventSubscription ??
    mongoose.model(
      "FaspClientEventSubscription",
      faspClientEventSubscriptionSchema,
    );

export default FaspClientEventSubscription;
export { faspClientEventSubscriptionSchema };
