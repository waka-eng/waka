/**
 * Test-helpers barrel.
 *
 * Lets a spec import every infrastructure piece in one line:
 *
 *     import { authedClient, createTestDatabase } from "./helpers/index.js";
 *
 * Each module is also importable directly (`./helpers/db.js`, etc.) for
 * specs that only need one piece — the barrel is a convenience, not a
 * required entry-point.
 */

export {
  app,
  apiJson,
  apiRequest,
  authedClient,
  extractSetCookie,
  extractSetCookieOptional,
  type ApiJsonResponse,
  type ApiRequestInit,
  type AuthedClient,
  type SessionFixture,
} from "./client.js";

export {
  createTestDatabase,
  type TestDatabase,
} from "./db.js";
