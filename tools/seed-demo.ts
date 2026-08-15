#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { config as loadDotenv } from "dotenv";
import postgres from "postgres";

import { hashPassword } from "../packages/api/src/lib/auth";
import {
  DEMO_AGENT_PROFILE_NAME,
  DEMO_HUMAN_PROFILE_NAME,
  DEMO_INSPIRATIONS,
  DEMO_SEED_MARKER,
  DEMO_SIGNALS,
  DEMO_TOP_OF_MIND_ENTRIES,
  getDemoSeedSummary,
} from "./demo-seed-data";

interface Args {
  databaseUrl: string;
  accountId?: string;
  email?: string;
  password?: string;
  name: string;
  replace: boolean;
  createAccount: boolean;
  allowRemote: boolean;
  cleanupDemoData: boolean;
}

export interface DemoCleanupSummary {
  deletedDemoInspirations: number;
  deletedDemoSignals: number;
  preservedMixedSignals: number;
  deletedDemoTopOfMinds: number;
  deletedDemoAgentProfiles: number;
}

type SeedSql = postgres.Sql | postgres.TransactionSql;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 200;

function normalizeDatabaseHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)]$/, "$1");
}

function isLocalDatabaseHost(hostname: string): boolean {
  const host = normalizeDatabaseHost(hostname);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
  return localHosts.has(host) || host.endsWith(".local");
}

export function loadDemoSeedEnv(cwd = process.cwd()): void {
  if (process.env.DB_CONNECTION_URL) return;

  loadDotenv({ path: join(cwd, ".env"), override: false });
  if (process.env.DB_CONNECTION_URL) return;

  loadDotenv({ path: join(cwd, ".env.development"), override: false });
}

export function readArg(name: string, argv = process.argv.slice(2)): string | undefined {
  const prefix = `${name}=`;
  const hit = argv.find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

export function hasFlag(name: string, argv = process.argv.slice(2)): boolean {
  return argv.includes(name);
}

function usage(): never {
  console.error(`Seed WAKA demo data into a local/dev database.

Usage:
  pnpm demo:seed -- --email=demo@example.test
  pnpm demo:seed -- --email=demo@example.test --create-user --password=<password> [--name="Demo User"]
  pnpm demo:seed -- --account-id=<uuid>
  pnpm demo:seed -- --email=demo@example.test --cleanup-demo-data

Options:
  --database-url=<url>  Defaults to DB_CONNECTION_URL or DATABASE_URL from the environment, .env, or .env.development.
  --account-id=<uuid>   Existing account id to seed for. Also accepted as --user-id.
  --email=<email>       Existing account email to seed for. Fails if missing unless --create-user is passed.
  --create-user         Create the --email account if missing. Requires --password so it can be signed into.
  --password=<password> Hashed with the API auth helper when --create-user inserts an account.
  --name=<name>         Name for the human profile when --email creates an account. Default: ${DEMO_HUMAN_PROFILE_NAME}.
  --append-demo-data    Append another demo dataset instead of replacing this script's prior demo rows.
  --cleanup-demo-data   Remove this script's prior demo rows for an existing account without creating it or reseeding.
  --allow-remote        Permit a non-local database URL. Prefer local/dev DBs only.

No secrets are logged. The script only writes profile-scoped rows for the selected account.`);
  process.exit(1);
}

export function parseArgs(argv = process.argv.slice(2)): Args {
  loadDemoSeedEnv();

  const databaseUrl =
    readArg("--database-url", argv) ?? process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) usage();

  /* The id an account is selected by. `--user-id` names the same value, and
     is read so a command that has been in someone's shell history for months
     still selects the right row. */
  const accountId = readArg("--account-id", argv) ?? readArg("--user-id", argv);
  const email = readArg("--email", argv);
  if (!accountId && !email) usage();

  const password = readArg("--password", argv);
  const createAccount = hasFlag("--create-user", argv);
  const cleanupDemoData = hasFlag("--cleanup-demo-data", argv);
  const appendDemoData = hasFlag("--append-demo-data", argv);
  if (cleanupDemoData && createAccount) {
    throw new Error("--cleanup-demo-data cannot be combined with --create-user; cleanup only works for existing accounts.");
  }
  if (cleanupDemoData && password) {
    throw new Error("--cleanup-demo-data cannot be combined with --password; cleanup never creates or updates accounts.");
  }
  if (cleanupDemoData && appendDemoData) {
    throw new Error("--cleanup-demo-data cannot be combined with --append-demo-data.");
  }
  if (createAccount && !email) {
    throw new Error("--create-user requires --email.");
  }
  if (createAccount && !password) {
    throw new Error("--create-user requires --password so the demo account can be signed into.");
  }
  if (password && (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH)) {
    throw new Error(
      `--password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters, matching the normal signup policy.`,
    );
  }

  return {
    databaseUrl,
    accountId,
    email,
    password,
    name: readArg("--name", argv) ?? DEMO_HUMAN_PROFILE_NAME,
    replace: !appendDemoData,
    createAccount,
    allowRemote: hasFlag("--allow-remote", argv),
    cleanupDemoData,
  };
}

export function assertLocalDatabase(databaseUrl: string, allowRemote: boolean): void {
  if (allowRemote) return;
  const parsed = new URL(databaseUrl);
  const host = normalizeDatabaseHost(parsed.hostname);
  if (isLocalDatabaseHost(host)) return;
  throw new Error(
    `Refusing to seed non-local database host "${host}". Use --allow-remote only for an explicit disposable dev database; cleanup uses the same guard.`,
  );
}

export async function resolveDemoAccount(
  sql: SeedSql,
  input: Pick<Args, "accountId" | "email" | "name" | "password" | "createAccount">,
): Promise<{ id: string; email: string }> {
  if (input.accountId) {
    const rows = await sql<{ id: string; email: string }[]>`
      select id, email from accounts where id = ${input.accountId} limit 1
    `;
    if (rows.length === 0) {
      throw new Error(`No account exists for --account-id=${input.accountId}`);
    }
    return rows[0]!;
  }

  const email = input.email!.trim().toLowerCase();
  const existing = await sql<{ id: string; email: string }[]>`
    select id, email from accounts where lower(email) = ${email} limit 1
  `;
  if (existing.length > 0) return existing[0]!;

  if (!input.createAccount) {
    throw new Error(
      `No account exists for --email=${email}. Sign up first or pass --create-user --password=<password>.`,
    );
  }

  const id = randomUUID();
  const passwordHash = await hashPassword(input.password!);
  const inserted = await sql<{ id: string; email: string }[]>`
    insert into accounts (id, email, password_hash, onboarding_completed_at, created_at, updated_at)
    values (${id}, ${email}, ${passwordHash}, now(), now(), now())
    returning id, email
  `;
  return inserted[0]!;
}

/**
 * The account's human profile, created if the account has none.
 *
 * An account has exactly one, enforced by a partial unique index, so this
 * selects before inserting rather than upserting on a key that would need to
 * name the enum value in the conflict target.
 */
export async function ensureHumanProfile(
  sql: SeedSql,
  accountId: string,
  name: string,
): Promise<string> {
  const existing = await sql<{ id: string }[]>`
    select id from profiles where account_id = ${accountId} and type = 'human' limit 1
  `;
  if (existing.length > 0) return existing[0]!.id;

  const id = randomUUID();
  await sql`
    insert into profiles (id, account_id, type, name, created_at, updated_at)
    values (${id}, ${accountId}, 'human'::profile_type, ${name}, now(), now())
  `;
  return id;
}

/**
 * The demo agent profile — an agent using WAKA as its own memory.
 *
 * Selected by name because that name is this script's, which is also what
 * makes it safe for cleanup to remove the whole profile: nothing a person
 * created is inside it.
 */
export async function ensureDemoAgentProfile(
  sql: SeedSql,
  accountId: string,
): Promise<string> {
  const existing = await sql<{ id: string }[]>`
    select id from profiles
    where account_id = ${accountId} and type = 'agent' and name = ${DEMO_AGENT_PROFILE_NAME}
    limit 1
  `;
  if (existing.length > 0) return existing[0]!.id;

  const id = randomUUID();
  await sql`
    insert into profiles (id, account_id, type, name, created_at, updated_at)
    values (${id}, ${accountId}, 'agent'::profile_type, ${DEMO_AGENT_PROFILE_NAME}, now(), now())
  `;
  return id;
}

function markedText(text: string): string {
  return `${DEMO_SEED_MARKER}\n${text}`;
}

/**
 * Remove what this script wrote, and only that.
 *
 * Demo rows are identified structurally rather than by a tag column:
 *   - an inspiration is this script's if its text carries the marker,
 *   - a signal is this script's if EVERY capture behind it is one of those —
 *     a signal that also rests on something the person captured is left alone
 *     and counted as preserved,
 *   - an artifact is this script's if every entry in it cites only those
 *     signals,
 *   - the demo agent profile is this script's outright, so deleting it takes
 *     its whole stack with it.
 */
export async function replacePriorDemoRows(
  sql: SeedSql,
  accountId: string,
): Promise<DemoCleanupSummary> {
  const marker = `${DEMO_SEED_MARKER}%`;

  const topOfMindRows = await sql<Array<{ deleted_demo_top_of_minds: string | number }>>`
    with account_profiles as (
      select id from profiles where account_id = ${accountId}
    ), demo_inspirations as (
      select id from inspirations
      where profile_id in (select id from account_profiles)
        and text like ${marker}
    ), demo_signals as (
      select s.id
      from signals s
      where s.profile_id in (select id from account_profiles)
        and exists (select 1 from signal_evidence e where e.signal_id = s.id)
        and not exists (
          select 1 from signal_evidence e
          where e.signal_id = s.id
            and e.inspiration_id not in (select id from demo_inspirations)
        )
    ), demo_top_of_minds as (
      select t.id
      from top_of_minds t
      where t.profile_id in (select id from account_profiles)
        and exists (select 1 from top_of_mind_entries en where en.top_of_mind_id = t.id)
        and not exists (
          select 1
          from top_of_mind_entries en
          left join top_of_mind_entry_signals es on es.entry_id = en.id
          where en.top_of_mind_id = t.id
            and (es.signal_id is null or es.signal_id not in (select id from demo_signals))
        )
    ), deleted as (
      delete from top_of_minds where id in (select id from demo_top_of_minds) returning id
    )
    select count(*) as deleted_demo_top_of_minds from deleted
  `;

  const signalRows = await sql<Array<{
    deleted_demo_signals: string | number;
    preserved_mixed_signals: string | number;
  }>>`
    with account_profiles as (
      select id from profiles where account_id = ${accountId}
    ), demo_inspirations as (
      select id from inspirations
      where profile_id in (select id from account_profiles)
        and text like ${marker}
    ), linked_signals as (
      select distinct e.signal_id as id
      from signal_evidence e
      where e.inspiration_id in (select id from demo_inspirations)
    ), demo_only_signals as (
      select l.id from linked_signals l
      where not exists (
        select 1 from signal_evidence e
        where e.signal_id = l.id
          and e.inspiration_id not in (select id from demo_inspirations)
      )
    ), mixed_signals as (
      select l.id from linked_signals l
      where exists (
        select 1 from signal_evidence e
        where e.signal_id = l.id
          and e.inspiration_id not in (select id from demo_inspirations)
      )
    ), deleted as (
      delete from signals where id in (select id from demo_only_signals) returning id
    )
    select
      (select count(*) from deleted) as deleted_demo_signals,
      (select count(*) from mixed_signals) as preserved_mixed_signals
  `;

  const inspirationRows = await sql<Array<{ deleted_demo_inspirations: string | number }>>`
    with account_profiles as (
      select id from profiles where account_id = ${accountId}
    ), deleted as (
      delete from inspirations
      where profile_id in (select id from account_profiles)
        and text like ${marker}
      returning id
    )
    select count(*) as deleted_demo_inspirations from deleted
  `;

  const profileRows = await sql<Array<{ deleted_demo_agent_profiles: string | number }>>`
    with deleted as (
      delete from profiles
      where account_id = ${accountId}
        and type = 'agent'
        and name = ${DEMO_AGENT_PROFILE_NAME}
      returning id
    )
    select count(*) as deleted_demo_agent_profiles from deleted
  `;

  const toNumber = (value: string | number | undefined): number => Number(value ?? 0);
  return {
    deletedDemoInspirations: toNumber(inspirationRows[0]?.deleted_demo_inspirations),
    deletedDemoSignals: toNumber(signalRows[0]?.deleted_demo_signals),
    preservedMixedSignals: toNumber(signalRows[0]?.preserved_mixed_signals),
    deletedDemoTopOfMinds: toNumber(topOfMindRows[0]?.deleted_demo_top_of_minds),
    deletedDemoAgentProfiles: toNumber(profileRows[0]?.deleted_demo_agent_profiles),
  };
}

export async function seedDemoRows(
  sql: SeedSql,
  profiles: { human: string; agent: string },
): Promise<void> {
  const inspirationIds = new Map<string, string>();
  const inspirationProfiles = new Map<string, string>();
  const inspirationTimes = new Map<string, Date>();
  const signalIds = new Map<string, string>();
  const now = Date.now();

  for (const [index, seed] of DEMO_INSPIRATIONS.entries()) {
    const id = randomUUID();
    const profileId = seed.source === "agent" ? profiles.agent : profiles.human;
    const capturedAt = new Date(now - (DEMO_INSPIRATIONS.length - index) * 60 * 60 * 1000);
    await sql`
      insert into inspirations (id, profile_id, text, kind, source, created_at, updated_at)
      values (
        ${id}, ${profileId}, ${markedText(seed.text)}, ${seed.kind}::inspiration_kind,
        ${seed.source}::inspiration_source, ${capturedAt}, ${capturedAt}
      )
    `;
    inspirationIds.set(seed.slug, id);
    inspirationProfiles.set(seed.slug, profileId);
    inspirationTimes.set(seed.slug, capturedAt);

    for (const reflection of seed.reflections ?? []) {
      await sql`
        insert into reflections (id, profile_id, inspiration_id, question, answer, skipped, created_at)
        values (
          ${randomUUID()}, ${profileId}, ${id}, ${reflection.question},
          ${reflection.answer ?? null}, ${reflection.skipped === true}, ${capturedAt}
        )
      `;
    }
  }

  for (const seed of DEMO_SIGNALS) {
    const id = randomUUID();
    const profileId = seed.profile === "agent" ? profiles.agent : profiles.human;
    const evidenceTimes = seed.evidence.map((evidence) => {
      const at = inspirationTimes.get(evidence.inspirationSlug);
      if (!at) {
        throw new Error(`Demo signal ${seed.slug} cites unknown inspiration ${evidence.inspirationSlug}`);
      }
      return at;
    });
    const lastEvidenceAt = evidenceTimes.reduce((latest, at) => (at > latest ? at : latest));
    const createdAt = evidenceTimes.reduce((earliest, at) => (at < earliest ? at : earliest));

    await sql`
      insert into signals (
        id, profile_id, statement, status, confidence, last_evidence_at, created_at, updated_at
      ) values (
        ${id}, ${profileId}, ${seed.statement}, ${seed.status}::signal_status,
        ${seed.confidence}, ${lastEvidenceAt}, ${createdAt}, ${lastEvidenceAt}
      )
    `;
    signalIds.set(seed.slug, id);

    for (const evidence of seed.evidence) {
      const inspirationId = inspirationIds.get(evidence.inspirationSlug)!;
      /* Evidence never crosses a profile: a signal cites the captures of the
         memory that owns it, and nothing else. */
      if (inspirationProfiles.get(evidence.inspirationSlug) !== profileId) {
        throw new Error(
          `Demo signal ${seed.slug} cites ${evidence.inspirationSlug}, which belongs to a different profile`,
        );
      }
      await sql`
        insert into signal_evidence (id, profile_id, signal_id, inspiration_id, reason, quote, created_at)
        values (
          ${randomUUID()}, ${profileId}, ${id}, ${inspirationId}, ${evidence.reason},
          ${evidence.quote ?? null}, ${inspirationTimes.get(evidence.inspirationSlug)!}
        )
      `;
    }
  }

  /* Exactly one live artifact per profile, enforced by a partial unique index.
     Anything already standing is superseded rather than deleted, because the
     version history is the artifact's identity over time. */
  const live = await sql<Array<{ id: string; version: number }>>`
    select id, version from top_of_minds
    where profile_id = ${profiles.human} and status = 'live'
    limit 1
  `;
  const previous = live[0];
  const nextVersion = (previous?.version ?? 0) + 1;
  const topOfMindId = randomUUID();
  const createdAt = new Date(now);

  await sql`
    insert into top_of_minds (id, profile_id, version, status, reason, created_at)
    values (
      ${topOfMindId}, ${profiles.human}, ${nextVersion}, 'live'::top_of_mind_status,
      ${previous ? "regenerated" : "initial"}::top_of_mind_revision_reason, ${createdAt}
    )
  `;
  if (previous) {
    await sql`
      update top_of_minds
      set status = 'superseded'::top_of_mind_status,
          replaced_by_id = ${topOfMindId},
          replaced_at = ${createdAt}
      where id = ${previous.id}
    `;
  }

  for (const [index, entry] of DEMO_TOP_OF_MIND_ENTRIES.entries()) {
    const entryId = randomUUID();
    await sql`
      insert into top_of_mind_entries (
        id, top_of_mind_id, type, body, belief, prompt, pinned_at, sort_order, created_at, updated_at
      ) values (
        ${entryId}, ${topOfMindId}, ${entry.type}::top_of_mind_entry_type, ${entry.body},
        ${entry.belief ?? null}, ${entry.prompt ?? null},
        ${entry.pinned ? createdAt : null}, ${index}, ${createdAt}, ${createdAt}
      )
    `;

    for (const slug of entry.citedSignalSlugs) {
      const signalId = signalIds.get(slug);
      if (!signalId) {
        throw new Error(`Demo top-of-mind entry cites unknown signal ${slug}`);
      }
      await sql`
        insert into top_of_mind_entry_signals (id, entry_id, signal_id, owner_profile_id, created_at)
        values (${randomUUID()}, ${entryId}, ${signalId}, ${profiles.human}, ${createdAt})
      `;
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs();
  assertLocalDatabase(args.databaseUrl, args.allowRemote);

  const parsed = new URL(args.databaseUrl);
  const sql = postgres(args.databaseUrl, {
    max: 1,
    prepare: false,
    ssl: isLocalDatabaseHost(parsed.hostname) ? false : "require",
  });

  try {
    const result = await sql.begin(async (tx) => {
      const account = await resolveDemoAccount(tx, args);
      if (args.cleanupDemoData) {
        const cleanup = await replacePriorDemoRows(tx, account.id);
        return { account, cleanup };
      }
      if (args.replace) await replacePriorDemoRows(tx, account.id);
      const human = await ensureHumanProfile(tx, account.id, args.name);
      const agent = await ensureDemoAgentProfile(tx, account.id);
      await seedDemoRows(tx, { human, agent });
      return { account, cleanup: null };
    });

    if (result.cleanup) {
      console.log(
        `Removed WAKA demo data for ${result.account.email}: ` +
          `${result.cleanup.deletedDemoInspirations} inspirations, ` +
          `${result.cleanup.deletedDemoSignals} signals, ` +
          `${result.cleanup.deletedDemoTopOfMinds} top-of-mind versions and ` +
          `${result.cleanup.deletedDemoAgentProfiles} agent profiles removed. ` +
          `${result.cleanup.preservedMixedSignals} signals resting on real captures were preserved, ` +
          `along with the account and everything captured in it.`,
      );
      return;
    }

    const summary = getDemoSeedSummary();
    console.log(
      `Seeded WAKA demo data for ${result.account.email}: ` +
        `${summary.inspirationCount} inspirations (${summary.agentSourcedCount} from an agent), ` +
        `${summary.signalCount} signals over ${summary.evidenceCount} evidence links, ` +
        `and one top of mind with ${summary.entryCount} entries.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
