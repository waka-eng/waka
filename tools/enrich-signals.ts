#!/usr/bin/env tsx
/**
 * Backfill enrichment for a group's shared signals, then re-embed the rows
 * that gained words.
 *
 * Order matters and is enforced by hash, not care: `ensureInspirationEmbedding`
 * regenerates exactly the rows whose canonical input changed — which is
 * exactly the rows enrichment touched, and no others. Un-enriched rows keep a
 * byte-identical input and are left alone (pinned by test).
 *
 * Usage:
 *   pnpm tsx tools/enrich-signals.ts --group <uuid> [--force]
 *   pnpm tsx tools/enrich-signals.ts --audit  <uuid>     # measure only
 */

import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });
loadDotenv();

import { and, eq } from "drizzle-orm";

import { groupMembers, signals, users } from "../packages/api/src/db/index";
import { getDb } from "../packages/api/src/lib/db";
import { ensureInspirationEmbedding } from "../packages/api/src/lib/inspiration-embeddings";
import { ensureSignalEnrichment } from "../packages/api/src/lib/signal-enrichment";

/** Audible = enough non-URL words for an embedding to mean something. */
const AUDIBLE_CHARS = 120;

function audibleLength(text: string, enrichment: string | null): number {
  const withoutUrls = text.replace(/https?:\/\/\S+/g, " ");
  return `${withoutUrls} ${enrichment ?? ""}`.replace(/\s+/g, " ").trim().length;
}

function parseArgs(argv: string[]) {
  let groupId: string | undefined;
  let force = false;
  let auditOnly = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--group") groupId = argv[++i];
    else if (argv[i] === "--audit") { auditOnly = true; groupId = argv[++i]; }
    else if (argv[i] === "--force") force = true;
  }
  return { groupId, force, auditOnly };
}

async function main(): Promise<void> {
  const { groupId, force, auditOnly } = parseArgs(process.argv.slice(2));
  if (!groupId) {
    console.error("usage: enrich-signals --group <uuid> [--force] | --audit <uuid>");
    process.exitCode = 1;
    return;
  }
  const db = getDb();

  const rows = await db
    .select({
      id: signals.id,
      userId: signals.userId,
      member: users.name,
      text: signals.text,
      enrichment: signals.enrichment,
      enrichedAt: signals.enrichedAt,
    })
    .from(groupMembers)
    .innerJoin(users, eq(users.id, groupMembers.userId))
    .innerJoin(
      signals,
      and(eq(signals.userId, groupMembers.userId), eq(signals.sharedToGroups, true)),
    )
    .where(eq(groupMembers.groupId, groupId));

  const audible = (r: (typeof rows)[number]) =>
    audibleLength(r.text, r.enrichment) >= AUDIBLE_CHARS;
  console.log(
    `\n${rows.length} shared signals · audible before: ${rows.filter(audible).length}/${rows.length}\n`,
  );
  if (auditOnly) return;

  let enriched = 0;
  let silent = 0;
  let reEmbedded = 0;
  for (const row of rows) {
    if (row.enrichedAt && !force) continue;
    const outcome = await ensureSignalEnrichment(db as never, {
      userId: row.userId,
      signalId: row.id,
      force,
    });
    if (outcome === "enriched") {
      enriched += 1;
      // Only enriched rows changed their canonical input; only they re-embed.
      const result = await ensureInspirationEmbedding({
        db: db as never,
        userId: row.userId,
        inspirationId: row.id,
      });
      if (result.generated) reEmbedded += 1;
      console.log(`  + ${String(row.member).padEnd(14)} ${row.text.slice(0, 56)}`);
    } else if (outcome === "page_silent") {
      silent += 1;
      console.log(`  · ${String(row.member).padEnd(14)} silent: ${row.text.slice(0, 48)}`);
    }
  }

  const after = await db
    .select({ text: signals.text, enrichment: signals.enrichment })
    .from(groupMembers)
    .innerJoin(
      signals,
      and(eq(signals.userId, groupMembers.userId), eq(signals.sharedToGroups, true)),
    )
    .where(eq(groupMembers.groupId, groupId));
  const audibleAfter = after.filter(
    (r) => audibleLength(r.text, r.enrichment) >= AUDIBLE_CHARS,
  ).length;

  console.log(
    `\nenriched ${enriched} · silent ${silent} · re-embedded ${reEmbedded}` +
      `\naudible after: ${audibleAfter}/${after.length} (${((100 * audibleAfter) / after.length).toFixed(0)}%)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
