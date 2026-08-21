/**
 * COMPATIBILITY RE-EXPORT. There is one API client, and it is `lib/api/`.
 *
 * This file used to BE the client — a single 1,653-line module. The world's
 * work split it into one module per resource under `lib/api/`, and layer 4's
 * principles client was added to the old file in parallel, so for a while both
 * existed and disagreed about which was real.
 *
 * They no longer do: the principles functions moved to `lib/api/principles.ts`
 * verbatim, and everything here is that one implementation. This file survives
 * only so `pages/Surface.tsx` keeps importing the path it always has — its
 * import line is untouched, which is the point.
 *
 * Delete this file when Surface.tsx is next edited for another reason.
 */

export * from "./api/index";
