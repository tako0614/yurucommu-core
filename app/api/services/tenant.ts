import Tenant from "../models/takos_host/tenant.ts";

export async function ensureTenant(id: string, domain: string) {
  const exists = await Tenant.findById(id).lean();
  if (!exists) {
    const t = new Tenant({ _id: id, domain });
    await t.save();
  }
}
