/**
 * Node.js Server Entry Point
 *
 * This file starts the yurucommu backend on Node.js using the compatibility layer.
 * It can also be used with Bun: `bun run src/backend/server.ts`
 *
 * Usage:
 *   npm run dev:node     # Development with hot reload
 *   npm run start:node   # Production
 *
 * Environment variables:
 *   PORT             - Server port (default: 3000)
 *   DATABASE_PATH    - SQLite database path (default: ./data/yurucommu.db)
 *   STORAGE_PATH     - File storage path (default: ./data/storage)
 *   ASSETS_PATH      - Static assets path (default: ./dist)
 *   APP_URL          - Application URL (default: http://localhost:3000)
 *   AUTH_PASSWORD    - Optional password authentication
 *   GOOGLE_CLIENT_ID/SECRET - Google OAuth
 *   X_CLIENT_ID/SECRET - X (Twitter) OAuth
 *   TAKOS_URL/CLIENT_ID/SECRET - Takos OAuth
 */

import { serve } from '@hono/node-server';
import { createNodeEnv, runMigrations, D1CompatDatabase } from './runtime/compat';
import app from './index';
import * as path from 'path';
import * as fs from 'fs';

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATABASE_PATH = process.env.DATABASE_PATH || './data/yurucommu.db';
const STORAGE_PATH = process.env.STORAGE_PATH || './data/storage';
const ASSETS_PATH = process.env.ASSETS_PATH || './dist';
const MIGRATIONS_PATH = process.env.MIGRATIONS_PATH || './migrations';
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

async function main() {
  console.log('🚀 Starting Yurucommu server (Node.js mode)...');

  // Ensure data directory exists
  const dataDir = path.dirname(DATABASE_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Create environment with Node.js adapters
  const env = await createNodeEnv({
    databasePath: DATABASE_PATH,
    storagePath: STORAGE_PATH,
    assetsPath: ASSETS_PATH,
    APP_URL,
    AUTH_PASSWORD: process.env.AUTH_PASSWORD,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    X_CLIENT_ID: process.env.X_CLIENT_ID,
    X_CLIENT_SECRET: process.env.X_CLIENT_SECRET,
    TAKOS_URL: process.env.TAKOS_URL,
    TAKOS_CLIENT_ID: process.env.TAKOS_CLIENT_ID,
    TAKOS_CLIENT_SECRET: process.env.TAKOS_CLIENT_SECRET,
  });

  // Run migrations
  if (fs.existsSync(MIGRATIONS_PATH)) {
    console.log('📦 Running database migrations...');
    const db = env.DB as unknown as D1CompatDatabase;
    await runMigrations(db, MIGRATIONS_PATH);
    console.log('✅ Migrations complete');
  } else {
    console.log('⚠️  No migrations directory found, skipping migrations');
  }

  // Start server
  console.log(`\n📡 Server starting on http://localhost:${PORT}`);
  console.log(`   APP_URL: ${APP_URL}`);
  console.log(`   Database: ${DATABASE_PATH}`);
  console.log(`   Storage: ${STORAGE_PATH}`);
  console.log(`   Assets: ${ASSETS_PATH}`);
  console.log('');

  serve({
    fetch: (request) => {
      // Inject environment into the request context
      return app.fetch(request, env);
    },
    port: PORT,
  });

  console.log(`✅ Server is running at http://localhost:${PORT}`);
}

main().catch((error) => {
  console.error('❌ Failed to start server:', error);
  process.exit(1);
});
