#!/usr/bin/env tsx
/**
 * Deterministic enrichment fixtures.
 *
 * Why this exists
 * ---------------
 * The enrichment gates assert that a link's *page body* and an image's
 * *transcription* reach the attachment. Pointed at the public internet those
 * gates measure someone else's uptime: a site changes its markup, serves a
 * consent wall, or rate-limits the run, and the gate fails without anything in
 * this repository having moved. Worse, a green run would prove nothing — a page
 * whose salient words also sit in its `<title>` is passed by an extractor that
 * never opened the body.
 *
 * So the fixtures are adversarial on purpose:
 *
 *   /article   the words that matter exist ONLY in the body. The title and
 *              every meta tag are deliberately generic, and boilerplate wraps
 *              the prose, so the gate can only pass by stripping chrome and
 *              reading paragraphs. A second marker lives inside that chrome,
 *              which lets the caller assert the boilerplate was *not* kept.
 *   /image.png a picture of a few large words. Encoded here rather than
 *              committed as a binary so the bytes are auditable and the marker
 *              in the harness and the pixels on the page cannot drift apart.
 *
 * Loopback binding and the SSRF guard
 * -----------------------------------
 * This binds 127.0.0.1: a fixture server is not something to expose. The API's
 * enrichment path refuses private-range addresses on purpose (see
 * `assertFetchableUrl` in packages/api/src/lib/signal-enrichment.ts), so a
 * stack under test needs either a dev-only allowance for the fixture host or a
 * routable address supplied via `publicUrl` — the harness says which, by name,
 * when the verdict comes back `private_address`.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

/**
 * The sentence that exists only in the article's body.
 *
 * Nonsense on purpose: no page anywhere else says this, so finding it in an
 * attachment's enrichment text is proof the body was read, not a coincidence
 * of vocabulary.
 */
export const FIXTURE_ARTICLE_MARKER =
  "The kingfisher audits the riverbank ledger before the tide turns.";

/**
 * A sentence that lives only in the article's chrome — aside, footer, script.
 * Its *absence* from enrichment text is what proves boilerplate was stripped
 * rather than swept up along with the prose.
 */
export const FIXTURE_ARTICLE_BOILERPLATE_MARKER =
  "Subscribe to the weekly dispatch for members-only pricing updates.";

/** The words rendered into the fixture PNG, in the order they appear. */
export const FIXTURE_IMAGE_MARKER = "VELVET ANTENNA";

/** What the page calls itself. Generic so it can carry no salience. */
export const FIXTURE_ARTICLE_TITLE = "Notes";

/** What every meta tag says. Equally generic, for the same reason. */
export const FIXTURE_ARTICLE_DESCRIPTION = "A page.";

// ---------------------------------------------------------------------------
// The article
// ---------------------------------------------------------------------------

/**
 * Markup shaped like a real article: navigation and a headline above, an
 * in-body promo and a tracking script beside the prose, a footer below.
 *
 * Every paragraph the extractor should keep is over the 60-character floor it
 * uses to tell prose from a caption; the caption below the marker paragraph is
 * deliberately under it.
 */
export function buildArticleHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${FIXTURE_ARTICLE_TITLE}</title>
<meta name="description" content="${FIXTURE_ARTICLE_DESCRIPTION}">
<meta property="og:title" content="${FIXTURE_ARTICLE_TITLE}">
<meta property="og:description" content="${FIXTURE_ARTICLE_DESCRIPTION}">
<meta property="og:site_name" content="Fixture">
</head>
<body>
<nav class="site-nav">
<a href="/">Home</a> <a href="/archive">Archive</a> <a href="/about">About</a>
</nav>
<header class="masthead">
<h1>${FIXTURE_ARTICLE_TITLE}</h1>
<p class="standfirst">${FIXTURE_ARTICLE_BOILERPLATE_MARKER} Membership renews annually.</p>
</header>
<article>
<nav class="breadcrumb"><a href="/archive">Archive</a> / <a href="/archive/field">Field</a></nav>
<p>Estuary work rewards patience over instrumentation, and the crews who log the most useful observations are the ones who return to the same bend of water for years rather than sweeping a wider stretch once.</p>
<p>${FIXTURE_ARTICLE_MARKER} The bird arrives before the survey team does, works the shallows on a schedule nobody set, and leaves once the water turns over.</p>
<p class="caption">Photograph: the north bend.</p>
<p>What the crews write down afterwards is closer to an account of attention than to a measurement, which is why two teams reading the same reach of river rarely produce the same page of notes.</p>
<aside class="promo">
<p>${FIXTURE_ARTICLE_BOILERPLATE_MARKER} Members also receive the quarterly index and early access to the field guides.</p>
</aside>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Article","headline":"${FIXTURE_ARTICLE_TITLE}","about":"${FIXTURE_ARTICLE_BOILERPLATE_MARKER}"}
</script>
</article>
<footer class="site-footer">
<p>${FIXTURE_ARTICLE_BOILERPLATE_MARKER} Contact the desk at desk@example.invalid for corrections and permissions.</p>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// PNG encoding
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xed_b8_83_20 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xff_ff_ff_ff) >>> 0;
}

/** length + type + data + CRC over (type + data), per the PNG spec. */
function pngChunk(type: string, data: Uint8Array): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBytes, data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), out.length - 4);
  return out;
}

/**
 * A 5x7 bitmap font, written out as pixels so a typo is visible in review
 * rather than hiding inside a hex table. Unlisted characters throw: a marker
 * silently rendered as blanks would turn the image gate into a coin flip.
 */
const GLYPHS: Record<string, string[]> = {
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["....#", "....#", "....#", "....#", "#...#", "#...#", ".###."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", "#####"],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;

export interface RenderTextPngOptions {
  /** Pixels per font cell. Large by default — the image has to be *legible*. */
  scale?: number;
  /** Quiet margin around the words, in font cells. */
  marginCells?: number;
}

/**
 * Render one line of text as a black-on-white PNG.
 *
 * Truecolor rather than grayscale, and uncompressed rows handed to zlib with
 * the null filter: the point is a file every decoder accepts, not a small one.
 * Long runs of one colour mean it lands in a few kilobytes regardless.
 */
export function renderTextPng(text: string, options: RenderTextPngOptions = {}): Buffer {
  const scale = Math.max(1, Math.trunc(options.scale ?? 12));
  const marginCells = Math.max(0, Math.trunc(options.marginCells ?? 1));
  const upper = text.toUpperCase();

  const glyphs = [...upper].map((char) => {
    const glyph = GLYPHS[char];
    if (!glyph) {
      throw new Error(
        `renderTextPng: no glyph for ${JSON.stringify(char)} — extend GLYPHS or change the marker`,
      );
    }
    return glyph;
  });

  // One blank column between glyphs, and the margin expressed in the same
  // cells so the layout scales as one piece.
  const cellsWide = glyphs.length * (GLYPH_WIDTH + 1) - 1 + marginCells * 2;
  const cellsHigh = GLYPH_HEIGHT + marginCells * 2;
  const width = cellsWide * scale;
  const height = cellsHigh * scale;

  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height, 0xff);
  // The per-row filter byte: 0 = None. Every other byte stays white until a
  // glyph paints over it.
  for (let y = 0; y < height; y += 1) raw[y * (rowBytes + 1)] = 0;

  const paint = (cellX: number, cellY: number): void => {
    const x0 = cellX * scale;
    const y0 = cellY * scale;
    for (let dy = 0; dy < scale; dy += 1) {
      const rowStart = (y0 + dy) * (rowBytes + 1) + 1;
      raw.fill(0x00, rowStart + x0 * 3, rowStart + (x0 + scale) * 3);
    }
  };

  glyphs.forEach((glyph, index) => {
    const originX = marginCells + index * (GLYPH_WIDTH + 1);
    glyph.forEach((row, rowIndex) => {
      [...row].forEach((pixel, columnIndex) => {
        if (pixel === "#") paint(originX + columnIndex, marginCells + rowIndex);
      });
    });
  });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

let cachedImage: Buffer | null = null;

/** The fixture image's bytes — encoded once, identical every run. */
export function fixtureImageBytes(): Buffer {
  cachedImage ??= renderTextPng(FIXTURE_IMAGE_MARKER);
  return cachedImage;
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

export interface FixtureServerOptions {
  /** Default 0: the OS assigns a free port and the result reports which. */
  port?: number;
  /** Default 127.0.0.1. */
  host?: string;
  /**
   * The base URL handed to the stack under test, when that differs from where
   * this listens — a tunnel, or a name that resolves to this machine from
   * inside a container. Nothing is validated: whatever is passed is what the
   * API will be asked to fetch.
   */
  publicUrl?: string;
}

export interface FixtureServer {
  /** Base URL to hand to the stack under test. */
  url: string;
  /** Where the socket actually listens, which `url` may deliberately differ from. */
  listeningUrl: string;
  port: number;
  articleUrl: string;
  imageUrl: string;
  healthUrl: string;
  close(): Promise<void>;
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const path = (req.url ?? "/").split("?")[0];

  if (path === "/health") {
    const body = JSON.stringify({ ok: true });
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    res.end(body);
    return;
  }

  if (path === "/article") {
    const body = buildArticleHtml();
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    res.end(body);
    return;
  }

  if (path === "/image.png") {
    const body = fixtureImageBytes();
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": body.length,
      "cache-control": "no-store",
    });
    res.end(body);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not a fixture\n");
}

export async function startFixtureServer(
  options: FixtureServerOptions = {},
): Promise<FixtureServer> {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 0;

  const server: Server = createServer(handle);
  // A fixture that keeps a socket open past the harness would hang the run.
  server.keepAliveTimeout = 1_000;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const listeningUrl = `http://${host}:${address.port}`;
  const url = (options.publicUrl ?? listeningUrl).replace(/\/$/, "");

  return {
    url,
    listeningUrl,
    port: address.port,
    articleUrl: `${url}/article`,
    imageUrl: `${url}/image.png`,
    healthUrl: `${url}/health`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// Standalone
// ---------------------------------------------------------------------------

function readFlag(argv: string[], name: string): string | undefined {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      [
        "Usage: pnpm e2e:fixtures [--port <n>] [--host <addr>]",
        "",
        "Serves the enrichment fixtures the e2e harness asserts against:",
        "  GET /article    salient text in the body only",
        "  GET /image.png  a few large words, rendered",
        "  GET /health     { ok: true }",
      ].join("\n"),
    );
    return;
  }

  const portFlag = readFlag(argv, "--port");
  const fixtures = await startFixtureServer({
    port: portFlag ? Number(portFlag) : 0,
    host: readFlag(argv, "--host"),
  });

  console.log(`[fixtures] listening on ${fixtures.url}`);
  console.log(`[fixtures] article: ${fixtures.articleUrl}`);
  console.log(`[fixtures] image:   ${fixtures.imageUrl}`);
  console.log("[fixtures] Ctrl-C to stop.");

  const stop = (): void => {
    void fixtures.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

const isDirectRun = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
