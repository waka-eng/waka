/** One guarded physical transaction around Drizzle's existing migration path.
 * No CLI/connection creation or side effects on import. Caller owns target
 * authorization, private backup and the explicitly supplied connection. */
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const require=createRequire(new URL('../../packages/api/package.json',import.meta.url));
const {drizzle}=require('drizzle-orm/postgres-js');
const {readMigrationFiles}=require('drizzle-orm/migrator');
const {sql}=require('drizzle-orm');

export async function runGuardedMigrations(client,expected) {
  const config={migrationsFolder:expected.migrationsFolder??fileURLToPath(new URL('../../drizzle/migrations',import.meta.url))};
  const files=readMigrationFiles(config);
  const migrationFilesFingerprint=createHash('sha256').update(files.map(f=>f.hash).join(':')).digest('hex');
  if(expected.migrationFilesFingerprint!==migrationFilesFingerprint)throw Error('Migration files changed since reviewed rehearsal');
  const orm=drizzle(client);
  return orm.transaction(async tx=>{
    // This is the transaction/session that will execute EVERY migration DDL,
    // including Drizzle's CREATE SCHEMA/TABLE IF NOT EXISTS and ledger reads.
    const [session]=await tx.execute(sql`SELECT current_database() AS database,pg_backend_pid() AS pid,
      current_setting('neon.timeline_id',true) AS timeline,current_setting('lock_timeout') AS lock_timeout,
      current_setting('statement_timeout') AS statement_timeout`);
    const fingerprint=session.timeline?createHash('sha256').update(session.timeline).digest('hex').slice(0,16):null;
    if(session.database!==expected.database||fingerprint!==(expected.timelineFingerprint??null)
      ||session.lock_timeout!=='5s'||session.statement_timeout!=='2min')throw Error('Migration session identity/timeout guard refused');
    await tx.execute(sql`LOCK TABLE drizzle.__drizzle_migrations IN EXCLUSIVE MODE NOWAIT`);
    const [before]=await tx.execute(sql`SELECT count(*)::int AS rows,max(created_at)::text AS last FROM drizzle.__drizzle_migrations`);
    if(before.rows!==expected.ledgerRows||before.last!==String(expected.lastTimestamp))throw Error('Migration ledger changed since rehearsal');
    // Reuse Drizzle's own SQL/file hashes/order/ledger behavior. Its nested
    // transaction is a real savepoint of this exact guarded physical session,
    // rather than a second connection or a reimplemented migration loop.
    const guardedSession=Object.create(tx.session);
    guardedSession.transaction=callback=>tx.transaction(callback);
    await orm.dialect.migrate(files,guardedSession,config);
    const [after]=await tx.execute(sql`SELECT count(*)::int AS rows,max(created_at)::text AS last FROM drizzle.__drizzle_migrations`);
    const [physical]=await tx.execute(sql`SELECT pg_backend_pid() AS pid,current_setting('lock_timeout') AS lock_timeout,
      current_setting('statement_timeout') AS statement_timeout`);
    if(physical.pid!==session.pid||physical.lock_timeout!=='5s'||physical.statement_timeout!=='2min'
      ||after.rows!==expected.resultRows||after.last!==String(files.at(-1).folderMillis))throw Error('Migration settlement verification refused');
    return {before,after,physicalSessionUnchanged:true,effectiveTimeouts:{lock:physical.lock_timeout,statement:physical.statement_timeout},
      timelineFingerprint:fingerprint,migrationFilesFingerprint};
  });
}
