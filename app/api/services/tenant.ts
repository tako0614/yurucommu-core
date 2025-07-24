import type { DB } from "../../shared/db.ts";

export async function ensureTenant(
  db: DB,
  id: string,
  domain: string,
) {
  await db.ensureTenant(id, domain);
}
