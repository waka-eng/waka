/**
 * THE FIXTURE'S CLOCK — every invented date is measured back from now.
 *
 * Both fixtures under this directory date everything relative to the moment
 * the module loads, and never from a calendar date. That is not laziness. The
 * field colours a memory by how long ago it was kept (`lib/aliveness.ts`), so
 * a fixture pinned to fixed dates would slide out of the ramp's range and, a
 * season later, would draw a world with nothing warm in it — a picture of the
 * ramp being broken rather than of the fixture being old. Whoever opened it
 * would debug the wrong thing.
 *
 * IT IS HERE RATHER THAN IN `lib/num.ts` ON PURPOSE. That is where `DAY_MS`
 * lives and where a general "N days ago" helper would otherwise belong, and
 * that is exactly the reason to keep it out: `lib/num.ts` is imported by half
 * the app, and a product file that reaches for a date-maker is a product file
 * inventing a timestamp. Under `fixture/` it can only be reached by something
 * that already knows what it is doing.
 */
import { DAY_MS } from "../num";

export const daysAgo = (d: number): string => new Date(Date.now() - d * DAY_MS).toISOString();
