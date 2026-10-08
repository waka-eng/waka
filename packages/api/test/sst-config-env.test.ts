import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sstConfig = readFileSync(resolve(__dirname, "../../../sst.config.ts"), "utf8");

describe("SST API admin route environment flags", () => {
  /*
    The two flags asserted here are the two the API actually reads
    (`isAdminBackgroundJobsEnabled`). Pinning the gate to the dev stages is the
    point: a flag that leaked into production would open the queue surface to
    anyone who reached it.
  */
  it("enables the admin route gates only for dev/development stages", () => {
    expect(sstConfig).toContain(
      'const isDevelopmentDomain = $app.stage === "development" || $app.stage === "dev";',
    );

    const devOnlyAdminFlags = sstConfig.match(
      /\.\.\.\(isDevelopmentDomain\s*\?\s*\{(?<body>[\s\S]*?)\}\s*:\s*\{\}\),/,
    );

    expect(devOnlyAdminFlags?.groups?.body).toEqual(
      expect.stringContaining('WAKA_ENABLE_ADMIN_ROUTES: "true"'),
    );
    expect(devOnlyAdminFlags?.groups?.body).toEqual(
      expect.stringContaining('WAKA_ENABLE_BACKGROUND_JOBS_ADMIN: "true"'),
    );
  });
});

describe("SST background job delivery", () => {
  /*
    Work is pushed, not polled: enqueueing wakes the worker directly, so a
    capture begins deriving in the same second and an idle deployment issues
    no queries at all — which is what lets a serverless Postgres sleep.

    The three parts below are one mechanism, and any one of them missing
    silently degrades every capture to "whenever the daily sweep runs":
    the API must know which function to wake, be allowed to wake it, and
    actually do so on enqueue.
  */
  const apiFunction = sstConfig.match(
    /new sst\.aws\.Function\("Api", \{(?<body>[\s\S]*?)\n    \}\);/,
  );

  it('pins native asynchronous retry delivery to two extra invocations',()=>{
    const worker=sstConfig.match(/new sst\.aws\.Function\("BackgroundWorker", \{(?<body>[\s\S]*?)\n    \}\);/);
    expect(worker?.groups?.body).toMatch(/retries:\s*2\s*,/);
  });

  it("tells the API which worker to wake", () => {
    expect(apiFunction?.groups?.body).toEqual(
      expect.stringContaining("WAKA_BACKGROUND_WORKER_FUNCTION: backgroundWorker.name"),
    );
  });

  it("lets the API invoke that worker", () => {
    expect(apiFunction?.groups?.body).toEqual(
      expect.stringContaining('actions: ["lambda:InvokeFunction"]'),
    );
    expect(apiFunction?.groups?.body).toEqual(
      expect.stringContaining("resources: [backgroundWorker.arn]"),
    );
  });

  it("wakes the worker from the enqueue path", () => {
    const queueSource = readFileSync(
      resolve(__dirname, "../src/lib/queue.ts"),
      "utf8",
    );
    expect(queueSource).toMatch(/else await wakeBackgroundWorker\(\)/);
    // A worker that wakes itself would start a fresh invocation per job it
    // enqueues, chaining without end; its own drain loop covers that instead.
    expect(queueSource).toMatch(/isBackgroundWorkerProcess/);
  });

  /*
    The sweep is the safety net for what a push cannot reach — a backoff that
    outlived its invocation, a row locked by a worker that died, a wake-up
    call that never landed. It may be infrequent; it may not be absent.
  */
  it("keeps a safety-net sweep enabled", () => {
    const backgroundJobDrain = sstConfig.match(
      /new sst\.aws\.Cron\("BackgroundJobDrain", \{(?<body>[\s\S]*?)\n    \}\);/,
    );

    expect(backgroundJobDrain?.groups?.body).toEqual(
      expect.stringContaining("enabled: true"),
    );
    expect(backgroundJobDrain?.groups?.body).toMatch(/schedule: "rate\(1 day\)"/);
  });

  /*
    Nothing polls behind the worker, so one invocation has to carry a whole
    chain: a derivation enqueues a synthesis, and stopping after one batch
    would strand the half the person actually reads.
  */
  it("drains until the queue is dry, bounded", () => {
    const workerSource = readFileSync(
      resolve(__dirname, "../src/background-worker.ts"),
      "utf8",
    );
    expect(workerSource).toMatch(/while \(passes < MAX_DRAIN_PASSES\)/);
    // Both halves of the stop condition. "Claimed nothing" stopped meaning
    // "the queue is dry" when the per-account model budget landed: a pass
    // also claims nothing when it spends its whole deferral allowance
    // stepping over accounts at their cap, with somebody else's runnable job
    // waiting right behind them. The behaviour is pinned in
    // src/background-worker.test.ts; the shape is pinned here because this is
    // the test that reads the loop.
    expect(workerSource).toMatch(
      /if \(result\.claimed === 0 && result\.deferred === 0\) break/,
    );
  });
});

describe("SST synthesis timeout", () => {
  it("gives a bounded synthesis pass room to finish inside one request", () => {
    const apiFunction = sstConfig.match(
      /new sst\.aws\.Function\("Api", \{(?<body>[\s\S]*?)\n    \}\);/,
    );

    expect(apiFunction?.groups?.body).toEqual(
      expect.stringContaining('timeout: "60 seconds"'),
    );
  });
});

describe("SST principle generation cadence", () => {
  /*
    The owner's decision, drift-locked: principles are generated once per day
    at midnight PST and NOTHING else may trigger generation. Any second call
    site for the enqueue silently reintroduces a cadence the layer's meaning
    forbids — which is exactly why this is a test and not a comment.
  */
  it("runs the nightly cron at midnight PST, enabled", () => {
    const principleRefresh = sstConfig.match(
      /new sst\.aws\.Cron\("PrincipleRefresh", \{(?<body>[\s\S]*?)\n    \}\);/,
    );
    expect(principleRefresh?.groups?.body).toMatch(/schedule: "cron\(0 8 \* \* \? \*\)"/);
    expect(principleRefresh?.groups?.body).toEqual(expect.stringContaining("enabled: true"));
    expect(principleRefresh?.groups?.body).toEqual(
      expect.stringContaining("packages/api/src/principle-refresh.handler"),
    );
  });

  it("keeps principle enqueueing behind the material eligibility service", () => {
    const srcRoot = resolve(__dirname, "../src");
    const offenders: string[] = [];
    const allowed = new Set([
      "lib/queue.ts", // the definition
      "lib/principle-status.ts", // material eligibility and deduplication
    ]);
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        const rel = relative(srcRoot, path);
        if (allowed.has(rel)) continue;
        let source:string;
        try{source=readFileSync(path,'utf8');}catch(error){
          // Vocabulary tests create/remove source probes concurrently. A file
          // that ceased to exist is not runtime code; other read errors fail.
          if((error as NodeJS.ErrnoException).code==='ENOENT')continue;throw error;
        }
        if (source.includes("enqueueRefreshPrinciples(")) {
          offenders.push(rel);
        }
      }
    };
    walk(srcRoot);
    expect(
      offenders,
      `Principle enqueue bypasses the material service: ${offenders.join(", ")}.`,
    ).toEqual([]);
  });
});
