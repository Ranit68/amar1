import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const host = process.env.SUPABASE_DB_HOST ?? "aws-0-ap-south-1.pooler.supabase.com";
const port = Number(process.env.SUPABASE_DB_PORT ?? 5432);
const user = process.env.SUPABASE_DB_USER ?? "postgres.ojclgcsgeonblracfaga";
const password = process.env.SUPABASE_DB_PASSWORD;
const database = process.env.SUPABASE_DB_NAME ?? "postgres";
const only = process.argv[2];

if (!password) {
  console.error("Set SUPABASE_DB_PASSWORD first.");
  process.exit(1);
}

const client = new Client({ host, port, user, password, database, ssl: { rejectUnauthorized: false } });

await client.connect();

const dir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

let ran = 0;
let failed = [];
for (const file of files) {
  if (only && !file.includes(only)) continue;
  const sql = readFileSync(join(dir, file), "utf8");
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
    console.log(`OK   ${file}`);
    ran++;
  } catch (err) {
    await client.query("rollback");
    console.error(`FAIL ${file}`);
    console.error(err.message);
    failed.push(file);
  }
}

await client.end();

console.log(`\n${ran} applied, ${failed.length} failed.`);
if (failed.length) {
  console.error("Failed: " + failed.join(", "));
  process.exit(1);
}