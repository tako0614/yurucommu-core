import mongoose from "mongoose";

const objectStoreSchema = new mongoose.Schema({
  _id: {
    type: String,
    default: () => new mongoose.Types.ObjectId().toString(),
  },
  type: { type: String, index: true },
  attributedTo: { type: String, required: true },
  content: { type: String },
  to: { type: [String], default: [] },
  cc: { type: [String], default: [] },
  published: { type: Date, default: Date.now },
  extra: { type: mongoose.Schema.Types.Mixed, default: {} },
  raw: { type: mongoose.Schema.Types.Mixed },
  actor_id: { type: String, index: true },
  tenant_id: { type: String, index: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  deleted_at: { type: Date },
  aud: {
    to: { type: [String], default: [] },
    cc: { type: [String], default: [] },
  },
});

objectStoreSchema.pre("save", function (next) {
  const self = this as unknown as {
    $locals?: { env?: Record<string, string> };
  };
  const env: Record<string, string> | undefined = self.$locals?.env;
  if (!this.tenant_id && env?.ACTIVITYPUB_DOMAIN) {
    this.tenant_id = env.ACTIVITYPUB_DOMAIN;
  }
  if (!this.actor_id && typeof this.attributedTo === "string") {
    try {
      this.actor_id = new URL(this.attributedTo).href;
    } catch {
      if (env?.ACTIVITYPUB_DOMAIN) {
        this.actor_id =
          `https://${env.ACTIVITYPUB_DOMAIN}/users/${this.attributedTo}`;
      }
    }
  }
  if (!this.aud) {
    this.aud = { to: this.to ?? [], cc: this.cc ?? [] };
  }
  if (!this.raw) {
    const id = typeof this._id === "string" ? this._id : undefined;
    this.raw = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id,
      type: this.type,
      content: this.content,
      attributedTo: this.actor_id ?? this.attributedTo,
      published: this.published instanceof Date
        ? this.published.toISOString()
        : this.published,
      ...this.extra,
    };
  }
  next();
});

const HostObjectStore = mongoose.models.HostObjectStore ??
  mongoose.model("HostObjectStore", objectStoreSchema);

export default HostObjectStore;
export { objectStoreSchema };
