/**
 * Typed API client — the only place HTTP happens (`docs/architecture.md`).
 *
 * One module per resource, named after the route file that answers it, so the
 * two sides of the wire can be held in one head at once:
 *
 *   this file                    packages/api/src/routes/
 *   ------------------------     ------------------------
 *   auth.ts                      auth.ts          /api/auth
 *   profiles.ts                  profiles.ts      /api/profiles
 *   inspirations.ts              inspirations.ts  /api/inspirations   (layer 1)
 *   attachments.ts               attachments.ts   /api/attachments
 *   signals.ts                   signals.ts       /api/signals        (layer 2)
 *   claims.ts                    claims.ts        /api/claims         (layer 2, unanswered)
 *   harvest.ts                   harvest.ts       /api/harvest        (the basket, before layer 1)
 *   principles.ts                principles.ts    /api/principles     (layer 4)
 *   top-of-mind.ts               top-of-mind.ts   /api/top-of-mind    (layer 3)
 *   feedback.ts                  feedback.ts      /api/feedback
 *   public-profiles.ts           public-profiles.ts  /api/public/profiles
 *   http.ts                      —  the fetch wrapper they all share
 *
 * SIX ROWS CAME OUT OF THAT TABLE and are listed here rather than silently
 * dropped, because the table is the one place the two sides of the wire are
 * written down together and a reader needs to know these were removed, not
 * forgotten: `sessions.ts`, `keeper-keys.ts`, `agent-grants.ts` and
 * `consultations.ts`. Their surfaces went with the settings cut — see
 * `SettingsPanel`'s header for which five sections did not survive it — and
 * the route files they named are gone too.
 *
 * AND `groups.ts` / `/api/groups`, on 2026-10-12. Founder: "방 없애" —
 * remove rooms. Nine route files on the server and twelve verbs on this side
 * went then. The module itself outlived them by three days as three types
 * with no client, re-exported here because `canvas/simulation.ts` named them
 * and could not be edited from that change; it was deleted on 2026-10-15
 * when the loop's group branches came out. There is no `./groups` below any
 * more, and no row in the table above, because there is no route.
 *
 * AND `agents.ts` / `/api/agent-keys`, the same day. The whole file went:
 * the agent-key client -- `fetchAgentKeys`, `createAgentKey`,
 * `revokeAgentKey` -- plus three graph types, every one with zero callers
 * once the settings panel's key section came out with the rooms cut.
 * Unlike `groups.ts` there is nothing left to re-export, so the row is
 * simply gone. THE ROUTES STAND, and that is deliberate: `DELETE
 * /api/agent-keys/:id` is the only way to retire the rows minted while
 * the secret was displayed, so it outlives its client.
 *
 * A TABLE THAT NAMES A DELETED FILE IS WORSE THAN NO TABLE, which is why
 * this is a fix and not a tidy-up: the rows survived the deletion of the
 * modules they pointed at, so the one artefact that claims to map client to
 * route was lying about the four it still named.
 *
 * The vocabulary throughout is the vocabulary of `docs/data-model.md`, one
 * name per concept: an **account** logs in, a **profile** owns memory, and a
 * profile's memory is three layers — inspirations, signals, one top of mind.
 * Nothing here translates between two names for the same thing; if a name
 * disagrees with that document, this side is the one that is wrong.
 *
 * WHY THIS BARREL IS EXPLICIT ABOUT `http.ts` AND NOT ABOUT THE REST.
 *
 * The resource modules are re-exported wholesale — everything in them was
 * already public when this was one file, and listing them again would be a
 * second copy of the same list to keep in sync. `http.ts` is different: its
 * verb helpers (`getJson`, `postJson`, `requestVoid`, …) were private to that
 * single file and must stay unreachable from pages, or "the only place HTTP
 * happens" stops being true the first time a component finds it can build a
 * request itself. So http's five public names are named one by one, and the
 * plumbing is not among them.
 */

export { ApiError, apiPath } from "./http";
export type { ApiFieldErrors, ApiProfileType, ProfileScoped } from "./http";

export * from "./auth";
export * from "./profiles";
export * from "./inspirations";
export * from "./inspiration-processing";
/* `review-sessions`, `review-dialogue` and `review-processing` are GONE
   (2026-10-10). Three resources — a review session with its own advance and
   finish verbs, a question/answer dialogue with revisions and drafts, and the
   processing job that turned those answers into a reading — behind five
   components the founder folded into one correction field. Each one's only
   caller was a hook under `lib/`, and each of those hooks had exactly one
   component. Nothing else in the client spoke to them. The server routes
   still stand; this barrel simply no longer offers a client for them. */
export * from "./inspiration-save-requests";
export * from "./attachments";
export * from "./file-accept";
export * from "./signals";
export * from "./claims";
export * from "./harvest";
export * from "./inspiration-days";
export * from "./principles";
export * from "./top-of-mind";
export * from "./feedback";
export * from "./public-profiles";
export * from "./weather";
