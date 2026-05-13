#!/usr/bin/env tsx
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { config as loadDotenv } from "dotenv";
import postgres from "postgres";

import { hashPassword } from "../packages/api/src/lib/auth";
import {
  DEMO_INSPIRATIONS,
  DEMO_SEED_KIND,
  DEMO_WOW_MOMENTS,
  getDemoSeedSummary,
} from "./demo-seed-data";

interface Args {
  databaseUrl: string;
  userId?: string;
  email?: string;
  password?: string;
  name: string;
  replace: boolean;
  createUser: boolean;
  allowRemote: boolean;
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
  pnpm demo:seed -- --user-id=<uuid>

Options:
  --database-url=<url>  Defaults to DB_CONNECTION_URL or DATABASE_URL from the environment, .env, or .env.development.
  --user-id=<uuid>      Existing user id to seed for.
  --email=<email>       Existing user email to seed for. Fails if missing unless --create-user is passed.
  --create-user         Create the --email user if missing. Requires --password so the user can log in.
  --password=<password> Hash with the API auth helper when --create-user inserts a user.
  --name=<name>         Name used only when --email creates a user. Default: WAKA Demo.
  --append-demo-data    Append another demo dataset instead of replacing this script's prior demo rows.
  --allow-remote        Permit a non-local database URL. Prefer local/dev DBs only.

No secrets are logged. The script only writes real tenant-scoped rows for the selected user.`);
  process.exit(1);
}

export function parseArgs(argv = process.argv.slice(2)): Args {
  loadDemoSeedEnv();

  const databaseUrl =
    readArg("--database-url", argv) ?? process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) usage();

  const userId = readArg("--user-id", argv);
  const email = readArg("--email", argv);
  if (!userId && !email) usage();

  const password = readArg("--password", argv);
  const createUser = hasFlag("--create-user", argv);
  if (createUser && !email) {
    throw new Error("--create-user requires --email.");
  }
  if (createUser && !password) {
    throw new Error("--create-user requires --password so the demo user can log in.");
  }
  if (password && (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH)) {
    throw new Error(
      `--password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters, matching the normal signup policy.`,
    );
  }

  return {
    databaseUrl,
    userId,
    email,
    password,
    name: readArg("--name", argv) ?? "WAKA Demo",
    replace: !hasFlag("--append-demo-data", argv),
    createUser,
    allowRemote: hasFlag("--allow-remote", argv),
  };
}

export function assertLocalDatabase(databaseUrl: string, allowRemote: boolean): void {
  if (allowRemote) return;
  const parsed = new URL(databaseUrl);
  const host = normalizeDatabaseHost(parsed.hostname);
  if (isLocalDatabaseHost(host)) return;
  throw new Error(
    `Refusing to seed non-local database host "${host}". Use --allow-remote only for an explicit dev database.`,
  );
}

export async function resolveDemoUser(
  sql: SeedSql,
  input: Pick<Args, "userId" | "email" | "name" | "password" | "createUser">,
): Promise<{ id: string; email: string }> {
  if (input.userId) {
    const rows = await sql<{ id: string; email: string }[]>`
      select id, email from users where id = ${input.userId} limit 1
    `;
    if (rows.length === 0) {
      throw new Error(`No user exists for --user-id=${input.userId}`);
    }
    return rows[0]!;
  }

  const email = input.email!.trim().toLowerCase();
  const existing = await sql<{ id: string; email: string }[]>`
    select id, email from users where lower(email) = ${email} limit 1
  `;
  if (existing.length > 0) return existing[0]!;

  if (!input.createUser) {
    throw new Error(
      `No user exists for --email=${email}. Sign up first or pass --create-user --password=<password>.`,
    );
  }

  const id = randomUUID();
  const passwordHash = await hashPassword(input.password!);
  const inserted = await sql<{ id: string; email: string }[]>`
    insert into users (id, email, password_hash, name, created_at, updated_at)
    values (${id}, ${email}, ${passwordHash}, ${input.name}, now(), now())
    returning id, email
  `;
  return inserted[0]!;
}

export async function replacePriorDemoRows(sql: SeedSql, userId: string): Promise<void> {
  const demoTitles = DEMO_WOW_MOMENTS.map((moment) => moment.title);
  const demoTexts = DEMO_INSPIRATIONS.map((inspiration) => inspiration.text);

  await sql`
    with prior_demo_inspirations as (
      select id from inspirations
      where user_id = ${userId}
        and kind = ${DEMO_SEED_KIND}
        and text = any(${demoTexts})
    ), prior_demo_moments as (
      select distinct wmi.wow_moment_id
      from wow_moment_inspirations wmi
      inner join prior_demo_inspirations pdi on pdi.id = wmi.inspiration_id
      inner join wow_moments wm on wm.id = wmi.wow_moment_id
      where wm.user_id = ${userId}
        and wm.title = any(${demoTitles})
    ), deleted_links as (
      delete from wow_moment_inspirations
      where wow_moment_id in (select wow_moment_id from prior_demo_moments)
      returning wow_moment_id
    )
    delete from wow_moments
    where user_id = ${userId}
      and id in (select distinct wow_moment_id from deleted_links)
  `;
  await sql`
    delete from inspirations
    where user_id = ${userId}
      and kind = ${DEMO_SEED_KIND}
      and text = any(${demoTexts})
  `;
}

export function buildDemoWowMomentIdempotencyKey(params: {
  userId: string;
  triggerInspirationId: string;
  kind: string;
  relatedInspirationIds: string[];
  version?: number;
}): string {
  const stableRelatedIds = Array.from(new Set(params.relatedInspirationIds)).sort();
  return [
    `wow-moment-v${params.version ?? 2}`,
    params.userId,
    params.triggerInspirationId,
    params.kind,
    stableRelatedIds.join(","),
  ].join(":");
}

export async function seedDemoRows(sql: SeedSql, userId: string): Promise<void> {
  const inspirationIds = new Map<string, string>();
  const now = Date.now();

  for (const [index, seed] of DEMO_INSPIRATIONS.entries()) {
    const id = randomUUID();
    const createdAt = new Date(now - (DEMO_INSPIRATIONS.length - index) * 60 * 60 * 1000);
    await sql`
      insert into inspirations (
        id, user_id, text, kind, category, importance_score, wow_score,
        cluster, classified_at, created_at, updated_at
      ) values (
        ${id}, ${userId}, ${seed.text}, ${seed.kind}, ${seed.category},
        ${seed.importanceScore}, ${seed.wowScore}, ${seed.cluster}::cluster,
        ${createdAt}, ${createdAt}, ${createdAt}
      )
    `;
    inspirationIds.set(seed.slug, id);
  }

  for (const [momentIndex, moment] of DEMO_WOW_MOMENTS.entries()) {
    const id = randomUUID();
    const createdAt = new Date(now - momentIndex * 30 * 60 * 1000);
    const relatedInspirationIds = moment.related.map((related) => {
      const inspirationId = inspirationIds.get(related.inspirationSlug);
      if (!inspirationId) {
        throw new Error(`Demo WOW moment references unknown inspiration slug ${related.inspirationSlug}`);
      }
      return inspirationId;
    });
    const triggerInspirationId = relatedInspirationIds[0];
    if (!triggerInspirationId) {
      throw new Error(`Demo WOW moment ${moment.slug} must reference at least one inspiration`);
    }
    const idempotencyKey = buildDemoWowMomentIdempotencyKey({
      userId,
      triggerInspirationId,
      kind: moment.kind,
      relatedInspirationIds,
    });
    await sql`
      insert into wow_moments (
        id, user_id, title, kind, idempotency_key, why, reflection_question, wow_score,
        created_at, updated_at
      ) values (
        ${id}, ${userId}, ${moment.title}, ${moment.kind}::wow_kind, ${idempotencyKey}, ${moment.why},
        ${moment.reflectionQuestion}, ${moment.wowScore}, ${createdAt}, ${createdAt}
      )
    `;

    for (const [relatedIndex, related] of moment.related.entries()) {
      const inspirationId = relatedInspirationIds[relatedIndex];
      if (!inspirationId) {
        throw new Error(`Demo WOW moment references unknown inspiration slug ${related.inspirationSlug}`);
      }
      await sql`
        insert into wow_moment_inspirations (
          id, user_id, wow_moment_id, inspiration_id, role, reason, sort_order, created_at
        ) values (
          ${randomUUID()}, ${userId}, ${id}, ${inspirationId}, ${related.role}, ${related.reason},
          ${relatedIndex}, ${createdAt}
        )
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
    const user = await sql.begin(async (tx) => {
      const resolvedUser = await resolveDemoUser(tx, args);
      if (args.replace) await replacePriorDemoRows(tx, resolvedUser.id);
      await seedDemoRows(tx, resolvedUser.id);
      return resolvedUser;
    });
    const summary = getDemoSeedSummary();
    console.log(
      `Seeded WAKA demo data for ${user.email}: ${summary.inspirationCount} inspirations, ${summary.wowMomentCount} WOW moments, ${summary.linkedInspirationCount} linked inspiration references.`,
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
