/**
 * S3 SDK mock for vitest specs.
 *
 * Why this exists
 * ---------------
 * `src/routes/attachments.ts` reaches AWS in three places:
 *
 *   1. `getSignedUrl(s3, new PutObjectCommand(...))` — mints the presigned
 *      PUT URL the browser will upload to. Pure local SigV4 computation,
 *      no network, but it still requires AWS credentials in the provider
 *      chain or it hangs trying to reach the IMDS endpoint on a laptop.
 *   2. `s3.send(new HeadObjectCommand(...))` — confirms the upload landed
 *      before the finalize endpoint persists the row. This DOES hit the
 *      real S3 endpoint over HTTPS and will fail (or worse, succeed against
 *      a real bucket if creds are present) when run in tests.
 *   3. `new S3Client(...)` — constructor side-effects can read `~/.aws/`
 *      and reach for IMDS during cold start.
 *
 * The Seed contract requires the test suite to run hermetically in `pnpm
 * test`: no AWS account, no IMDS reach, no real bucket. We therefore mock
 * the SDK at the module boundary so the production code path is exercised
 * end-to-end up to the SDK call, and only the SDK call returns a scripted
 * fake.
 *
 * Why module mock and not dependency injection
 * --------------------------------------------
 * `attachments.ts` constructs its `S3Client` inside a private `getS3()` and
 * imports `PutObjectCommand` / `HeadObjectCommand` / `getSignedUrl` directly
 * by name. Refactoring production code to accept an injected client just for
 * the test would muddy the production module for no behavioural gain.
 * `vi.mock("@aws-sdk/client-s3", ...)` lets us replace the named exports
 * without touching production source, which is the correct trade-off here.
 *
 * Public surface
 * --------------
 * Tests wire this in with two `vi.mock` calls, then read/script behaviour
 * via the shared `s3MockState` object:
 *
 *   import { vi, beforeAll, beforeEach, afterAll } from "vitest";
 *   import {
 *     s3ClientModuleFactory,
 *     s3PresignerModuleFactory,
 *     s3MockState,
 *   } from "./mocks/s3.js";
 *
 *   vi.mock("@aws-sdk/client-s3", s3ClientModuleFactory);
 *   vi.mock("@aws-sdk/s3-request-presigner", s3PresignerModuleFactory);
 *
 *   beforeEach(() => s3MockState.reset());
 *
 *   it("issues a presigned PUT", async () => {
 *     s3MockState.signedUrl = "https://example.test/signed";
 *     const res = await app.request("/attachments/presign", { ... });
 *     expect(s3MockState.calls.getSignedUrl).toHaveLength(1);
 *     expect(s3MockState.calls.getSignedUrl[0].command).toBeInstanceOf(
 *       s3MockState.PutObjectCommand,
 *     );
 *   });
 *
 * `vi.mock` is hoisted by vitest's transformer so the factory references
 * here resolve before `attachments.ts` reads them. The factory functions
 * MUST be plain (sync) functions returning the module shape — async
 * factories are also accepted but add nothing for our use case.
 *
 * Lifecycle
 * ---------
 * The mock is process-global (the AWS SDK is a singleton from Node's POV).
 * Use `s3MockState.reset()` in a `beforeEach` to clear the call log + any
 * scripted overrides between cases. There is no install/restore — `vi.mock`
 * already handles that at the module-graph level.
 */

// ---------------------------------------------------------------------------
// Public state: the call log + scripted-response knobs
// ---------------------------------------------------------------------------

/**
 * Recorded `s3.send(command)` invocation. We keep the full command object so
 * tests can introspect `command.input.Bucket`, `command.input.Key`, etc.
 * without depending on which AWS SDK version's input shape we're on.
 */
export interface S3SendCall {
  /** The raw command instance passed into `client.send`. */
  command: unknown;
  /** Constructor name of the command, e.g. `"PutObjectCommand"`. */
  commandName: string;
  /** Optional second arg passed to `send` (rarely used; captured for completeness). */
  options: unknown;
}

/**
 * Recorded `getSignedUrl(client, command, options)` invocation. Unlike
 * `s3.send`, the presigner is a free function so we record both arguments
 * positionally rather than wrapping them in a `client.foo` envelope.
 */
export interface GetSignedUrlCall {
  /** The S3 client passed to `getSignedUrl` (instance of mock `S3Client`). */
  client: unknown;
  /** The command to be signed (typically a `PutObjectCommand`). */
  command: unknown;
  /** Constructor name of the command, e.g. `"PutObjectCommand"`. */
  commandName: string;
  /** The options object (`{ expiresIn, signableHeaders, ... }`). */
  options: Record<string, unknown> | undefined;
}

/**
 * Tunable behaviour for the next `s3.send` call against a given command type.
 *
 *   - `success`: resolve with the supplied output (or `{}` if omitted). For
 *     `HeadObjectCommand` this signals "object exists" — the production code
 *     reads only the success/throw distinction, not any specific field.
 *   - `notFound`: throw a shaped error matching the AWS SDK's `NotFound`
 *     error class semantics. Drives the "missing → 404 finalize" branch.
 *   - `error`: throw a generic error. Drives the "indeterminate (creds /
 *     transport) → soft pass" branch in `verifyObjectExists`.
 */
export type S3SendOutcome =
  | { kind: "success"; output?: unknown }
  | { kind: "notFound"; message?: string }
  | { kind: "error"; name?: string; message?: string; httpStatusCode?: number };

/**
 * Shared mutable state. Tests read + write here to script behaviour and
 * inspect calls. Exported as a single object (not a bag of named exports)
 * so a `s3MockState.reset()` deep-resets every field consistently.
 */
export interface S3MockState {
  /** Constructor used by tests to assert on captured commands. */
  PutObjectCommand: PutObjectCommandCtor;
  /** Constructor used by tests to assert on captured commands. */
  HeadObjectCommand: HeadObjectCommandCtor;
  /** Constructor used by tests to assert on captured commands. */
  S3Client: S3ClientCtor;

  /**
   * URL `getSignedUrl` will resolve with on its next call. Exposed as a
   * field rather than a method-set so a `beforeEach` can simply assign:
   * `s3MockState.signedUrl = "https://..."` without thinking about queues.
   * Defaults to a synthetic but plausible URL containing the bucket + key
   * (so URL-shape assertions in tests have something realistic to grep for).
   */
  signedUrl: string | ((command: unknown) => string);

  /**
   * Outcome the next `s3.send(PutObjectCommand)` call should produce.
   * (Production code does not actually call `s3.send(PutObjectCommand)` —
   * presigning is a local SigV4 computation — but we expose this hook for
   * forward compatibility if a future endpoint uploads server-side.)
   */
  putObjectOutcome: S3SendOutcome;

  /**
   * Outcome the next `s3.send(HeadObjectCommand)` call should produce. This
   * is the primary knob for finalize-endpoint tests:
   *
   *   - `{ kind: "success" }` → object exists, finalize 201s.
   *   - `{ kind: "notFound" }` → object missing, finalize 404s.
   *   - `{ kind: "error" }` → indeterminate, finalize falls through to 201
   *     (with a console.warn from production code).
   *
   * Defaults to `{ kind: "success" }` so a test that doesn't care about the
   * HEAD path doesn't have to set it.
   */
  headObjectOutcome: S3SendOutcome;

  /** Per-method call log. Cleared by `reset()`. */
  calls: {
    send: S3SendCall[];
    getSignedUrl: GetSignedUrlCall[];
    s3ClientConstructor: { config: unknown }[];
  };

  /** Reset the call log + scripted outcomes back to defaults. */
  reset(): void;
}

// Forward declarations so the state interface above can reference the
// constructor types defined below. They are class types, so we type them
// structurally (a callable that returns a `Command` shape) rather than
// re-declaring the full SDK interface.
type PutObjectCommandCtor = new (input: PutObjectCommandInput) => MockCommand<
  "PutObjectCommand",
  PutObjectCommandInput
>;
type HeadObjectCommandCtor = new (input: HeadObjectCommandInput) => MockCommand<
  "HeadObjectCommand",
  HeadObjectCommandInput
>;
type S3ClientCtor = new (config?: unknown) => MockS3Client;

interface PutObjectCommandInput {
  Bucket?: string;
  Key?: string;
  Body?: unknown;
  ContentType?: string;
  ContentLength?: number;
  // Permissive — we don't model every PutObject input field, only the ones
  // production code actually sets. Unknown fields pass through to `input`.
  [k: string]: unknown;
}

interface HeadObjectCommandInput {
  Bucket?: string;
  Key?: string;
  [k: string]: unknown;
}

interface MockCommand<TName extends string, TInput> {
  /**
   * Name field deliberately distinct from `constructor.name` so a test that
   * minifies through esbuild (which can rewrite class names) still has a
   * stable string to match on. We also expose `constructor.name` for AWS
   * SDK compatibility.
   */
  __mockName: TName;
  input: TInput;
}

interface MockS3Client {
  /** Mock `send` — records the call, then resolves per the scripted outcome. */
  send(command: MockCommand<string, unknown>, options?: unknown): Promise<unknown>;
  /** Captured constructor config for assertion-from-test. */
  __config: unknown;
}

// ---------------------------------------------------------------------------
// Implementation: command + client classes
// ---------------------------------------------------------------------------

/**
 * Translate an `S3SendOutcome` into a resolution / rejection. Centralised so
 * the same logic drives every command type's send path.
 */
function applyOutcome(outcome: S3SendOutcome): Promise<unknown> {
  switch (outcome.kind) {
    case "success":
      return Promise.resolve(outcome.output ?? {});
    case "notFound": {
      // Shape matches the structural check in `verifyObjectExists`:
      //   const status = e?.$metadata?.httpStatusCode;
      //   if (status === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey")
      //     return "missing";
      // We set both `name` AND `$metadata.httpStatusCode` so either branch
      // of that disjunction satisfies, regardless of AWS SDK version.
      const err = Object.assign(
        new Error(outcome.message ?? "The specified key does not exist."),
        {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 },
        },
      );
      return Promise.reject(err);
    }
    case "error": {
      const err = Object.assign(
        new Error(outcome.message ?? "Mocked S3 error"),
        {
          name: outcome.name ?? "MockS3Error",
          $metadata: { httpStatusCode: outcome.httpStatusCode ?? 500 },
        },
      );
      return Promise.reject(err);
    }
  }
}

/**
 * The single source of truth for the call log + scripted state. Defined as
 * a `let` (not `const`) so `reset()` can re-assign nested fields without
 * leaking references between test cases.
 */
function makeInitialState(): Omit<
  S3MockState,
  "PutObjectCommand" | "HeadObjectCommand" | "S3Client" | "reset"
> {
  return {
    // Default URL embeds a tag so a test that forgets to override gets a
    // recognisable, debuggable URL in error output rather than `undefined`.
    signedUrl: "https://mock-s3.test/signed-default",
    putObjectOutcome: { kind: "success" },
    headObjectOutcome: { kind: "success" },
    calls: {
      send: [],
      getSignedUrl: [],
      s3ClientConstructor: [],
    },
  };
}

// Build the canonical state object up-front, then attach the constructors
// after we declare them (the constructors close over `s3MockState` so they
// must come after the declaration).
export const s3MockState: S3MockState = {
  ...makeInitialState(),
  // Constructors get patched in below; placeholder values keep the type
  // satisfied during module init.
  PutObjectCommand: null as unknown as PutObjectCommandCtor,
  HeadObjectCommand: null as unknown as HeadObjectCommandCtor,
  S3Client: null as unknown as S3ClientCtor,
  reset() {
    const fresh = makeInitialState();
    s3MockState.signedUrl = fresh.signedUrl;
    s3MockState.putObjectOutcome = fresh.putObjectOutcome;
    s3MockState.headObjectOutcome = fresh.headObjectOutcome;
    // Mutate in-place so any test that captured a reference to `calls`
    // still sees the cleared array.
    s3MockState.calls.send.length = 0;
    s3MockState.calls.getSignedUrl.length = 0;
    s3MockState.calls.s3ClientConstructor.length = 0;
  },
};

// ---------------------------------------------------------------------------
// Mock command + client classes
// ---------------------------------------------------------------------------

/**
 * Mock `PutObjectCommand`. The real SDK exposes `.input` so we mirror that
 * field — `attachments.ts` constructs the command and hands it to
 * `getSignedUrl`, which in our mock reads `command.input` to compose the
 * synthetic URL.
 */
class MockPutObjectCommand
  implements MockCommand<"PutObjectCommand", PutObjectCommandInput>
{
  readonly __mockName = "PutObjectCommand" as const;
  constructor(public input: PutObjectCommandInput) {}
}

class MockHeadObjectCommand
  implements MockCommand<"HeadObjectCommand", HeadObjectCommandInput>
{
  readonly __mockName = "HeadObjectCommand" as const;
  constructor(public input: HeadObjectCommandInput) {}
}

/**
 * Mock `S3Client`. Records its constructor config (so a test can assert
 * `s3MockState.calls.s3ClientConstructor[0].config.region === "us-west-2"`)
 * and routes `send` through the per-command outcome scripts.
 */
class MockS3ClientImpl implements MockS3Client {
  public __config: unknown;
  constructor(config?: unknown) {
    this.__config = config;
    s3MockState.calls.s3ClientConstructor.push({ config });
  }

  async send(
    command: MockCommand<string, unknown>,
    options?: unknown,
  ): Promise<unknown> {
    const commandName =
      (command as { __mockName?: string })?.__mockName ??
      command?.constructor?.name ??
      "UnknownCommand";

    s3MockState.calls.send.push({ command, commandName, options });

    if (commandName === "HeadObjectCommand") {
      return applyOutcome(s3MockState.headObjectOutcome);
    }
    if (commandName === "PutObjectCommand") {
      return applyOutcome(s3MockState.putObjectOutcome);
    }
    // Default: succeed with empty output. Unknown commands shouldn't fail
    // the test outright — that would break forward-compat when production
    // adds a new SDK call. The call is captured so a test that *does* care
    // can still assert on it.
    return {};
  }
}

// Patch the real ctors into the state object. This indirection (declaring
// the state first, then attaching ctors) is what lets the ctors close over
// `s3MockState` for call recording without a circular declaration error.
s3MockState.PutObjectCommand =
  MockPutObjectCommand as unknown as PutObjectCommandCtor;
s3MockState.HeadObjectCommand =
  MockHeadObjectCommand as unknown as HeadObjectCommandCtor;
s3MockState.S3Client = MockS3ClientImpl as unknown as S3ClientCtor;

// ---------------------------------------------------------------------------
// vi.mock factories
// ---------------------------------------------------------------------------

/**
 * Module factory for `vi.mock("@aws-sdk/client-s3", s3ClientModuleFactory)`.
 *
 * Returns the named exports `attachments.ts` actually imports. We do NOT
 * try to mirror the entire `@aws-sdk/client-s3` surface — only the symbols
 * production code reads. If a future code path imports a new symbol from
 * this module the import will throw at module-eval time, which is the
 * correct loud failure.
 */
export function s3ClientModuleFactory(): {
  S3Client: S3ClientCtor;
  PutObjectCommand: PutObjectCommandCtor;
  HeadObjectCommand: HeadObjectCommandCtor;
} {
  return {
    S3Client: s3MockState.S3Client,
    PutObjectCommand: s3MockState.PutObjectCommand,
    HeadObjectCommand: s3MockState.HeadObjectCommand,
  };
}

/**
 * Module factory for `vi.mock("@aws-sdk/s3-request-presigner", ...)`.
 *
 * `getSignedUrl(client, command, options)` is the only symbol production
 * code uses from this module. The mock:
 *
 *   1. Records the call (client + command + options) in `s3MockState.calls`.
 *   2. Resolves with `s3MockState.signedUrl`. Tests override this field
 *      (string, or function-of-command) to drive their assertions.
 */
export function s3PresignerModuleFactory(): {
  getSignedUrl: (
    client: unknown,
    command: unknown,
    options?: Record<string, unknown>,
  ) => Promise<string>;
} {
  return {
    async getSignedUrl(client, command, options) {
      const commandName =
        (command as { __mockName?: string })?.__mockName ??
        (command as { constructor?: { name?: string } })?.constructor?.name ??
        "UnknownCommand";

      s3MockState.calls.getSignedUrl.push({
        client,
        command,
        commandName,
        options,
      });

      const url = s3MockState.signedUrl;
      return typeof url === "function" ? url(command) : url;
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience: pre-built outcomes
// ---------------------------------------------------------------------------

/**
 * Sugar mirroring the gemini.ts mock's `geminiLabel(...)` helpers. They keep
 * test code readable:
 *
 *   s3MockState.headObjectOutcome = s3HeadExists();
 *   s3MockState.headObjectOutcome = s3HeadMissing();
 *   s3MockState.headObjectOutcome = s3HeadIndeterminate();
 */
export const s3SendSuccess = (output: unknown = {}): S3SendOutcome => ({
  kind: "success",
  output,
});

export const s3HeadExists = (): S3SendOutcome => ({ kind: "success" });

export const s3HeadMissing = (
  message = "The specified key does not exist.",
): S3SendOutcome => ({ kind: "notFound", message });

export const s3HeadIndeterminate = (
  message = "Network unreachable",
): S3SendOutcome => ({ kind: "error", name: "TimeoutError", message });

/**
 * Build a deterministic synthetic signed URL for tests that want to assert
 * on URL shape without baking the random suffix into expectations. Mirrors
 * the production format `https://<bucket>.s3.<region>.amazonaws.com/<key>?...`
 * just enough that a `URL`-shape regression doesn't pass undetected.
 *
 * Pass to `s3MockState.signedUrl = signedUrlFor(...)` for per-call dynamic
 * URLs, or use the string form directly for static tests.
 */
export function signedUrlFor(
  bucket: string,
  region = "us-west-2",
): (command: unknown) => string {
  return (command) => {
    const input = (command as { input?: { Bucket?: string; Key?: string } })
      .input ?? {};
    const key = input.Key ?? "unknown-key";
    return (
      `https://${bucket}.s3.${region}.amazonaws.com/${encodeURI(key)}` +
      `?X-Amz-Signature=mock&X-Amz-Expires=300`
    );
  };
}
