// Apply one migration file directly and record nothing else. Usage: node scripts/apply-sql.js drizzle/migrations/0012_data_import.sql
require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');
(async () => {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node scripts/apply-sql.js <file.sql>'); process.exit(1); }
  const sql = fs.readFileSync(file, 'utf8').replace(/--> statement-breakpoint/g, '');
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try { await c.query('BEGIN'); await c.query(sql); await c.query('COMMIT'); console.log('applied:', file); }
  catch (e) { await c.query('ROLLBACK'); console.error('failed, rolled back:', e.message); process.exitCode = 1; }
  finally { await c.end(); }
})();
