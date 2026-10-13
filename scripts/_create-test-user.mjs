import pg from "pg";
const { Client } = pg;

const URL = process.env.SUPABASE_URL ?? "https://ojclgcsgeonblracfaga.supabase.co";
const ANON = process.env.SUPABASE_ANON_KEY;
const EMAIL = process.env.TEST_EMAIL;
const PASSWORD = process.env.TEST_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("Set TEST_EMAIL and TEST_PASSWORD env vars.");
  process.exit(1);
}

const client = new Client({
  host: process.env.SUPABASE_DB_HOST ?? "aws-0-ap-south-1.pooler.supabase.com",
  port: Number(process.env.SUPABASE_DB_PORT ?? 5432),
  user: process.env.SUPABASE_DB_USER ?? "postgres.ojclgcsgeonblracfaga",
  password: process.env.SUPABASE_DB_PASSWORD,
  database: process.env.SUPABASE_DB_NAME ?? "postgres",
  ssl: { rejectUnauthorized: false },
});
await client.connect();

await client.query("begin");
await client.query("delete from auth.users where email = $1", [EMAIL]);
const { rows } = await client.query(
  `insert into auth.users
     (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
   values
     ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
      'authenticated', 'authenticated', $1, crypt($2, gen_salt('bf')),
      now(), '', '', '', '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'Test Owner'),
      now(), now())
   returning id`,
  [EMAIL, PASSWORD],
);
const userId = rows[0].id;

await client.query(
  `insert into auth.identities
     (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
   values
     ($1::text, $2::uuid, jsonb_build_object('sub', $2::text, 'email', $1::text, 'email_verified', true),
      'email', now(), now(), now())`,
  [EMAIL, userId],
);
await client.query("commit");
console.log("created user", userId, EMAIL);

// Validate login through GoTrue exactly like the app does.
const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const json = await res.json();
console.log("TOKEN status", res.status, "access_token?", Boolean(json.access_token), "err:", json.error_description ?? json.msg ?? "");
await client.end();
