import pg from "pg";
const { Client } = pg;

const c = new Client({
  host: process.env.SUPABASE_DB_HOST ?? "aws-0-ap-south-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.ojclgcsgeonblracfaga",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

async function tryQuery(label, sql, params = []) {
  try {
    const r = await c.query(sql, params);
    console.log(`\n== ${label} ==`);
    console.log(JSON.stringify(r.rows, null, 2));
    return r.rows;
  } catch (e) {
    console.log(`\n== ${label} == FAILED: ${e.message}`);
    return [];
  }
}

await tryQuery("auth.config", "select * from auth.config");
await tryQuery("auth schema tables", `select table_name from information_schema.tables where table_schema='auth' order by 1 limit 40`);
await tryQuery("jwt current roles", `select current_user, session_user`);

await c.end();