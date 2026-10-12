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
 *   sessions.ts                  sessions.ts      /api/sessions
 *   inspirations.ts              inspirations.ts  /api/inspirations   (layer 1)
 *   attachments.ts               attachments.ts   /api/attachments
 *   signals.ts                   signals.ts       /api/signals        (layer 2)
 *   claims.ts                    claims.ts        /api/claims         (layer 2, unanswered)
 *   principles.ts                principles.ts    /api/principles     (layer 4)
 *   top-of-mind.ts               top-of-mind.ts   /api/top-of-mind    (layer 3)
 *   groups.ts                    groups.ts        /api/groups
 *   keeper-keys.ts               keeper-keys.ts   /api/keeper-keys
 *   agent-grants.ts              agent-grants.ts  /api/agent-grants
 *   consultations.ts             consultations.ts /api/consultations
 *   feedback.ts                  feedback.ts      /api/feedback
 *   public-profiles.ts           public-profiles.ts  /api/public/profiles
 *   http.ts                      —  the fetch wrapper they all share
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
export * from "./sessions";
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
export * from "./signals";
export * from "./claims";
export * from "./inspiration-days";
export * from "./principles";
export * from "./top-of-mind";
export * from "./groups";
export * from "./agents";
export * from "./keeper-keys";
export * from "./agent-grants";
export * from "./consultations";
export * from "./signal-duplicates";
export * from "./feedback";
export * from "./public-profiles";
export * from "./reading";
export * from "./weather";
