/**
 * Inspect the embedded PostgreSQL data directory directly.
 *
 *   node scripts/inspect-db.mjs [dataDir]
 *
 * Prints every user table with its row count, so a persistence question is
 * answered by the database instead of by guessing from HTTP responses.
 */

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'runtime', 'pgdata');

const { PGlite } = await import('@electric-sql/pglite');
const db = await PGlite.create({ dataDir });

const tables = await db.query(`
  select schemaname, tablename
  from pg_tables
  where schemaname not in ('pg_catalog', 'information_schema')
  order by schemaname, tablename
`);
console.log(`tables in ${dataDir}: ${tables.rows.length}`);
for (const row of tables.rows) {
  const qualified = `"${row.schemaname}"."${row.tablename}"`;
  const count = await db
    .query(`select count(*)::int as n from ${qualified}`)
    .then((r) => r.rows[0].n, (e) => `err ${e.message}`);
  console.log(`  ${row.schemaname}.${row.tablename}: ${count}`);
}

for (const candidate of ['documents', 'document_folders', 'folders']) {
  try {
    const rows = await db.query(`select * from "${candidate}" limit 5`);
    console.log(`sample ${candidate}:`, JSON.stringify(rows.rows).slice(0, 600));
  } catch {}
}

await db.close();
