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
  /* A KEY-BOUND READER HAS NO SESSION ROW. An agent acting through its
     standing key (2026-08-17) carries a synthetic `agent-key:<id>` session
     id — not a uuid, and not a row in `sessions` — and writing it here
     turned the agent's first READ into a 500 at `string_to_uuid`. The mark
     records null for the credential and keeps the reader profile, which is
     the same shape a pruned session leaves: "this profile read it", with the
     credential's own row (`agent_keys.last_used_at`) carrying the rest. */
  const sessionRowId = input.session.sessionId.startsWith("agent-key:")
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
