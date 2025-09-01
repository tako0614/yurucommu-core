// Deprecated: takos_host is now D1/Prisma-only.
export function connectDatabase() {
  throw new Error("mongo_conn.ts is deprecated in takos_host. Use Prisma (D1/libsql). ");
}
