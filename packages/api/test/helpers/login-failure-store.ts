/**
 * A `login_failures` table that decides server-computed writes for itself.
 *
 * WHY THIS IS NOT A ONE-LINE `Map.set`
 * ------------------------------------
 * The defect this store exists to catch was a lost update. `recordLoginFailure`
 * used to work the new count out in JavaScript from a read taken before bcrypt,
 * so every attempt that arrived during that compare wrote the same number and
 * fifty simultaneous guesses cost one increment. A fake that stores whatever it
 * is handed reproduces that faithfully — which is exactly what we want, because
 * a regression test has to be able to fail — but it can only tell the broken
 * version from the fixed one if it ALSO evaluates a server-side expression the
 * way the server would. Otherwise both versions look like "some number arrived"
 * and the suite stays green through the bug.
 *
 * So this store applies two different rules, and the difference between them is
 * the entire subject of the test:
 *
 *   - a LITERAL is written as given. The client decided it; concurrent writers
 *     overwrite each other; lost updates happen here just as they did in
 *     production.
 *   - a drizzle `SQL` expression is EVALUATED against the row this store is
 *     holding at the moment of the write, which is what `ON CONFLICT DO UPDATE`
 *     does under the row lock.
 *
 * WHY IT PARSES SQL INSTEAD OF ASSUMING WHAT THE EXPRESSION MEANS
 * ---------------------------------------------------------------
 * A fake that saw an expression and just incremented would pass a production
 * `failures + 1` with no window handling — and a bare `failures + 1` is a
 * counter that never resets, which turns the throttle into the permanent
 * lockout the design is built to avoid. So the expression is rendered through
 * drizzle's own `PgDialect` and the resulting SQL is interpreted. The grammar
 * below is tiny, and anything outside it THROWS rather than guessing: a query
 * this store does not understand must fail the test, never quietly satisfy it.
 *
 *   expression := "case when" comparison "then" expression "else" expression "end"
 *               | term
 *   comparison := term "<" term
 *   term       := atom ("+" atom)*
 *   atom       := "<table>"."<column>" | $<n> | <integer>
 *
 * Nothing here touches a database, and no row is invented: every count in every
 * test is one the code under test put there by failing a login.
 */

import { getTableColumns, getTableName, is, SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import { loginFailures } from "../../src/db/index.js";

export interface LoginFailureRow {
  keyHash: string;
  scope: string;
  failures: number;
  windowStartedAt: Date;
  updatedAt: Date;
}

/** The table: bucket key hash to row, surviving across requests. */
export type LoginFailureStore = Map<string, LoginFailureRow>;

const TABLE = getTableName(loginFailures);

/** Column name as SQL spells it, to the property name a row uses. */
const COLUMNS = new Map(
  Object.entries(getTableColumns(loginFailures)).map(([property, column]) => [
    column.name,
    { property: property as keyof LoginFailureRow, isTimestamp: column.dataType === "date" },
  ]),
);

const dialect = new PgDialect();

/** Timestamps cross the driver as ISO strings; comparisons need instants. */
function instant(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  if (typeof value === "number") return value;
  throw new Error(`login_failures store cannot compare ${String(value)} as an instant`);
}

function numeric(value: unknown): number {
  if (typeof value === "number") return value;
  throw new Error(`login_failures store cannot use ${String(value)} as a number`);
}

/** Put a value back in the shape the column stores it in. */
function coerce(property: string, value: unknown): unknown {
  const column = [...COLUMNS.values()].find((candidate) => candidate.property === property);
  if (column?.isTimestamp && typeof value === "string") return new Date(value);
  return value;
}

/**
 * Run one `SET` expression against the row the store currently holds.
 *
 * `stored` is the pre-update row, which is what a table-qualified reference
 * means inside `ON CONFLICT DO UPDATE` — `"login_failures"."failures"` is the
 * value already there, not the one being proposed.
 */
function evaluate(expression: SQL, stored: LoginFailureRow): unknown {
  const { sql: text, params } = dialect.sqlToQuery(expression);
  const tokens = text.split(/\s+/).filter((token) => token.length > 0);
  let at = 0;

  function fail(why: string): never {
    throw new Error(`login_failures store cannot evaluate \`${text}\`: ${why}`);
  }

  function take(expected: string): void {
    if (tokens[at] !== expected) fail(`expected \`${expected}\` at token ${at}`);
    at += 1;
  }

  function atom(): unknown {
    const token = tokens[at];
    if (token === undefined) fail("ran out of tokens");
    at += 1;

    const parameter = /^\$(\d+)$/.exec(token);
    if (parameter) return params[Number(parameter[1]) - 1];

    if (/^\d+$/.test(token)) return Number(token);

    const reference = /^"([^"]+)"\."([^"]+)"$/.exec(token);
    if (reference) {
      if (reference[1] !== TABLE) fail(`reference to another table: ${token}`);
      const column = COLUMNS.get(reference[2]!);
      if (!column) fail(`no such column: ${token}`);
      return stored[column.property];
    }

    return fail(`unrecognised token \`${token}\``);
  }

  function term(): unknown {
    let value = atom();
    while (tokens[at] === "+") {
      at += 1;
      value = numeric(value) + numeric(atom());
    }
    return value;
  }

  function expr(): unknown {
    if (tokens[at] !== "case") return term();
    at += 1;
    take("when");
    const left = term();
    take("<");
    const right = term();
    take("then");
    const whenTrue = expr();
    take("else");
    const whenFalse = expr();
    take("end");
    return instant(left) < instant(right) ? whenTrue : whenFalse;
  }

  const value = expr();
  if (at !== tokens.length) fail(`did not consume the whole expression (stopped at token ${at})`);
  return value;
}

/**
 * `INSERT … ON CONFLICT (key_hash) DO UPDATE SET …` against the store.
 *
 * The insert branch takes the proposed row verbatim. The conflict branch starts
 * from the row that is there and applies the SET clause to it, which is the
 * only place the literal-versus-expression distinction above matters.
 */
export function applyLoginFailureUpsert(
  store: LoginFailureStore,
  values: Record<string, unknown>,
  set: Record<string, unknown>,
): void {
  const keyHash = values.keyHash as string;
  const stored = store.get(keyHash);

  if (stored === undefined) {
    const inserted: Record<string, unknown> = {};
    for (const [property, value] of Object.entries(values)) {
      inserted[property] = coerce(property, value);
    }
    store.set(keyHash, inserted as unknown as LoginFailureRow);
    return;
  }

  const updated: Record<string, unknown> = { ...stored };
  for (const [property, value] of Object.entries(set)) {
    updated[property] = coerce(property, is(value, SQL) ? evaluate(value, stored) : value);
  }
  store.set(keyHash, updated as unknown as LoginFailureRow);
}

/**
 * The drizzle surface `lib/login-throttle.ts` actually uses, over one store.
 *
 * The select hands back every row rather than filtering. The caller looks each
 * bucket up by its own key hash, so an unfiltered answer is the same answer a
 * `WHERE key_hash IN (…)` would have given, and this fake does not have to
 * interpret a drizzle condition to stay honest.
 *
 * The delete is the expiry sweep, which `recordLoginFailure` runs at most once
 * per window per process and whose failure it already swallows. Nothing in
 * these suites depends on it, and `readLoginThrottle` discards a closed window
 * on its own, so a no-op here is the sweep not having come round yet.
 */
export function loginFailureDb(store: LoginFailureStore) {
  return {
    select: () => ({
      from: () => ({
        where: async () => [...store.values()],
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoUpdate: async (config: { set: Record<string, unknown> }) => {
          applyLoginFailureUpsert(store, row, config.set);
        },
      }),
    }),
    delete: () => ({ where: async () => undefined }),
  };
}
