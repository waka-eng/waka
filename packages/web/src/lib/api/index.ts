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
 *   principles.ts                principles.ts    /api/principles     (layer 4)
 *   top-of-mind.ts               top-of-mind.ts   /api/top-of-mind    (layer 3)
 *   groups.ts                    groups.ts        /api/groups
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
export * from "./attachments";
export * from "./signals";
export * from "./principles";
export * from "./top-of-mind";
export * from "./groups";
export * from "./feedback";
export * from "./public-profiles";
export * from "./reading";
