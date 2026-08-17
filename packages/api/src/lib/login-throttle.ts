/**
 * HOW MANY PASSWORDS YOU MAY GUESS, AND WHY THAT CANNOT LOCK ANYONE OUT.
 *
 * `POST /api/auth/login` counted nothing. No limit, no cooldown, no record
 * that an attempt had ever failed — one request per guess, indefinitely. And
 * `/signup` answers 409 for an address that already exists (a deliberate B2C
 * trade documented in routes/auth.ts), so an attacker could first confirm a
 * target is registered here and then grind its password at network speed.
 *
 * This file is the whole of the rule, and it is shaped the way the rest of
 * this repo's security work is: durable state, checked in plain TypeScript,
 * with the reason written next to the number.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE THING THAT MUST NOT HAPPEN
 * ─────────────────────────────────────────────────────────────────────────
 *
 * The obvious fix is "N failures against an address and that address is
 * locked". That is a weapon handed to the attacker: anyone who knows your
 * email can fail logins on your behalf until you cannot get into your own
 * account. Trading a brute-force hole for a denial-of-service hole is not a
 * fix, and a throttle that can be aimed at a victim is worse than none —
 * it can be aimed at everyone, at once, cheaply.
 *
 * So the per-address budget here has an exemption, and the exemption is the
 * load-bearing part of the design:
 *
 *   **A request that carries a valid device credential for the address it is
 *   trying is never refused by the address's budget or by the source's — only
 *   by its own.**
 *
 * A device credential is a signed cookie minted on a SUCCESSFUL login. You get
 * one by knowing the password, which is exactly what the attacker does not
 * have. So:
 *
 *   - The account holder, on a browser they have signed in from before,
 *     carries one. The flood against their address does not touch them. They
 *     type their password and they are in. **They cannot be locked out.**
 *   - The attacker carries none, and cannot mint one (it is HMAC-signed under
 *     the app secret) or steal one (it is httpOnly and bound to the address).
 *     They get IDENTIFIER_FAILURE_BUDGET guesses per window against any given
 *     address, no matter how many machines they spread across.
 *
 * This is OWASP's device-cookie recommendation, and it is here rather than a
 * lockout because it is the only shape that stops guessing without giving
 * someone a way to deny a person their own account.
 *
 * WHAT THIS STILL COSTS AN HONEST PERSON. This is a real cost, not a rounding
 * error, so it is written down rather than glossed.
 *
 * A browser that has never signed in as this address holds no credential, and
 * while the address's budget is spent it is refused. An attacker willing to
 * keep spending IDENTIFIER_FAILURE_BUDGET guesses every window can therefore
 * keep UNRECOGNISED browsers away from a named address for as long as they
 * keep paying — indefinitely, in principle, not just for one window. What they
 * cannot do is keep the owner out of the browser they already use, which is
 * where nearly everyone signs in from, and which signup and every successful
 * login re-mint.
 *
 * That residue is not closeable with what this repo has today. Telling an
 * account's owner apart from the flood needs either a credential they already
 * hold (this one) or a channel only they can answer — a reset link, a mailed
 * code — and this repo cannot send mail at all: no provider has ever been
 * chosen, which is why the email-verification feature that assumed one was
 * removed rather than left half-built. The honest completion of this design is
 * "we don't recognise this browser, check your email", and this file is where
 * it hooks in the day there is an inbox to send to. Until then the trade being
 * made is: unlimited guessing, which ends with someone else owning the
 * account, against sustained expense that delays unrecognised devices and
 * stops the moment the attacker does.
 *
 * A second, weaker exemption was considered and rejected: "let the request
 * through if its source address has no failures on record". It reads well and
 * needs no cookie, but it depends on the source address being both correct and
 * unforgeable, and below is the reason neither can be assumed here. Under
 * CloudFront every caller shares one source, so the exemption would evaporate
 * for everybody at once; and where `X-Forwarded-For` can be set by the caller
 * it would let an attacker put a failure on the victim's address and re-open
 * the exact lockout this design exists to prevent.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THE PER-SOURCE BUDGET IS OFF UNTIL THE DEPLOYMENT SAYS OTHERWISE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A per-address budget does not stop spraying — one guess each against ten
 * thousand addresses never trips it. That needs a per-source budget, and a
 * per-source budget needs to know which network address is the caller's. In
 * this deployment that is genuinely undecided:
 *
 *   - `sst.config.ts` puts the API behind a CloudFront Router on every stage
 *     that has a domain (dev, development, production). The address the Lambda
 *     event attests is then the CloudFront edge's, shared by every caller in
 *     the world. Counting failures against it and refusing at a budget would
 *     throttle the product, not an attacker.
 *   - `X-Forwarded-For` carries the real viewer, appended last by CloudFront.
 *     But the Function URL origin is publicly reachable, so a caller who goes
 *     straight to it can write that header themselves.
 *
 * Which hop is trustworthy is a fact about the infrastructure — the same class
 * of decision as choosing an email provider, and it belongs to whoever runs the
 * deployment rather than to this file. So it is one environment variable:
 *
 *   WAKA_TRUSTED_PROXY_HOPS unset  → per-source budget OFF. The only safe
 *                                    default: guessing wrong here throttles
 *                                    real users rather than attackers.
 *   WAKA_TRUSTED_PROXY_HOPS=0      → trust the address the platform attests
 *                                    (a bare Lambda Function URL, or the node
 *                                    server in local development).
 *   WAKA_TRUSTED_PROXY_HOPS=n      → take the entry n-from-the-right of
 *                                    X-Forwarded-For. n=1 is CloudFront.
 *
 * SAY THE CONSEQUENCE OUT LOUD: with the variable unset, which is how this
 * ships, the per-address budget is the ONLY live budget, and a per-address
 * budget does not see spraying at all. One popular password tried once each
 * against ten thousand addresses spends nothing anywhere and is answered every
 * time. What is defended here is vertical guessing — many passwords at one
 * address — and horizontal guessing stays open until a deployment says which
 * hop it trusts. That is a deliberate gap with a switch next to it, not an
 * oversight, and it should be read as "durable throttling of brute force
 * against an account", not as "durable login throttling".
 *
 * Until it is set, the per-address budget above carries the whole load, which
 * is the part that answers the reported hole. And because of the device
 * exemption, a source budget that is later switched on with the wrong number
 * still cannot lock an account holder out of their own account. It can hold
 * unrecognised browsers out of that address for as long as whoever is spending
 * the budget keeps spending it, which is the same indefinite cost written down
 * above — not a wait with a known end.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { inArray, lt, sql } from "drizzle-orm";
import type { Context } from "hono";

import { loginFailures } from "../db/index.js";
import { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

/**
 * How long a window of counted failures lasts.
 *
 * Fifteen minutes: long enough that grinding is pointless (ten guesses an hour
 * against a given address is not an attack, it is a hobby), short enough that
 * anyone caught by it waits rather than files a support ticket.
 */
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Failures against one address, from anywhere, before unrecognised browsers
 * are refused.
 *
 * Ten is well above what a person forgetting which password they used will
 * spend, and far below what guessing needs. A successful login clears it, so
 * the honest fumbler who eventually remembers pays nothing.
 */
export const IDENTIFIER_FAILURE_BUDGET = 10;

/**
 * Failures from one source, against any address, before it is refused.
 *
 * Twenty rather than ten because a source is frequently a whole office behind
 * one egress address, and this budget counts only failures, so ordinary
 * traffic never approaches it. Inert unless WAKA_TRUSTED_PROXY_HOPS is set —
 * see the header.
 */
export const SOURCE_FAILURE_BUDGET = 20;

/**
 * Failures from one recognised browser before even it is refused.
 *
 * The device credential is an exemption, not a bypass. Someone who lifted a
 * cookie out of a browser they already had their hands on gets ten guesses per
 * window like everyone else — they simply get them from their own bucket
 * rather than the attacker's.
 */
export const DEVICE_FAILURE_BUDGET = 10;

/** Six months. Long enough that the browser you use is still recognised. */
export const LOGIN_DEVICE_TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** The cookie the device credential rides in. */
export const LOGIN_DEVICE_COOKIE_NAME = "waka_login_device";

// ---------------------------------------------------------------------------
// Keying
// ---------------------------------------------------------------------------

export type LoginThrottleScope = "identifier" | "source" | "device";

/**
 * The secret the bucket keys and the device credential are signed under.
 *
 * It reads the same two variable names as `lib/auth.ts` rather than importing
 * that module's private resolver. Widening `getJwtSecret` into an export would
 * make every future change to how sessions are signed a change to how this
 * table is keyed, and those two should be free to move apart. Missing is fatal
 * on purpose: a login that cannot key its buckets has not been throttled, and
 * a login without a signing secret was already going to fail at session mint.
 */
function loginThrottleSecret(): string {
  const secret = process.env.JWT_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET (or AUTH_SECRET) is not set. Login throttling cannot key its buckets without it.",
    );
  }
  return secret;
}

/**
 * The stored key for a bucket.
 *
 * HMAC rather than a bare digest because the inputs are low-entropy — an email
 * address, an IPv4 address — and a bare sha-256 of either is reversible by
 * enumeration. Under the app secret the table is inert to anyone holding a
 * dump without it. The scope is inside the input, so two scopes can never
 * collide on one row.
 */
function bucketKeyHash(scope: LoginThrottleScope, value: string): string {
  return createHmac("sha256", loginThrottleSecret())
    .update(`${scope}:${value}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Where the request came from
// ---------------------------------------------------------------------------

export interface RequestOrigin {
  /** the address the runtime itself attested — never something a caller typed */
  attestedAddress: string | null;
  /** the X-Forwarded-For header verbatim, which a caller may well have written */
  forwardedFor: string | null;
}

/**
 * Pull both facts out of the request without trusting either yet.
 *
 * Hono ships `getConnInfo` per adapter, but each one assumes its own runtime
 * and throws outright on a shape it does not recognise — including the plain
 * `app.request()` the test suite uses. A login route may not throw because it
 * could not work out an IP address, so this reads the same three places
 * defensively and answers null rather than raising.
 */
export function readRequestOrigin(c: Context): RequestOrigin {
  /* `c.env` is the adapter's bindings: the Lambda event under aws-lambda, the
     node http objects under @hono/node-server, and undefined under a bare
     fetch. None of that is in the Env type this app declares, so it is read as
     an untyped bag on purpose. */
  const env = c.env as Record<string, any> | undefined;
  const forwardedFor = c.req.header("x-forwarded-for") ?? null;

  const requestContext = env?.requestContext;
  /* API Gateway v1 (REST) and v2 (HTTP API / Function URL) disagree about
     where they put it, and ALB supplies neither. */
  const attested =
    requestContext?.identity?.sourceIp ??
    requestContext?.http?.sourceIp ??
    (env?.server ?? env)?.incoming?.socket?.remoteAddress ??
    null;

  return {
    attestedAddress: typeof attested === "string" && attested.length > 0 ? attested : null,
    forwardedFor,
  };
}

/**
 * How many proxy hops in front of this process belong to us.
 *
 * Null means nobody has said, which is not the same as zero — see the header.
 * An unparseable value is treated as "nobody has said" rather than as zero,
 * because a typo must not silently start counting failures against a
 * CloudFront edge address shared by every caller of the product.
 */
function trustedProxyHops(): number | null {
  const raw = process.env.WAKA_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return null;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 0) return null;
  return hops;
}

/**
 * The source address to count against, or null when we decline to guess.
 *
 * Declining is the honest answer where the topology has not been declared:
 * every candidate is then either shared by the whole world (the edge address)
 * or writable by the caller (the header), and counting against either one
 * throttles the wrong people.
 */
export function resolveLoginSource(origin: RequestOrigin): string | null {
  const hops = trustedProxyHops();
  if (hops === null) return null;
  if (hops === 0) return origin.attestedAddress;

  const chain = (origin.forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  /* Counted from the right: the rightmost entry is the one our nearest proxy
     appended, and every entry to the left of the hops we trust was written by
     something we do not control. A chain shorter than the declared hops means
     the request did not come through them, so there is nothing attested to
     count against. */
  const index = chain.length - hops;
  return index >= 0 ? (chain[index] ?? null) : null;
}

// ---------------------------------------------------------------------------
// The device credential
// ---------------------------------------------------------------------------

function deviceSignature(deviceId: string, expiresAt: number, identifier: string): string {
  return createHmac("sha256", loginThrottleSecret())
    .update(`${deviceId}.${expiresAt}.${identifier}`)
    .digest("hex");
}

/**
 * Mint the credential that says "this browser has signed in as this address".
 *
 * Bound to the identifier, so a cookie earned on one account proves nothing
 * about another — otherwise anyone with any account here could mint themselves
 * an exemption and the budget would protect nobody. It carries no claim beyond
 * that: it is not a session, it authenticates nothing, and holding one still
 * requires the password to get in.
 *
 * One credential per browser. A browser shared by two accounts keeps the one
 * from the more recent login; the other person is then an unrecognised browser
 * until they sign in again, which costs them nothing unless their address is
 * under attack at that moment.
 */
export function mintLoginDeviceCredential(
  identifier: string,
  deps: { now?: Date } = {},
): string {
  const now = deps.now ?? new Date();
  const deviceId = randomBytes(16).toString("base64url");
  const expiresAt = now.getTime() + LOGIN_DEVICE_TTL_MS;
  return `${deviceId}.${expiresAt}.${deviceSignature(deviceId, expiresAt, identifier)}`;
}

/**
 * Read a presented credential, or null if it does not hold up.
 *
 * Null on anything doubtful — wrong shape, expired, wrong address, bad
 * signature — because the only consequence of null is that the caller is
 * treated as a browser we have not seen, which is the safe side.
 */
export function readLoginDeviceCredential(
  presented: string | undefined | null,
  identifier: string,
  deps: { now?: Date } = {},
): string | null {
  if (!presented) return null;
  const now = deps.now ?? new Date();

  const parts = presented.split(".");
  if (parts.length !== 3) return null;
  const [deviceId, rawExpiresAt, signature] = parts as [string, string, string];

  const expiresAt = Number(rawExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return null;

  const expected = deviceSignature(deviceId, expiresAt, identifier);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return deviceId;
}

/**
 * The Set-Cookie value carrying a device credential.
 *
 * Attributes mirror the session cookie deliberately: httpOnly so no script can
 * read it, SameSite=Lax, and Secure decided by the caller rather than by this
 * module — `wantsSecureCookie` lives in lib/auth.ts and stays the one place
 * that decision is made.
 */
export function buildLoginDeviceCookie(
  value: string,
  options: { secure: boolean },
): string {
  const parts = [
    `${LOGIN_DEVICE_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(LOGIN_DEVICE_TTL_MS / 1000)}`,
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

// ---------------------------------------------------------------------------
// Reading, judging, and recording
// ---------------------------------------------------------------------------

export interface LoginAttempt {
  /** the normalised address the caller typed, whether or not it has an account */
  identifier: string;
  /** the source to count against, or null when the topology says not to guess */
  source: string | null;
  /** the device id from a credential that verified, or null */
  deviceId: string | null;
}

interface ThrottleBucket {
  scope: LoginThrottleScope;
  keyHash: string;
  budget: number;
  failures: number;
  windowStartedAt: Date;
}

/**
 * What the buckets said, carried from the check to the record.
 *
 * The route hands this object back after bcrypt rather than re-reading: the
 * counts cannot have moved in a way that matters across one hash, and a second
 * round-trip on every wrong password is a cost paid at exactly the moment
 * someone is trying to make us do work.
 */
export interface LoginThrottleReading {
  now: Date;
  buckets: ThrottleBucket[];
  recognisedDevice: boolean;
}

export interface LoginThrottleVerdict {
  refused: boolean;
  /** seconds until the offending window closes; 0 when nothing is refused */
  retryAfterSeconds: number;
}

/** Read every bucket this attempt touches in one round-trip. */
export async function readLoginThrottle(
  db: WakaDb,
  attempt: LoginAttempt,
  deps: { now?: Date } = {},
): Promise<LoginThrottleReading> {
  const now = deps.now ?? new Date();

  const wanted: Array<Omit<ThrottleBucket, "failures" | "windowStartedAt">> = [
    {
      scope: "identifier",
      keyHash: bucketKeyHash("identifier", attempt.identifier),
      budget: IDENTIFIER_FAILURE_BUDGET,
    },
  ];
  if (attempt.source) {
    wanted.push({
      scope: "source",
      keyHash: bucketKeyHash("source", attempt.source),
      budget: SOURCE_FAILURE_BUDGET,
    });
  }
  if (attempt.deviceId) {
    wanted.push({
      scope: "device",
      keyHash: bucketKeyHash("device", attempt.deviceId),
      budget: DEVICE_FAILURE_BUDGET,
    });
  }

  const rows = await db
    .select({
      keyHash: loginFailures.keyHash,
      failures: loginFailures.failures,
      windowStartedAt: loginFailures.windowStartedAt,
    })
    .from(loginFailures)
    .where(inArray(loginFailures.keyHash, wanted.map((bucket) => bucket.keyHash)));

  const stored = new Map(rows.map((row) => [row.keyHash, row]));

  return {
    now,
    recognisedDevice: attempt.deviceId !== null,
    buckets: wanted.map((bucket) => {
      const row = stored.get(bucket.keyHash);
      /* A window that has run out is not decayed, it is discarded: the row is
         still there but it describes a period that is over, so the attempt
         starts a fresh window rather than inheriting a stale count. */
      const live =
        row !== undefined &&
        now.getTime() - row.windowStartedAt.getTime() < LOGIN_FAILURE_WINDOW_MS;
      return {
        ...bucket,
        failures: live ? row.failures : 0,
        windowStartedAt: live ? row.windowStartedAt : now,
      };
    }),
  };
}

/**
 * May this attempt proceed to the password check?
 *
 * Pure, and the whole policy: a recognised browser answers only to its own
 * bucket, everyone else answers to the address's and the source's. That single
 * branch is what makes the address budget something an attacker cannot aim at
 * the person who owns the address.
 */
export function judgeLoginThrottle(reading: LoginThrottleReading): LoginThrottleVerdict {
  const answerable = reading.buckets.filter((bucket) =>
    reading.recognisedDevice ? bucket.scope === "device" : bucket.scope !== "device",
  );
  const spent = answerable.filter((bucket) => bucket.failures >= bucket.budget);
  if (spent.length === 0) return { refused: false, retryAfterSeconds: 0 };

  const clearsAt = Math.max(
    ...spent.map((bucket) => bucket.windowStartedAt.getTime() + LOGIN_FAILURE_WINDOW_MS),
  );
  return {
    refused: true,
    /* At least a second, so a caller who rounds down does not busy-loop. */
    retryAfterSeconds: Math.max(1, Math.ceil((clearsAt - reading.now.getTime()) / 1000)),
  };
}

/**
 * Charge a failed attempt to every bucket it touched.
 *
 * THE COUNT IS COMPUTED BY POSTGRES, NOT HERE. This is the whole of the
 * function and the reason it looks like SQL rather than like arithmetic.
 *
 * The first version of this wrote `failures: bucket.failures + 1` — a number
 * worked out in JavaScript from the read that `readLoginThrottle` did at the
 * top of the request. That read and this write are separated by the account
 * lookup and by a bcrypt compare, which is deliberately slow (~100-300ms in
 * production). Every attempt that arrives inside that gap reads the same count
 * and writes the same number back, so a hundred simultaneous guesses cost ONE
 * increment: the classic lost update, and precisely the shape of traffic a
 * brute-force actually has. Nobody guesses passwords one at a time and waits
 * for the answer. Serially the old code was correct, which is why a serial
 * test suite could not see it.
 *
 * So the new value is read and written inside one statement, where Postgres
 * holds the row lock, and every attempt costs exactly one increment no matter
 * how many are in flight.
 *
 * THE CASE IS NOT DECORATION. A bare `failures + 1` would be atomic and would
 * also be wrong: the JavaScript side is what used to reset a spent window (see
 * `readLoginThrottle`, which reports a closed window as zero), and once the
 * write no longer takes its value from that reading, nothing resets anything.
 * The count would climb forever, the bucket would sit permanently over budget,
 * and the throttle would turn into the indefinite lockout this whole design
 * exists to avoid. The window test therefore has to move into the statement
 * too, and both columns have to decide it from the same predicate — a row that
 * reset its count without resetting its window, or the reverse, is a bucket
 * that lies about which fifteen minutes it is describing.
 *
 * What remains, stated rather than hidden: the REFUSAL still reads a count
 * fetched before bcrypt, so attempts already in flight when a budget runs out
 * are still answered. The overshoot is bounded by how many requests an attacker
 * can hold open at once, and it does not compound — the next wave meets an
 * accurate count and is refused at the gate. Charging the attempt before the
 * compare instead would remove even that, and was rejected: the source bucket
 * would then be counting attempts rather than failures, and an office of thirty
 * people signing in successfully would spend SOURCE_FAILURE_BUDGET between
 * them. Refunding the successful ones brings back a second write on the hot
 * path and a decrement that has to reason about a window that may have turned
 * over underneath it. Bounded overshoot on a slow path is the cheaper trade.
 *
 * Deliberately not wrapped in a try/catch. A write that fails is a login that
 * was not throttled, and swallowing that would leave the route answering 401s
 * with the counter frozen at zero — the original hole, minus the evidence.
 */
export async function recordLoginFailure(
  db: WakaDb,
  reading: LoginThrottleReading,
): Promise<void> {
  /* Both timestamps go through the column's own encoder, the same way `lt()`
     below encodes its bound, so a raw template cannot end up handing the driver
     a shape the typed helpers never would. */
  const windowFloor = sql.param(
    new Date(reading.now.getTime() - LOGIN_FAILURE_WINDOW_MS),
    loginFailures.windowStartedAt,
  );
  const openedNow = sql.param(reading.now, loginFailures.windowStartedAt);
  /* One predicate, referenced by both columns, so they cannot disagree. */
  const windowHasClosed = sql`${loginFailures.windowStartedAt} < ${windowFloor}`;

  for (const bucket of reading.buckets) {
    await db
      .insert(loginFailures)
      .values({
        keyHash: bucket.keyHash,
        scope: bucket.scope,
        /* The INSERT branch is a bucket nobody has touched yet: one failure, in
           a window opening now. Note what is NOT here — no count carried over
           from `reading`. Past this point the reading contributes the key and
           the scope and nothing that can be stale. */
        failures: 1,
        windowStartedAt: reading.now,
        updatedAt: reading.now,
      })
      .onConflictDoUpdate({
        target: loginFailures.keyHash,
        set: {
          scope: bucket.scope,
          failures: sql`case when ${windowHasClosed} then 1 else ${loginFailures.failures} + 1 end`,
          windowStartedAt: sql`case when ${windowHasClosed} then ${openedNow} else ${loginFailures.windowStartedAt} end`,
          updatedAt: reading.now,
        },
      });
  }

  await pruneExpiredLoginFailures(db, reading.now);
}

/**
 * Forget the failures a successful login has just made irrelevant.
 *
 * The address's bucket and the browser's are cleared: whoever is holding this
 * password is the person the budget existed to protect, and making them wait
 * out a window they have just disproved would be the lockout by another route.
 *
 * The SOURCE bucket is deliberately left alone. Clearing it would let anyone
 * with an account of their own launder a run of guesses — fail nineteen times,
 * log into your own account, start again — which is the whole budget undone by
 * its own reset.
 *
 * Unlike `recordLoginFailure` this DOES write an absolute value, and that is
 * right rather than an oversight: zero is zero whatever the row held a moment
 * ago, so there is no earlier read for a concurrent writer to invalidate. If a
 * failure lands between this read and this write, the failure is the thing that
 * gets overwritten — the direction that favours the person who just proved they
 * know the password, which is the direction this file always takes.
 *
 * The skip below is likewise read from a reading that may be stale, so a
 * handful of failures arriving during one bcrypt can survive a successful
 * login. Left alone on purpose: that costs at most a slice of a fifteen-minute
 * budget, the person who just signed in walks away with a fresh device
 * credential and is exempt from it anyway, and buying the last few counts back
 * means a guarded UPDATE on every successful login for a case that only occurs
 * while an attack is already underway.
 */
export async function clearLoginFailures(
  db: WakaDb,
  reading: LoginThrottleReading,
): Promise<void> {
  for (const bucket of reading.buckets) {
    if (bucket.scope === "source") continue;
    /* Nothing to forget, and a write per successful login for the pleasure of
       storing a zero is a write nobody asked for. */
    if (bucket.failures === 0) continue;

    const row = {
      keyHash: bucket.keyHash,
      scope: bucket.scope,
      failures: 0,
      windowStartedAt: reading.now,
      updatedAt: reading.now,
    };
    await db
      .insert(loginFailures)
      .values(row)
      .onConflictDoUpdate({
        target: loginFailures.keyHash,
        set: {
          scope: row.scope,
          failures: row.failures,
          windowStartedAt: row.windowStartedAt,
          updatedAt: row.updatedAt,
        },
      });
  }
}

/**
 * At most one sweep per window per process.
 *
 * Rows here are keyed on things an unauthenticated stranger chooses — any
 * address they care to type — so unlike `sessions` or `cli_login_codes` the
 * row count is not bounded by the number of real users. They still have to
 * be reaped, and a sweep on every failed login would hand that same stranger a
 * delete against a growing table on demand. Once per window is enough: nothing
 * reads an expired row (`readLoginThrottle` discards a closed window), so this
 * is housekeeping, not correctness.
 *
 * The guard is process-local, which on Lambda means per container. That is
 * fine for housekeeping and would not be fine for the budget itself — which is
 * exactly why the budget lives in Postgres and only this does not.
 */
let lastPruneAtMs = 0;

async function pruneExpiredLoginFailures(db: WakaDb, now: Date): Promise<void> {
  if (now.getTime() - lastPruneAtMs < LOGIN_FAILURE_WINDOW_MS) return;
  lastPruneAtMs = now.getTime();
  try {
    await db
      .delete(loginFailures)
      .where(lt(loginFailures.windowStartedAt, new Date(now.getTime() - LOGIN_FAILURE_WINDOW_MS)));
  } catch (err) {
    /* Housekeeping must never be the reason a sign-in fails. */
    console.error("[login-throttle] could not reap expired failure buckets", err);
  }
}
