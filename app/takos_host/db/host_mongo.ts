// Deprecated: takos_host is now D1/Prisma-only.
export class HostMongoDB {
  constructor(_env: Record<string, string>) {
    throw new Error("host_mongo.ts is deprecated. takos_host uses Prisma (D1/libsql) only.");
  }
}
