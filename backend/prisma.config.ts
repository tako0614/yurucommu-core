import "dotenv/config";
import { defineConfig } from "prisma/config";

const defaultDevDbUrl = "file:./prisma/dev.db";

export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? defaultDevDbUrl,
  },
});
