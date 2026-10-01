import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { backgroundJobs } from "../db/index.js";
import { getDb } from "./db.js";

const resultSchema = z.object({
  kind: z.literal("top_of_mind"), topOfMindId: z.string().uuid().nullable(),
  version: z.number().int().nonnegative(), outcome: z.enum(["changed", "unchanged", "empty"]),
}).refine((result) => result.topOfMindId === null
  ? result.outcome === "empty" && result.version === 0
  : result.version > 0);

/** Never expose provider errors/payloads or another profile's job. */
export async function loadTopOfMindRefreshStatus(db: ReturnType<typeof getDb>, profileId: string, jobId: string, requestVersion?: string) {
  const [row] = await db.select({ status: backgroundJobs.status, result: backgroundJobs.result,
    requestVersion: backgroundJobs.requestVersion, completedVersion: backgroundJobs.completedVersion,
    runAfter: backgroundJobs.runAfter, rerun: backgroundJobs.rerunRequested })
    .from(backgroundJobs).where(and(eq(backgroundJobs.id, jobId), eq(backgroundJobs.profileId, profileId),
      eq(backgroundJobs.type, "refresh_top_of_mind"))).limit(1);
  if (!row) return null;
  const requested = requestVersion === undefined ? row.requestVersion : BigInt(requestVersion);
  if (requested < 1n || requested > row.requestVersion) return null;
  const parsed = resultSchema.safeParse(row.result);
  const result = row.status === "succeeded" && !row.rerun && row.completedVersion >= requested && parsed.success ? parsed.data : null;
  return {
    requestVersion: row.requestVersion.toString(), completedVersion: row.completedVersion.toString(),
    status: row.status === "succeeded" && !result ? "unknown" as const : row.status,
    runAfter: row.status === "pending" ? row.runAfter.toISOString() : null,
    result,
  };
}
