/// <reference types="@cloudflare/workers-types" />

// Prisma migrations now manage the schema; we only enable runtime pragmas here.
const FK_PRAGMA = "PRAGMA foreign_keys = ON";

let fkInit: Promise<void> | null = null;

export async function ensureDatabase(db: D1Database) {
  if (!fkInit) {
    fkInit = (async () => {
      await db.prepare(FK_PRAGMA).run();
    })();
  }

  try {
    await fkInit;
  } catch (err) {
    fkInit = null;
    throw err;
  }
}
