import pg from "pg";
const { Client } = pg;

const host = process.env.SUPABASE_DB_HOST ?? "aws-0-ap-south-1.pooler.supabase.com";
const port = Number(process.env.SUPABASE_DB_PORT ?? 5432);
const user = process.env.SUPABASE_DB_USER ?? "postgres.ojclgcsgeonblracfaga";
const password = process.env.SUPABASE_DB_PASSWORD;
const database = process.env.SUPABASE_DB_NAME ?? "postgres";

if (!password) {
  console.error("Set SUPABASE_DB_PASSWORD first.");
  process.exit(1);
}

const client = new Client({ host, port, user, password, database, ssl: { rejectUnauthorized: false } });
await client.connect();

const tables = await client.query(
  "select tablename from pg_tables where schemaname = 'public' order by tablename;",
);
const funcs = await client.query(
  `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' order by proname;`,
);
const policies = await client.query(
  "select tablename, count(*) from pg_policies where schemaname = 'public' group by 1 order by 1;",
);

console.log(`TABLES (${tables.rows.length}):`);
console.log(tables.rows.map((r) => "  " + r.tablename).join("\n"));
console.log(`\nFUNCTIONS (${funcs.rows.length}):`);
console.log(funcs.rows.map((r) => "  " + r.proname).join("\n"));
console.log(`\nPOLICIES:`);
for (const p of policies.rows) console.log(`  ${p.tablename}: ${p.count}`);

await client.end();