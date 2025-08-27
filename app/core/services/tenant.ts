import type { DB } from "@takos/db";

export async function ensureTenant(
  db: DB,
  id: string,
  domain: string,
) {
  await db.ensureTenant(id, domain);
}
