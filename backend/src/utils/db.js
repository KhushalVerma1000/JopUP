/**
 * Drizzle ORM Database Client
 *
 * This replaces the old in-memory mock arrays.
 * Uses node-postgres (pg) under the hood via a connection pool.
 *
 * Usage in services:
 *   const { db } = require('../../utils/db');
 *   const rows = await db.select().from(schema.plan);
 */

require('tsx/cjs');
require('dotenv').config();

const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');

// Import compiled schema — tsx/node handles the TypeScript files at runtime
// We use the schema barrel so Drizzle gets the full relational graph
const schema = require('../schema/index');

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set fill in your credentials.'
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Connection pool settings — tune based on your deployment
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// Log pool errors so they don't crash silently
pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err);
});

const db = drizzle(pool, { schema });

module.exports = { db, pool, schema };
