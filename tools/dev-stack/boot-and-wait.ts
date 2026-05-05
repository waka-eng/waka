#!/usr/bin/env tsx
/**
 * boot-and-wait.ts — boot the local SST dev stack, wait for the API and
 * StaticSite endpoints to become healthy, then hand off to a smoke-test
 * runner (or any other command).
 *
 * Why this exists
 * ---------------
 * `sst dev` is long-running and prints its `apiUrl` only after the Function
 * Live Lambda harness has finished initializing. CI and local smoke runners
 * need a deterministic "stack is ready, you may now hit it" gate, otherwise
 * tests race the boot sequence and flake on cold starts. This script is that
 * gate: it owns the lifecycle of `sst dev`, parses the API URL out of its
 * stdout, polls both `apiUrl/health` and the Vite StaticSite, and only then
 * spawns the handoff command. When the handoff exits, this script tears
 * `sst dev` down and exits with the handoff's exit code.
 *
 * Usage (from repo root)
 * ----------------------
 *   pnpm dev:boot -- pnpm --filter @waka/api exec tsx src/routes/inspirations.smoke.ts
 *   pnpm dev:boot                                   # boot only, then idle
 *   pnpm dev:boot --no-boot --api-url <u> -- <cmd>  # assume sst dev already running
 *
 * Flags
 * -----
 *   --api-url <url>          skip stdout parsing; use this URL for /health
 *   --api-health-path <p>    default /health
 *   --web-url <url>          default http://localhost:5173
 *   --no-boot                do NOT spawn `sst dev`; assume it's already up
 *                            (must pass --api-url with this)
 *   --timeout-ms <n>         total wait budget for both endpoints; default 180000
 *   --boot-cmd <argv>        override the boot command (default `pnpm sst dev`)
 *   --                       everything after this is the handoff command
 *
 * Exit codes
 * ----------
 *   0   stack came up healthy AND handoff (if any) exited 0
 *   1   timeout, parse failure, or sst dev died before becoming ready
 *   N   handoff command's own non-zero exit code is propagated verbatim
 *
 * Environment passed to the handoff
 * ---------------------------------
 *   WAKA_API_URL          e.g. https://xxx.lambda-url.us-west-2.on.aws
 *   WAKA_API_HEALTH_URL   e.g. https://xxx.lambda-url.../health
 *   WAKA_WEB_URL          e.g. http://localhost:5173
 *
 * Design notes
 * ------------
 * - We tee `sst dev`'s stdout/stderr through to our own streams so the user
 *   still sees the SST log noise (Live Lambda invocations, build errors, etc.).
 * - API URL detection uses a tolerant regex against the `outputs:` block SST
 *   prints once the stack has converged. We accept both `apiUrl: <url>` and
 *   `ApiUrl: <url>` casings to insulate against future SST cosmetic changes.
 * - Polling uses HEAD/GET with a short per-request timeout so a frozen Lambda
 *   doesn't stall the wait loop. We treat any 2xx/3xx/4xx as "process is
 *   responding" — we only retry on network errors and 5xx.
 * - We do NOT use SIGKILL on shutdown. SIGINT first, give SST a grace window
 *   to clean up its own subprocesses (esbuild watcher, vite, etc.), then fall
 *   back to SIGTERM. This avoids leaving orphan vite/esbuild processes behind.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

interface ParsedArgs {
  apiUrl?: string;
  apiHealthPath: string;
  webUrl: string;
  noBoot: boolean;
  timeoutMs: number;
  bootCmd: string[];
  handoff: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    apiHealthPath: "/health",
    webUrl: "http://localhost:5173",
    noBoot: false,
    timeoutMs: 180_000,
    bootCmd: ["pnpm", "sst", "dev"],
    handoff: [],
  };

  // Everything after a literal `--` token is the handoff command. We carve
  // it off first so the flag parser below never has to worry about flag-like
  // tokens (e.g. `--filter`) belonging to the handoff.
  const sepIdx = argv.indexOf("--");
  const flags = sepIdx >= 0 ? argv.slice(0, sepIdx) : argv.slice();
  args.handoff = sepIdx >= 0 ? argv.slice(sepIdx + 1) : [];

  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    const next = (): string => {
      const v = flags[++i];
      if (v === undefined) {
        throw new Error(`Flag ${flag} requires a value`);
      }
      return v;
    };
    switch (flag) {
      case "--api-url":
        args.apiUrl = next();
        break;
      case "--api-health-path":
        args.apiHealthPath = next();
        break;
      case "--web-url":
        args.webUrl = next();
        break;
      case "--no-boot":
        args.noBoot = true;
        break;
      case "--timeout-ms": {
        const n = Number(next());
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`--timeout-ms must be a positive number, got ${n}`);
        }
        args.timeoutMs = n;
        break;
      }
      case "--boot-cmd": {
        // Single-string form: split on whitespace. Good enough for our use;
        // anyone needing complex quoting can use --no-boot and run the boot
        // command in a separate terminal.
        args.bootCmd = next().split(/\s+/u).filter(Boolean);
        if (args.bootCmd.length === 0) {
          throw new Error("--boot-cmd cannot be empty");
        }
        break;
      }
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      // intentional fallthrough not needed; process.exit terminates
      // eslint-disable-next-line no-fallthrough
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }
  }

  if (args.noBoot && !args.apiUrl) {
    throw new Error("--no-boot requires --api-url <url>");
  }

  return args;
}

function printHelp(): void {
  // Keep this in sync with the file-header docstring.
  const lines = [
    "Usage: tsx tools/dev-stack/boot-and-wait.ts [flags] [-- <handoff-cmd>]",
    "",
    "Flags:",
    "  --api-url <url>          Skip parsing; use this API URL",
    "  --api-health-path <p>    Path appended to the API URL for the health probe (default /health)",
    "  --web-url <url>          StaticSite/Vite dev URL to probe (default http://localhost:5173)",
    "  --no-boot                Do NOT spawn `sst dev`; requires --api-url",
    "  --timeout-ms <n>         Total wait budget; default 180000",
    "  --boot-cmd <argv>        Override the boot command; default \"pnpm sst dev\"",
    "  -h, --help               Show this help",
    "",
    "Handoff command runs once both endpoints respond. Its exit code is propagated.",
  ];
  console.log(lines.join("\n"));
}

// ---------------------------------------------------------------------------
// SST stdout parsing
// ---------------------------------------------------------------------------

/**
 * Match `apiUrl: https://...` (case-insensitive on the key) inside the
 * `outputs:` block SST prints once the stack has converged. The URL must be
 * a full http(s) URL — `webUrl: -` (the StaticSite dev placeholder) must
 * never accidentally satisfy this match, which is why we anchor on `http`.
 */
const API_URL_REGEX = /\bapiUrl\s*[:=]\s*"?(?<url>https?:\/\/[^\s"']+)"?/iu;

function findApiUrl(chunk: string): string | null {
  const m = API_URL_REGEX.exec(chunk);
  return m?.groups?.url ?? null;
}

// ---------------------------------------------------------------------------
// Health polling
// ---------------------------------------------------------------------------

interface PollOptions {
  url: string;
  label: string;
  signal: AbortSignal;
  /** Per-attempt request timeout. */
  attemptTimeoutMs?: number;
  /** Sleep between attempts. */
  intervalMs?: number;
}

/**
 * Poll `url` until it returns ANY non-5xx response or `signal` aborts.
 *
 * "Any non-5xx" is intentionally permissive: we want to know the *process*
 * is up, not that the route is happy with our request. The Vite dev server,
 * for instance, returns 200 on `/`; the API's `/health` returns 200; if a
 * future probe URL returns 401 (because it requires auth), that still
 * proves the listener is alive and serving HTTP.
 */
async function pollUntilHealthy(opts: PollOptions): Promise<void> {
  const interval = opts.intervalMs ?? 1_000;
  const attemptTimeout = opts.attemptTimeoutMs ?? 4_000;

  let lastErr: unknown = null;
  let attempts = 0;

  while (!opts.signal.aborted) {
    attempts++;
    const ac = new AbortController();
    const onParentAbort = (): void => ac.abort();
    opts.signal.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => ac.abort(), attemptTimeout);
    try {
      const res = await fetch(opts.url, { method: "GET", signal: ac.signal });
      if (res.status < 500) {
        // Drain the body so the socket can be reused / closed cleanly. We
        // don't care about the contents.
        await res.text().catch(() => undefined);
        console.log(
          `[boot] ${opts.label} healthy (${res.status}) after ${attempts} attempt(s): ${opts.url}`,
        );
        return;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
      opts.signal.removeEventListener("abort", onParentAbort);
    }

    // Log every ~10s so a stuck wait isn't silent.
    if (attempts % 10 === 0) {
      const reason = lastErr instanceof Error ? lastErr.message : String(lastErr);
      console.log(`[boot] still waiting on ${opts.label} (${opts.url}) — ${reason}`);
    }

    try {
      await sleep(interval, undefined, { signal: opts.signal });
    } catch {
      // signal aborted during sleep
    }
  }

  const reason = lastErr instanceof Error ? lastErr.message : String(lastErr ?? "aborted");
  throw new Error(`[boot] gave up waiting on ${opts.label} (${opts.url}): ${reason}`);
}

// ---------------------------------------------------------------------------
// SST lifecycle
// ---------------------------------------------------------------------------

interface BootedStack {
  /** The `sst dev` child process, or undefined if --no-boot. */
  proc: ChildProcess | undefined;
  /** Resolves with the API URL once parsed (or immediately if --api-url). */
  apiUrlPromise: Promise<string>;
  /** Rejects if `sst dev` exits before the API URL is parsed. */
  bootProc: Promise<never> | Promise<void>;
}

function startSstDev(args: ParsedArgs): BootedStack {
  if (args.noBoot) {
    if (!args.apiUrl) {
      throw new Error("--no-boot requires --api-url");
    }
    return {
      proc: undefined,
      apiUrlPromise: Promise.resolve(args.apiUrl),
      bootProc: new Promise(() => {
        /* never resolves */
      }),
    };
  }

  const [bin, ...rest] = args.bootCmd;
  console.log(`[boot] spawning: ${args.bootCmd.join(" ")}`);

  const proc = spawn(bin, rest, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let resolveApi!: (url: string) => void;
  let rejectApi!: (err: Error) => void;
  const apiUrlPromise = args.apiUrl
    ? Promise.resolve(args.apiUrl)
    : new Promise<string>((res, rej) => {
        resolveApi = res;
        rejectApi = rej;
      });

  let urlResolved = args.apiUrl !== undefined;

  const tee = (stream: NodeJS.ReadableStream, sink: NodeJS.WritableStream): void => {
    stream.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      sink.write(text);
      if (!urlResolved) {
        const found = findApiUrl(text);
        if (found) {
          urlResolved = true;
          console.log(`[boot] parsed apiUrl from sst dev stdout: ${found}`);
          resolveApi(found);
        }
      }
    });
  };

  if (proc.stdout) tee(proc.stdout, process.stdout);
  if (proc.stderr) tee(proc.stderr, process.stderr);

  // If sst dev dies before we ever saw an apiUrl, fail fast — there is no
  // recovery and we should not keep polling.
  const bootProc = new Promise<void>((_resolve, reject) => {
    proc.on("exit", (code, signal) => {
      const msg = `sst dev exited (code=${code ?? "null"}, signal=${signal ?? "null"})`;
      console.log(`[boot] ${msg}`);
      if (!urlResolved && rejectApi) {
        rejectApi(new Error(msg));
      }
      reject(new Error(msg));
    });
    proc.on("error", (err) => {
      console.error(`[boot] failed to spawn sst dev: ${err.message}`);
      if (!urlResolved && rejectApi) {
        rejectApi(err);
      }
      reject(err);
    });
  });

  return { proc, apiUrlPromise, bootProc };
}

/**
 * Send SIGINT, wait up to `graceMs`, then SIGTERM if still alive.
 *
 * SIGINT is preferred because SST treats it as "user pressed Ctrl-C" and
 * runs its own cleanup (kills vite, esbuild watchers, etc.). Going straight
 * to SIGTERM/SIGKILL leaves orphan node/esbuild processes behind that bind
 * port 5173 and break the next `pnpm dev`.
 */
async function shutdown(proc: ChildProcess, graceMs = 8_000): Promise<void> {
  if (proc.exitCode !== null || proc.killed) return;
  console.log("[boot] sending SIGINT to sst dev...");
  proc.kill("SIGINT");
  const exited = await Promise.race([
    new Promise<boolean>((res) => proc.once("exit", () => res(true))),
    sleep(graceMs).then(() => false),
  ]);
  if (!exited) {
    console.log("[boot] grace expired; sending SIGTERM");
    proc.kill("SIGTERM");
  }
}

// ---------------------------------------------------------------------------
// Handoff
// ---------------------------------------------------------------------------

function runHandoff(
  cmd: string[],
  env: Record<string, string>,
): Promise<number> {
  const [bin, ...rest] = cmd;
  console.log(`[boot] handoff: ${cmd.join(" ")}`);
  const child = spawn(bin, rest, {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  return new Promise((resolve) => {
    child.on("exit", (code, signal) => {
      if (code !== null) {
        resolve(code);
      } else {
        // Translate signals to the conventional 128 + signo. We don't have
        // signo lookup readily, so 1 is a safe non-zero fallback.
        console.log(`[boot] handoff terminated by signal ${signal}`);
        resolve(1);
      }
    });
    child.on("error", (err) => {
      console.error(`[boot] handoff failed to spawn: ${err.message}`);
      resolve(127);
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Master abort: anything that fails (timeout, sst dying, polling failure)
  // aborts in-flight polls so they unblock and we can shut down cleanly.
  const masterAc = new AbortController();
  const timeoutHandle = setTimeout(() => {
    console.error(`[boot] timeout: stack did not become healthy in ${args.timeoutMs}ms`);
    masterAc.abort();
  }, args.timeoutMs);
  // Don't let the timer keep the process alive if everything else has settled.
  timeoutHandle.unref?.();

  const { proc, apiUrlPromise, bootProc } = startSstDev(args);

  // Forward Ctrl-C / SIGTERM to a clean shutdown of sst dev.
  let shuttingDown = false;
  const installSignalHandler = (sig: NodeJS.Signals): void => {
    process.on(sig, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[boot] received ${sig}; shutting down`);
      masterAc.abort();
      if (proc) void shutdown(proc);
    });
  };
  installSignalHandler("SIGINT");
  installSignalHandler("SIGTERM");

  let exitCode = 0;
  try {
    // Race apiUrlPromise against bootProc so an early-dying sst surfaces
    // immediately instead of waiting for the polling timeout.
    const apiUrl = await Promise.race([apiUrlPromise, bootProc as Promise<string>]);
    if (!apiUrl) {
      throw new Error("apiUrl resolved to empty string");
    }
    const apiHealthUrl = `${apiUrl.replace(/\/$/u, "")}${args.apiHealthPath}`;

    console.log(`[boot] probing API:  ${apiHealthUrl}`);
    console.log(`[boot] probing Web:  ${args.webUrl}`);

    // Poll both in parallel; any rejection (incl. sst dying) cancels the rest.
    await Promise.race([
      Promise.all([
        pollUntilHealthy({ url: apiHealthUrl, label: "API", signal: masterAc.signal }),
        pollUntilHealthy({ url: args.webUrl, label: "Web", signal: masterAc.signal }),
      ]),
      bootProc,
    ]);

    console.log("[boot] stack is healthy ✅");

    if (args.handoff.length === 0) {
      console.log(
        "[boot] no handoff command supplied — leaving sst dev running. Press Ctrl-C to stop.",
      );
      // Park forever (until SIGINT). bootProc rejects if sst dies.
      await bootProc;
      return;
    }

    exitCode = await runHandoff(args.handoff, {
      WAKA_API_URL: apiUrl,
      WAKA_API_HEALTH_URL: apiHealthUrl,
      WAKA_WEB_URL: args.webUrl,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[boot] error: ${msg}`);
    exitCode = exitCode || 1;
  } finally {
    clearTimeout(timeoutHandle);
    if (proc && !shuttingDown) {
      shuttingDown = true;
      await shutdown(proc);
    }
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
