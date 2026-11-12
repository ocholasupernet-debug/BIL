// Explicit operation for an owner-authorized EXTERNAL, dedicated VPS database.
// Never run at startup, from PM2, or against Replit's managed production DB.
import pg from 'pg';
import { readFile } from 'node:fs/promises';
if(process.argv[2]!=='--confirm-corporate-only')throw new Error('Confirm the NEW corporate-only database with --confirm-corporate-only');
if(!process.env.ISPLATTY_ORG_DATABASE_URL)throw new Error('A dedicated ISPLATTY_ORG_DATABASE_URL is required');
const pool=new pg.Pool({connectionString:process.env.ISPLATTY_ORG_DATABASE_URL});
try{
  const client=await pool.connect();
  try{
    // Reject any existing user table not owned by this application.
    const tables=await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'isplatty_org_%'");
    if(tables.rowCount)throw new Error('Refusing migration: the database contains non-corporate tables. Do not use BIL or a shared database.');
    await client.query('BEGIN');
    await client.query(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
    await client.query(await readFile(new URL('./admin-schema.sql',import.meta.url),'utf8'));
    await client.query('COMMIT');
    process.stdout.write('Corporate-only additive migrations applied.\n');
  }catch(err){await client.query('ROLLBACK');throw err;}
  finally{client.release();}
}finally{await pool.end();}
