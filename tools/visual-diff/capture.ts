#!/usr/bin/env tsx
/**
 * Visual-diff capture script.
 *
 * Renders the legacy `index.html` and the new React app at matched
 * routes/viewports and writes:
 *
 *   tools/visual-diff/output/
 *     legacy/<viewport>/<pair>.png        ← raw legacy screenshot
 *     react/<viewport>/<pair>.png         ← raw react screenshot
 *     diff/<viewport>__<pair>.png         ← side-by-side composite
 *     index.html                          ← human-friendly report
 *     manifest.json                       ← machine-readable index
 *
 * Usage (from repo root):
 *
 *   pnpm visual-diff                       # defaults
 *   pnpm visual-diff --react-base-url=http://localhost:5173
 *   pnpm visual-diff --session-cookie=auth=eyJ...
 *
 * The legacy app is served from the repo root via a tiny static server
 * spun up inside this script (no external dependency). The React app is
 * NOT booted by this script — start `pnpm --filter @waka/web dev`
 * (or `sst dev`) in another terminal first. This deliberate split keeps
 * the tool composable: it has no opinion about HOW the React app is
 * running, only that its base URL is reachable.
 *
 * IMPORTANT: This is a TOOLING setup AC. The tool only needs to *exist*
 * and *work end-to-end*; an actual visual-parity verdict is the job of
 * a downstream sub-AC (4.5.x).
 */

import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

import { DEFAULT_PAIRS, VIEWPORTS, type Pair, type Viewport } from "./pairs.config.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const LEGACY_INDEX_HTML = path.join(REPO_ROOT, "index.html");
const OUT_ROOT = path.join(__dirname, "output");

// ---------------------------------------------------------------------------
// CLI parsing — kept dependency-free on purpose.
// ---------------------------------------------------------------------------

type CliOpts = {
  legacyBaseUrl?: string; // overrides the built-in static server
  reactBaseUrl: string;
  sessionCookie?: string; // raw `Cookie:` header value, threaded onto react origin
  only?: string[];        // pair names to keep (after filtering)
  viewports?: string[];   // viewport names to keep
  outDir: string;
};

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = {
    reactBaseUrl: "http://localhost:5173",
    outDir: OUT_ROOT,
  };
  for (const raw of argv) {
    const [k, ...rest] = raw.replace(/^--/, "").split("=");
    const v = rest.join("=");
    switch (k) {
      case "legacy-base-url":   opts.legacyBaseUrl   = v; break;
      case "react-base-url":    opts.reactBaseUrl    = v; break;
      case "session-cookie":    opts.sessionCookie   = v; break;
      case "only":              opts.only            = v.split(",").map((s) => s.trim()).filter(Boolean); break;
      case "viewports":         opts.viewports       = v.split(",").map((s) => s.trim()).filter(Boolean); break;
      case "out-dir":           opts.outDir          = path.resolve(v); break;
      case "help":
      case "h": {
        printHelp();
        process.exit(0);
      }
    }
  }
  return opts;
}

function printHelp() {
  console.log(`visual-diff capture — render legacy index.html and React app side by side

  --react-base-url=URL   React app origin (default http://localhost:5173)
  --legacy-base-url=URL  Override legacy origin; otherwise a built-in static
                         server serves the repo's index.html on a free port
  --session-cookie=KV    Raw cookie string applied to the React origin
                         (e.g. "auth=eyJ..."). Required to capture /
                         instead of /login.
  --only=a,b,c           Restrict to specific pair names from pairs.config.ts
  --viewports=desktop    Restrict to specific viewport names
  --out-dir=PATH         Output directory (default tools/visual-diff/output)
`);
}

// ---------------------------------------------------------------------------
// Tiny static server for the legacy index.html.
//
// Why not file://? Because file:// breaks the @import / @font-face for
// remote Google Fonts under some browsers' Strict Mixed Content settings,
// and it changes the subset of CORS rules the page sees. Hosting on
// http://127.0.0.1:<port> gives us a parity environment with the React
// dev server.
// ---------------------------------------------------------------------------

async function startLegacyServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const indexHtml = await fs.readFile(LEGACY_INDEX_HTML, "utf8");
  const server = createServer((req, res) => {
    // The legacy file is fully self-contained. Any path returns the same
    // HTML so deep-links are harmless.
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(indexHtml);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("legacy server: failed to bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

// ---------------------------------------------------------------------------
// Composite (side-by-side) using the same headless browser. Avoids pulling
// in `sharp` or `canvas` as native deps.
// ---------------------------------------------------------------------------

async function composeSideBySide(
  context: BrowserContext,
  legacyPng: string,
  reactPng: string,
  outPng: string,
  label: string,
): Promise<void> {
  const legacyB64 = (await fs.readFile(legacyPng)).toString("base64");
  const reactB64  = (await fs.readFile(reactPng)).toString("base64");
  const html = `<!doctype html><html><head><meta charset="utf-8"/><style>
      :root{color-scheme:light}
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:ui-sans-serif,system-ui,sans-serif;background:#1a1a1a;color:#eee;padding:24px}
      .label{font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#aaa;margin-bottom:12px;text-transform:uppercase;letter-spacing:.12em}
      .pair{display:flex;gap:24px;align-items:flex-start}
      .col{flex:1;min-width:0;background:#fff;border:1px solid #333;border-radius:6px;overflow:hidden}
      .col h3{font-size:11px;color:#666;background:#f5f5f5;border-bottom:1px solid #ddd;padding:8px 12px;font-family:ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.1em}
      .col img{display:block;width:100%;height:auto}
    </style></head><body>
      <div class="label">${escapeHtml(label)}</div>
      <div class="pair">
        <div class="col"><h3>legacy (index.html)</h3><img src="data:image/png;base64,${legacyB64}"/></div>
        <div class="col"><h3>react app</h3><img src="data:image/png;base64,${reactB64}"/></div>
      </div>
    </body></html>`;
  const page = await context.newPage();
  await page.setViewportSize({ width: 1800, height: 800 });
  await page.setContent(html, { waitUntil: "networkidle" });
  // Resize to fit content height so the composite isn't padded.
  const dims = await page.evaluate(() => {
    const body = document.body;
    return { w: Math.max(body.scrollWidth, 1800), h: body.scrollHeight };
  });
  await page.setViewportSize({ width: Math.ceil(dims.w), height: Math.ceil(dims.h) });
  await page.screenshot({ path: outPng, fullPage: true });
  await page.close();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

// ---------------------------------------------------------------------------
// Capture one (pair × viewport).
// ---------------------------------------------------------------------------

type CaptureRow = {
  pair: string;
  viewport: string;
  legacyPng: string;
  reactPng: string;
  diffPng: string;
  ok: boolean;
  error?: string;
};

async function captureOne(
  browser: Browser,
  composeContext: BrowserContext,
  pair: Pair,
  viewport: Viewport,
  opts: CliOpts,
  legacyOrigin: string,
  outDir: string,
): Promise<CaptureRow> {
  const legacyDir = path.join(outDir, "legacy", viewport.name);
  const reactDir  = path.join(outDir, "react",  viewport.name);
  const diffDir   = path.join(outDir, "diff");
  await fs.mkdir(legacyDir, { recursive: true });
  await fs.mkdir(reactDir,  { recursive: true });
  await fs.mkdir(diffDir,   { recursive: true });

  const legacyPng = path.join(legacyDir, `${pair.name}.png`);
  const reactPng  = path.join(reactDir,  `${pair.name}.png`);
  const diffPng   = path.join(diffDir,   `${viewport.name}__${pair.name}.png`);

  const row: CaptureRow = {
    pair: pair.name,
    viewport: viewport.name,
    legacyPng: path.relative(outDir, legacyPng),
    reactPng:  path.relative(outDir, reactPng),
    diffPng:   path.relative(outDir, diffPng),
    ok: false,
  };

  try {
    const legacyContext = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    });
    const reactContext = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor ?? 1,
    });

    if (opts.sessionCookie) {
      await applyRawCookies(reactContext, opts.reactBaseUrl, opts.sessionCookie);
    }

    const legacyPage = await legacyContext.newPage();
    const reactPage  = await reactContext.newPage();

    const legacyUrl = joinUrl(legacyOrigin, pair.legacyPath);
    const reactUrl  = joinUrl(opts.reactBaseUrl, pair.reactPath);

    await Promise.all([
      gotoAndPrep(legacyPage, legacyUrl, pair.waitForMs ?? 600, pair.legacyPrep),
      gotoAndPrep(reactPage,  reactUrl,  pair.waitForMs ?? 600, pair.reactPrep),
    ]);

    await Promise.all([
      legacyPage.screenshot({ path: legacyPng, fullPage: pair.fullPage ?? true }),
      reactPage.screenshot({  path: reactPng,  fullPage: pair.fullPage ?? true }),
    ]);

    await legacyContext.close();
    await reactContext.close();

    await composeSideBySide(
      composeContext,
      legacyPng,
      reactPng,
      diffPng,
      `${pair.name} @ ${viewport.name} ${viewport.width}×${viewport.height}`,
    );

    row.ok = true;
  } catch (err) {
    row.error = err instanceof Error ? err.message : String(err);
  }
  return row;
}

async function applyRawCookies(ctx: BrowserContext, baseUrl: string, raw: string): Promise<void> {
  const url = new URL(baseUrl);
  const cookies = raw.split(/;\s*/).map((kv) => kv.trim()).filter(Boolean).map((kv) => {
    const eq = kv.indexOf("=");
    const name = eq < 0 ? kv : kv.slice(0, eq);
    const value = eq < 0 ? "" : kv.slice(eq + 1);
    return {
      name,
      value,
      domain: url.hostname,
      path: "/",
      httpOnly: false,
      secure: url.protocol === "https:",
      sameSite: "Lax" as const,
    };
  });
  await ctx.addCookies(cookies);
}

async function gotoAndPrep(page: Page, url: string, waitMs: number, prep?: string): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  if (prep) {
    try { await page.evaluate(prep); } catch (e) {
      // prep failures are non-fatal — they may indicate the page is in
      // a different state (e.g. /login redirect) than the prep expected.
      console.warn(`  prep failed on ${url}: ${(e as Error).message}`);
    }
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  if (waitMs > 0) await page.waitForTimeout(waitMs);
}

function joinUrl(base: string, p: string): string {
  if (!p) return base;
  if (p.startsWith("http://") || p.startsWith("https://")) return p;
  return base.replace(/\/$/, "") + (p.startsWith("/") ? p : `/${p}`);
}

// ---------------------------------------------------------------------------
// Report.
// ---------------------------------------------------------------------------

async function writeReport(outDir: string, rows: CaptureRow[], opts: CliOpts): Promise<void> {
  const rowsHtml = rows.map((r) => {
    const status = r.ok ? "ok" : "error";
    const err = r.error ? `<div class="err">${escapeHtml(r.error)}</div>` : "";
    return `<section class="row">
      <header>
        <span class="badge ${status}">${status}</span>
        <h2>${escapeHtml(r.pair)} <em>·</em> ${escapeHtml(r.viewport)}</h2>
      </header>
      ${err}
      <div class="grid">
        <figure><figcaption>legacy</figcaption><img src="${escapeHtml(r.legacyPng)}" alt="legacy ${escapeHtml(r.pair)}"/></figure>
        <figure><figcaption>react</figcaption><img src="${escapeHtml(r.reactPng)}" alt="react ${escapeHtml(r.pair)}"/></figure>
      </div>
      <details><summary>side-by-side composite</summary><img src="${escapeHtml(r.diffPng)}"/></details>
    </section>`;
  }).join("\n");

  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>WAKA visual diff</title><style>
    :root{color-scheme:light}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:ui-sans-serif,system-ui,sans-serif;background:#0f0f0e;color:#eee;padding:32px;line-height:1.5}
    h1{font-family:"Instrument Serif",Georgia,serif;font-size:32px;font-weight:400;margin-bottom:8px}
    .meta{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.12em;margin-bottom:32px}
    .row{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:24px;margin-bottom:24px}
    .row header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
    .row h2{font-size:16px;font-weight:500}
    .row h2 em{color:#666;font-style:normal}
    .badge{font-size:10px;font-family:ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.1em;padding:3px 8px;border-radius:3px}
    .badge.ok{background:#1f3b1f;color:#7be07b}
    .badge.error{background:#3b1f1f;color:#e07b7b}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    figure{background:#fff;border-radius:6px;overflow:hidden}
    figcaption{font-size:11px;font-family:ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.1em;background:#f5f5f5;color:#666;padding:8px 12px;border-bottom:1px solid #ddd}
    figure img{display:block;width:100%;height:auto}
    details{margin-top:16px;background:#0f0f0e;border:1px solid #2a2a2a;border-radius:6px;padding:12px}
    details summary{cursor:pointer;font-size:11px;font-family:ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.1em;color:#888}
    details img{display:block;width:100%;margin-top:12px;border-radius:4px}
    .err{color:#e07b7b;font-family:ui-monospace,Menlo,monospace;font-size:12px;background:#2a1010;border:1px solid #6a2020;padding:8px 12px;border-radius:4px;margin-bottom:16px;white-space:pre-wrap}
  </style></head><body>
    <h1>WAKA <em style="color:#888">visual diff</em></h1>
    <div class="meta">${new Date().toISOString()} · legacy ↔ react · ${rows.length} captures · react=${escapeHtml(opts.reactBaseUrl)}</div>
    ${rowsHtml}
  </body></html>`;
  await fs.writeFile(path.join(outDir, "index.html"), html);
  await fs.writeFile(
    path.join(outDir, "manifest.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), reactBaseUrl: opts.reactBaseUrl, captures: rows }, null, 2),
  );
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
  const opts = parseArgs(process.argv.slice(2));
  await fs.mkdir(opts.outDir, { recursive: true });

  // Filter pairs/viewports.
  const pairs = DEFAULT_PAIRS
    .filter((p) => !opts.only || opts.only.includes(p.name))
    .map((p) => ({
      ...p,
      viewports: p.viewports.filter((v) => !opts.viewports || opts.viewports.includes(v.name)),
    }))
    .filter((p) => p.viewports.length > 0);

  if (pairs.length === 0) {
    console.error("no pairs match the supplied --only / --viewports filters");
    return 2;
  }

  // Sanity-probe the React origin so we fail fast with an actionable
  // message instead of a 30 s navigation timeout.
  const reactReachable = await pingHttp(opts.reactBaseUrl);
  if (!reactReachable) {
    console.warn(
      `\n⚠️  Could not reach React app at ${opts.reactBaseUrl}.\n` +
      `   Start it in another terminal first:\n` +
      `     pnpm --filter @waka/web dev\n` +
      `   …then rerun this script. Continuing anyway — Playwright will record per-pair errors.\n`,
    );
  }

  // Boot legacy origin: built-in unless --legacy-base-url given.
  let legacyOrigin = opts.legacyBaseUrl ?? "";
  let stopLegacy: (() => Promise<void>) | null = null;
  if (!opts.legacyBaseUrl) {
    const srv = await startLegacyServer();
    legacyOrigin = srv.url;
    stopLegacy = srv.close;
    console.log(`legacy origin: ${legacyOrigin}  (serving ${LEGACY_INDEX_HTML})`);
  } else {
    console.log(`legacy origin: ${legacyOrigin}  (external)`);
  }
  console.log(`react origin:  ${opts.reactBaseUrl}`);
  console.log(`out:           ${opts.outDir}\n`);

  const browser = await chromium.launch();
  const composeContext = await browser.newContext();

  const rows: CaptureRow[] = [];
  for (const pair of pairs) {
    for (const vp of pair.viewports) {
      process.stdout.write(`  · ${pair.name} @ ${vp.name} `);
      const row = await captureOne(browser, composeContext, pair, vp, opts, legacyOrigin, opts.outDir);
      rows.push(row);
      console.log(row.ok ? "✓" : `✗ (${row.error ?? "unknown"})`);
    }
  }

  await composeContext.close();
  await browser.close();
  if (stopLegacy) await stopLegacy();

  await writeReport(opts.outDir, rows, opts);

  const failed = rows.filter((r) => !r.ok).length;
  console.log(`\nReport: ${path.join(opts.outDir, "index.html")}`);
  if (failed > 0) console.log(`${failed}/${rows.length} captures failed`);
  return failed === 0 ? 0 : 1;
}

async function pingHttp(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const res = await fetch(u, { signal: ac.signal });
    clearTimeout(t);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

// Re-export for tests / programmatic usage.
export { captureOne, startLegacyServer, parseArgs, VIEWPORTS };
