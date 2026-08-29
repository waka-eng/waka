/**
 * The consultation writer — one function, called at the moment of serving.
 *
 * AWAITED, DELIBERATELY. A serve log written fire-and-forget fails
 * silently, and a record that might be missing is not a record — the whole
 * product claim is "the read side answers for itself." The insert rides
 * the same database round-trip budget as the serve it describes; if the
 * record cannot be written, the serve fails loudly rather than happening
 * off the record.
 *
 * Every field comes from the authenticated request context — nothing here
 * is inferred, trusted from the client, or computed twice.
 */
import { consultations, type ConsultationSurface } from "../db/index.js";
import type { AuthenticatedSession } from "./session.js";
import type { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;

export async function recordConsultation(
  db: WakaDb,
  input: {
    /** whose derived memory is being served */
    profileId: string;
    /** who is reading — the authenticated session */
    session: AuthenticatedSession;
    surface: ConsultationSurface;
    /** the artifact version served (top of mind); null when the honest
        answer was "nothing synthesized yet" — that serve is recorded too */
    artifactVersion?: number | null;
    /** the rendering's day-stamp (principles) */
    renderedOn?: Date | null;
  },
): Promise<void> {
  /* A KEY-BOUND READER HAS NO SESSION ROW. A standing key — an agent's
     (2026-08-17) or the keeper's (2026-08-29) — carries a synthetic
     `agent-key:<id>` / `keeper-key:<id>` session id: not a uuid, not a row
     in `sessions`, and writing it here turned the credential's first READ
     into a 500 at `string_to_uuid` (twice — once per key kind, because the
     first fix named one prefix instead of the shape). The mark records null
     for the credential and keeps the reader profile, the same shape a
     pruned session leaves; the key's own `last_used_at` carries the rest. */
  const sessionRowId = input.session.sessionId.includes(":")
    ? null
    : input.session.sessionId;
  await db.insert(consultations).values({
    profileId: input.profileId,
    sessionId: sessionRowId,
    readerProfileId: input.session.profile.id,
    surface: input.surface,
    artifactVersion: input.artifactVersion ?? null,
    renderedOn: input.renderedOn
      ? input.renderedOn.toISOString().slice(0, 10)
      : null,
  });
}
