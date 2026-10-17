/**
 * Test-helpers barrel.
 *
 * Lets a spec import every infrastructure piece in one line:
 *
 *     import { createTestDatabase } from "./helpers/index.js";
 *
 * Each module is also importable directly (`./helpers/db.js`, etc.) for
 * specs that only need one piece — the barrel is a convenience, not a
 * required entry-point.
 */

export {
  createTestDatabase,
  type TestDatabase,
} from "./db.js";

/* Unlike the one above this one opens nothing — it is an in-memory stand-in for
   a single table, used by the no-database suite. Import it directly rather than
   through this barrel from a spec that must not pull in `./db.js`. */
export {
  applyLoginFailureUpsert,
  loginFailureDb,
  type LoginFailureRow,
  type LoginFailureStore,
} from "./login-failure-store.js";
