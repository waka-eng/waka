/**
 * Attachment enrichment — reading what a person saved, not only what they typed.
 *
 * A capture is often a bare link, or an image with three words beside it. Every
 * layer above reads text, so without this the saved thing is mute: whatever
 * argument moved someone lives inside that page, and the page is not in the
 * database. This module fetches it once, deterministically, and stores a
 * bounded copy on the attachment so extraction can read the *material* rather
 * than the wrapper.
 *
 * Enrichment is machine-derived context and never the person's words. A quote
 * drawn from it downstream belongs to the source, not to the member who saved
 * the link — attributing an article's claim to its reader would be a statement
 * about them that nobody made.
 *
 * Deliberately modest: no headless browser, one request per URL, a short
 * timeout, hand-followed redirects, and a hard character cap. A page that
 * refuses to speak is recorded as such so it is not knocked on forever.
 *
 * WHAT IS HERE AND WHAT IS NEXT DOOR. This file is the part that touches the
 * outside world: deciding an address may be dereferenced at all, bounding how
 * long the exchange may take and how many bytes it may cost, and writing the
 * verdict onto the attachment. Turning the bytes that come back into words is
 * `signal-enrichment-html.ts`, which imports nothing and can be read without
 * any of this.
 *
 * The two halves were separated along that line and no other. The body
 * deadline is COMPUTED from whatever byte cap its caller passes, and both
 * callers that pass one — the link path below and the image path below it —
 * have to stay where a reader can see them against `bodyTimeoutMs`. That is
 * why this file is not further divided into "link fetching" and "image
 * description" even though those read like two things: it would put the two
 * callers in separate files and the derivation in a third, which is exactly
 * the arrangement that let a cap and a deadline drift into forbidding what
 * they advertised.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { and, eq } from "drizzle-orm";

import {
  attachments,
  inspirations,
  type AttachmentEnrichmentKind,
  type AttachmentType,
} from "../db/index.js";
import { getDb } from "./db.js";
import { requestSignalDerivation } from "./inspiration-derivation-requests.js";
import { wakeCommittedBackgroundJobs } from "./queue.js";
import {
  describeImage,
  ImageDescriptionError,
  isDescribableImageType,
  MAX_IMAGE_BYTES,
} from "./image-description.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import { enrichAudioAttachment } from './audio-enrichment.js';
import {
  composeEnrichmentText,
  extractLinkMetadata,
  extractPageBody,
  extractYouTubeDescription,
  isYouTubeHost,
  type LinkMetadata,
} from "./signal-enrichment-html.js";

/**
 * The reading half, re-offered under this module's name.
 *
 * Named one by one rather than `export *`, so this list is a statement about
 * what enrichment's front door offers and adding to the file next door does
 * not silently widen it. It exists because `docs/map.md` sends a reader to
 * `signal-enrichment.ts` for page bodies and because the tests and the prompt
 * fence test already import these from here — moving a file should not oblige
 * every caller to learn that it moved. Read `signal-enrichment-html.ts` when
 * you want to know how any of them work.
 */
export {
  composeEnrichmentText,
  extractLinkMetadata,
  extractPageBody,
  extractYouTubeDescription,
  isAuthWallSummary,
  stripBoilerplateLines,
  MAX_ENRICHMENT_TEXT_CHARS,
  type LinkMetadata,
} from "./signal-enrichment-html.js";

/**
 * TWO DEADLINES, BECAUSE AN EXCHANGE HAS TWO DIFFERENT WAYS OF GOING WRONG.
 *
 * There used to be one number — six seconds — and it was fine while it only
 * ever covered the headers. Once the deadline was made to survive into the
 * body read (which it had to; see `fetchWithTimeout`) that single number
 * started answering a question it was never sized for. It stopped the drip,
 * which was the point — and it also refused an 8 MiB image from anything not
 * sustaining well over a megabyte a second, and refused an honest little page
 * from a server that took seven seconds to think. A budget that cannot spend
 * the allowance advertised beside it is not a budget, it is a contradiction
 * waiting for a bug report. Turning a hang into a permanent silent failure for
 * pages that were being read correctly the day before is not a fix.
 *
 * Getting an answer STARTED is a wall-clock question. An origin that has sent
 * nothing after six seconds is not about to; how large the eventual body might
 * be has no bearing on it. That is `FETCH_HEADERS_TIMEOUT_MS`, unchanged in
 * both value and meaning from before any of this, because nothing about the
 * bug argued it was the wrong number for the job it was actually doing.
 *
 * Reading a body is a THROUGHPUT question, and it has to be, because the two
 * callers here are allowed to read amounts that differ by sixteen times. A
 * deadline that ignores that either strangles the image path or hands the link
 * path far more rope than it needs. So the body's deadline is computed from
 * the caller's own byte cap — see `bodyTimeoutMs`, which is the piece that
 * makes the two constants incapable of disagreeing again.
 *
 * Rejected on the way here: one larger total budget for everybody (an origin
 * that silently sits on its headers would then hold the worker for the image
 * path's whole allowance, thirty-eight seconds, for having sent nothing at
 * all); and shrinking MAX_IMAGE_BYTES until it fit inside six seconds, which
 * would have quietly narrowed what a member is allowed to save in order to
 * settle an argument between two timers.
 */
export const FETCH_HEADERS_TIMEOUT_MS = 6000;

/**
 * The slowest body we are willing to sit through, in bytes per second.
 *
 * Two megabits. Every origin that is actually serving beats this by an order
 * of magnitude — it is under the floor of a congested shared host, let alone
 * anything behind a CDN. What it excludes is the drip: the page that answers
 * its headers instantly and then releases one byte per tick forever, which is
 * the shape that used to run until the Lambda's fourteen-minute ceiling.
 *
 * Deliberately generous rather than typical. The cost of setting it too low is
 * seconds on a background job nobody is watching; the cost of setting it too
 * high is a real page that a member saved being permanently dropped, because
 * an abort classifies as a retryable failure that then fails identically on
 * every retry until the attempts run out. Those are not symmetrical mistakes.
 */
const MIN_BODY_BYTES_PER_SEC = 256 * 1024;

/**
 * What even a one-kilobyte body gets, before throughput enters into it.
 *
 * The rate above answers "how long may these bytes take to arrive"; it does
 * not answer "how long may the origin take to produce them". A server-rendered
 * page under load, a cold cache, a database behind the request — these emit
 * headers at once and then take seconds to finish a body far smaller than the
 * cap. Sizing a small read purely by rate would give that page under two
 * seconds and drop it, which is the regression this whole constant exists to
 * prevent.
 */
const BODY_TIMEOUT_FLOOR_MS = 10_000;

/**
 * How long a caller allowed to read `maxBytes` may spend reading them.
 *
 * Derived, not declared, so the deadline and the byte cap cannot drift apart:
 * change either cap and its deadline moves with it. In the shipping cases that
 * is ten seconds for a page (the floor; 512 KB at the rate above is only two)
 * and thirty-two for an image. Worst case per job is therefore sixteen seconds
 * for a link and thirty-eight for an image — bounded by us, rather than by the
 * far end's goodwill, which is the whole point.
 */
export function bodyTimeoutMs(maxBytes: number): number {
  const atFloorRate = Math.ceil((maxBytes / MIN_BODY_BYTES_PER_SEC) * 1000);
  return Math.max(BODY_TIMEOUT_FLOOR_MS, atFloorRate);
}

/** Redirect hops we will follow, each re-checked. Enough for shorteners. */
const MAX_REDIRECTS = 4;

/**
 * How much of a fetched document the extractors are allowed to see.
 *
 * The patterns in `signal-enrichment-html.ts` run over attacker-chosen HTML:
 * the page belongs to whoever wrote it and a member only chose to save a link
 * to it. Handing a regex a megabyte of hostile markup is a denial of service
 * waiting to be written, and nothing useful lives that far down — metadata
 * sits in the head and the body extractor takes what it needs from the first
 * screens.
 *
 * This cap is enforced HERE, at the one place bytes become a string, and not
 * in the file that does the matching. Those functions take a string and cannot
 * tell whether it came off a socket or out of a test; making each of them
 * re-check a length would be four chances to forget. One truncation at the
 * boundary is the whole guarantee.
 */
const MAX_HTML_CHARS = 128_000;

/**
 * The same cap in bytes. MAX_HTML_CHARS is a character budget; ×4 is the
 * widest a UTF-8 encoding of it can be, so this truncates a runaway page
 * without ever cutting a page that would have fit.
 *
 * One constant rather than the expression written at each use, because it is
 * now used twice — once to stop the read and once to size the read's deadline
 * — and those two must not be allowed to disagree.
 *
 * Exported so the deadline tests can ask `bodyTimeoutMs` for the link path's
 * real budget instead of restating it as a number that would go stale.
 */
export const MAX_HTML_BYTES = MAX_HTML_CHARS * 4;

/**
 * A realistic browser UA, not an honest bot one. Several large sites serve bot
 * UAs a stripped page with no metadata at all; the page's own words are public,
 * we are fetching them once, and the polite string got us silence.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Fetching, with the hygiene a server-side fetch of a user's URL requires
// ---------------------------------------------------------------------------

/**
 * Is this address one the open internet cannot reach?
 *
 * Loopback, link-local (which on AWS and GCP is the instance metadata endpoint
 * at 169.254.169.254, handing role credentials to anything that asks), RFC1918,
 * carrier NAT, and the v6 equivalents.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a = 0, b = 0] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true; // multicast and reserved
    return false;
  }
  if (version === 6) {
    const value = address.toLowerCase();
    /**
     * A v4 ADDRESS WEARING A v6 COAT, IN EVERY TEXTUAL FORM.
     *
     * This checked only the dotted spelling `::ffff:169.254.169.254`, and the
     * one caller that reaches it never sees that spelling. `assertFetchableUrl`
     * hands over `new URL(...).hostname`, and the WHATWG parser re-serialises
     * a v4-mapped literal to HEX:
     *
     *   new URL("http://[::ffff:169.254.169.254]/").hostname
     *     === "[::ffff:a9fe:a9fe]"
     *
     * So the dotted branch was unreachable in production, `isIP` returned 6,
     * no other v6 rule matched, and the guard returned false — for the AWS and
     * GCP instance metadata endpoint, which hands the Lambda role's
     * credentials to anything that asks. The OS then resolves the v4-mapped
     * socket to the real IPv4 peer, so the connection lands. A member only had
     * to save a link on their own capture.
     *
     * Both spellings are handled now, and so are the other prefixes that carry
     * a v4 address in the low 32 bits: `::x.x.x.x` (deprecated v4-compatible)
     * and `64:ff9b::/96` (NAT64). Each is decoded back to its v4 form and
     * re-checked, so there is one set of private ranges and no second list to
     * drift.
     */
    const embedded = embeddedIPv4(value);
    if (embedded) return isPrivateAddress(embedded);
    if (value === "::1" || value === "::") return true;
    if (/^f[cd]/.test(value)) return true; // unique local
    if (/^fe[89ab]/.test(value)) return true; // link local
    return false;
  }
  return false;
}

/**
 * The IPv4 address embedded in a v6 literal, in dotted form, or null.
 *
 * Handles the dotted tail (`::ffff:10.0.0.1`) and the hex tail
 * (`::ffff:a9fe:a9fe`) for the three prefixes that mean "this is really IPv4":
 * v4-mapped `::ffff:`, v4-compatible `::`, and NAT64 `64:ff9b::`.
 */
function embeddedIPv4(value: string): string | null {
  const prefixes = [/^::ffff:/, /^64:ff9b::/, /^::(?!$)/];
  const prefix = prefixes.find((p) => p.test(value));
  if (!prefix) return null;
  const tail = value.replace(prefix, "");
  if (/^\d+\.\d+\.\d+\.\d+$/.test(tail)) return tail;
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const hi = Number.parseInt(hex[1]!, 16);
  const lo = Number.parseInt(hex[2]!, 16);
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/**
 * A server-side fetch of a URL a member typed is an SSRF sink: unguarded, the
 * pipeline would happily read the cloud metadata endpoint or anything else
 * inside the VPC and store the response on a capture. The scheme is
 * allowlisted and the host is resolved and checked before we connect.
 *
 * DNS is re-resolved by fetch after this check, so a hostile record could in
 * principle change between the two. Blocking on resolution is still the
 * meaningful barrier, and the response body only ever reaches us as bounded
 * text on one attachment.
 */
/**
 * Hosts exempt from the private-address refusal, as `host` or `host:port`.
 *
 * Empty unless `WAKA_ENRICHMENT_ALLOWED_HOSTS` names something, and nothing in
 * the deployed configuration sets it. It exists because the enrichment tests
 * need a page and an image served from a fixture on loopback, and the honest
 * way to allow that is a named exception the reader can see rather than a
 * blanket "skip the check in dev" — which is the flag that eventually ships.
 */
function enrichmentHostAllowlist(): Set<string> {
  const raw = process.env.WAKA_ENRICHMENT_ALLOWED_HOSTS ?? "";
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

export async function assertFetchableUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("unfetchable_url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("unsupported_scheme");
  }

  const allowed = enrichmentHostAllowlist();
  if (allowed.has(parsed.host.toLowerCase()) || allowed.has(parsed.hostname.toLowerCase())) {
    return;
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("private_address");
    return;
  }
  const resolved = await lookup(host, { all: true });
  if (resolved.length === 0) throw new Error("unresolvable_host");
  // `all`, not the first: a name that returns one public and one private
  // address must not be reachable through the private one.
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("private_address");
  }
}

interface FetchBudget {
  accept?: string;
  /**
   * The most the caller will read from this response — required, because it is
   * what the body deadline is computed from. Passing the cap rather than the
   * observed size is the point: the budget has to be settled before a single
   * byte arrives, and it should be the same whether the page turns out to be
   * one kilobyte or the full cap.
   */
  maxBytes: number;
}

/**
 * Follow redirects by hand so every hop is checked. `redirect: "follow"` lets a
 * public URL bounce us into the VPC on its second hop, which is the usual way
 * this protection is bypassed — so an image fetched by URL must come through
 * here too, not through a plain `fetch(..., { redirect: "follow" })`.
 *
 * THE DEADLINE HAS TO OUTLIVE THIS FUNCTION.
 *
 * `fetch` resolves when the response HEADERS arrive. The body is still on the
 * wire at that point, and reading it is the slow, attacker-controlled part. So
 * the obvious shape — `try { … } finally { clearTimeout(timer) }` — disarms
 * the deadline at exactly the moment it starts to matter, and that is how this
 * was written, under a comment asserting that the caller read the body "under
 * the same abort signal". The signal was passed, correctly; there was simply
 * nothing left alive to fire it. A page that answered its headers instantly
 * and then dribbled its body a byte at a time was never interrupted — undici's
 * own inactivity timer is reset by each byte that does arrive, so the read ran
 * on until the Lambda's 14-minute ceiling.
 *
 * The cost is not one slow job. Enrichment drains sequentially on a shared
 * background worker, so one hostile or broken page sits at the head of the
 * queue and every other account's derivation waits behind it for the full
 * fourteen minutes.
 *
 * So the clock is handed forward rather than cleared. It is armed once for the
 * headers, re-armed for the body the moment the headers land — a body cap's
 * worth of time, see `bodyTimeoutMs` — and only stopped when the caller calls
 * `release`. Two phases, one controller, so an abort in either phase reaches
 * the same open socket.
 *
 * WHAT THIS DOES NOT COVER: name resolution. `assertFetchableUrl` awaits
 * `lookup` from `node:dns/promises`, which takes no AbortSignal, so neither
 * deadline can interrupt it — and it runs once per hop, so a chain of
 * hostnames with blackholed nameservers can spend several resolver timeouts
 * (getaddrinfo's own, on the order of ten seconds each) entirely outside our
 * budget. Bounded by MAX_REDIRECTS rather than by us. It is written down here
 * instead of quietly rounded off because the previous comment on this function
 * claimed coverage it did not have, and that claim WAS the bug.
 *
 * CALLER CONTRACT: `release` on every exit, from a `finally` — which is what
 * both callers do. Skipping it now leaks an armed timer as well as an open
 * connection, so the penalty for forgetting is worse than it was when the
 * timer cleared itself. Nothing enforces this but the two call sites; a shape
 * that took a callback and released for you would enforce it, and is the right
 * answer if a third caller ever appears.
 */
async function fetchWithTimeout(
  url: string,
  { accept = "text/html,application/xhtml+xml", maxBytes }: FetchBudget,
): Promise<{ response: Response; finalUrl: string; release: () => void }> {
  const controller = new AbortController();
  // Deliberately spanning the whole redirect chain rather than resetting per
  // hop: five hops that each answer in five seconds is not a live page, it is
  // a way to buy twenty-five seconds of the worker.
  let timer = setTimeout(() => controller.abort(), FETCH_HEADERS_TIMEOUT_MS);

  /**
   * Stop the clock and let go of the socket. One call rather than two, because
   * for the caller they are the same event: it is done with this exchange, and
   * leaving either half behind is a leak — an armed timer that outlives its
   * fetch, or a connection nobody is reading.
   */
  const release = (): void => {
    clearTimeout(timer);
    controller.abort();
  };

  /**
   * Headers are in, so the question changes from "will this origin answer" to
   * "can it deliver what we are willing to read". Swap the clock accordingly,
   * here rather than at the call site: the caller already has one discipline
   * to remember and a second one would be a second thing to forget.
   */
  const startBodyDeadline = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), bodyTimeoutMs(maxBytes));
  };

  try {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      await assertFetchableUrl(current);
      const response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: accept },
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) {
        startBodyDeadline();
        return { response, finalUrl: current, release };
      }
      if (hop >= MAX_REDIRECTS) {
        // Out of hops. The caller still reads whatever this last response is,
        // so it still needs a body deadline of its own.
        startBodyDeadline();
        return { response, finalUrl: current, release };
      }
      current = new URL(location, current).toString();
    }
  } catch (err) {
    // Nothing was handed out, so nobody else can release it.
    release();
    throw err;
  }
}

/**
 * Read a response body up to `maxBytes`, then stop. A page or image that keeps
 * streaming past the cap is truncated rather than buffered whole: the timeout
 * bounds how long a slow drip may run, this bounds how much memory a fast one
 * may take. Returns the bytes actually read.
 */
async function readCappedBody(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    return buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => undefined);

  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= out.length) break;
    const slice = chunk.subarray(0, out.length - offset);
    out.set(slice, offset);
    offset += slice.length;
  }
  return out;
}

export interface LinkEnrichment extends LinkMetadata {
  finalUrl: string;
  hostname: string | null;
  /** The bounded text extraction reads. Null when the page said nothing. */
  text: string | null;
}

/**
 * Fetch what a URL says about itself. Throws on transport failure — the caller
 * decides whether a page that could not be reached is worth another attempt.
 */
export async function fetchLinkEnrichment(url: string): Promise<LinkEnrichment> {
  const { response, finalUrl, release } = await fetchWithTimeout(url, {
    maxBytes: MAX_HTML_BYTES,
  });
  try {
    const hostname = safeHostname(finalUrl);
    const empty: LinkEnrichment = {
      finalUrl,
      hostname,
      title: null,
      description: null,
      siteName: null,
      previewImageUrl: null,
      text: null,
    };

    if (!response.ok) throw new Error(`http_${response.status}`);
    const contentType = response.headers.get("content-type") ?? "";
    // A PDF or a video stream is not something this reads, and pulling one down
    // to discover that costs a member's attachment nothing but latency.
    if (!contentType.includes("html")) return empty;

    // Bounded read under the body deadline that was armed for exactly this
    // many bytes when the headers landed.
    const bytes = await readCappedBody(response, MAX_HTML_BYTES);
    const html = new TextDecoder().decode(bytes).slice(0, MAX_HTML_CHARS);
    const metadata = extractLinkMetadata(html);
    const body = isYouTubeHost(hostname)
      ? extractYouTubeDescription(html) ?? extractPageBody(html)
      : extractPageBody(html);

    return {
      ...metadata,
      finalUrl,
      hostname,
      text: composeEnrichmentText([metadata.title, metadata.description, body]),
    };
  } finally {
    // Every exit, not only the one that read a page. The two early returns
    // above — a non-2xx status and a content type we do not read — used to
    // walk away from an open connection, and now that the deadline survives
    // past the fetch they would walk away from a live timer as well.
    release();
  }
}

function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The entry point the queue calls
// ---------------------------------------------------------------------------

/** What enrichment concluded about an attachment it actually looked at. */
export type AttachmentEnrichmentVerdict =
  | { status: "ready"; kind: AttachmentEnrichmentKind; reason: null; text?: string }
  /** Deterministically nothing to read. Another attempt would find the same. */
  | { status: "unavailable"; reason: string }
  /** Transport-level: the page may well answer on the next attempt. */
  | { status: "failed"; reason: string };

export type EnrichAttachmentResult = AttachmentEnrichmentVerdict | { status: "missing" };

interface EnrichAttachmentDeps {
  db?: WakaDb;
  beforeCommit?: (tx: Parameters<Parameters<WakaDb["transaction"]>[0]>[0]) => Promise<void>;
  readAttachment?: (attachment: AttachmentRow) => Promise<{ result: AttachmentEnrichmentVerdict; link?: Partial<LinkEnrichment> }>;
}

interface AttachmentRow {
  id: string;
  type: AttachmentType;
  url: string;
  s3Key: string | null;
  contentType: string | null;
}

/**
 * Read an uploaded image's bytes.
 *
 * Uploads live in S3 and are fetched with the Lambda's own credentials, so no
 * URL from the row is dereferenced on that path. An image recorded by URL
 * instead goes through the same address guard as a link — an attachment is
 * user-supplied either way, and "it is an image" is not a reason to let it
 * point at an internal service.
 */
async function readImageBytes(
  attachment: AttachmentRow,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (attachment.s3Key) {
    /* Both imports stay LAZY. The SDK is only pulled in when an image with an
       s3 key is actually described, which is the reason this was a dynamic
       import before the client moved to `lib/s3-client.ts` — hoisting the
       helper to the top of the file would drag the SDK back into every path
       that merely loads this module. */
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { makeAttachmentsS3Client } = await import("./s3-client.js");
    const bucket = process.env.ATTACHMENTS_BUCKET;
    if (!bucket) throw new Error("attachments_bucket_unconfigured");

    const object = await makeAttachmentsS3Client().send(
      new GetObjectCommand({ Bucket: bucket, Key: attachment.s3Key }),
    );
    const bytes = await object.Body!.transformToByteArray();
    return {
      bytes,
      contentType: attachment.contentType ?? object.ContentType ?? "image/png",
    };
  }

  // Through the same per-hop guard a link gets: a redirect into a private
  // range on the second hop is exactly how this protection is bypassed, and
  // "it is an image" is not a reason to trust the URL. One byte over the cap
  // and describeImage rejects it, so reading cap+1 is enough to catch it.
  const { response, release } = await fetchWithTimeout(attachment.url, {
    accept: "image/*",
    // Sixteen times the link path's cap, and the reason the body deadline is
    // computed rather than shared: eight megabytes is half a minute from an
    // origin we would still call honest, and no fixed number serves both.
    maxBytes: MAX_IMAGE_BYTES + 1,
  });
  try {
    if (!response.ok) throw new Error(`image_fetch_${response.status}`);
    const bytes = await readCappedBody(response, MAX_IMAGE_BYTES + 1);
    return {
      bytes,
      contentType:
        attachment.contentType ?? response.headers.get("content-type") ?? "image/png",
    };
  } finally {
    release();
  }
}

/**
 * Image enrichment: a one-time vision description, cached on the attachment,
 * transcribing any legible text verbatim so extraction can read a screenshot
 * the way a person does.
 */
export async function enrichImageAttachment(
  attachment: AttachmentRow,
): Promise<AttachmentEnrichmentVerdict> {
  let bytes: Uint8Array;
  let contentType: string;
  try {
    ({ bytes, contentType } = await readImageBytes(attachment));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // A refused address or a missing bucket is a property of the attachment,
    // not a bad day for the network.
    const deterministic =
      reason === "private_address" ||
      reason === "unsupported_scheme" ||
      reason === "unfetchable_url" ||
      reason === "unresolvable_host" ||
      reason === "attachments_bucket_unconfigured";
    return deterministic
      ? { status: "unavailable", reason }
      : { status: "failed", reason: reason.slice(0, 200) };
  }

  if (!isDescribableImageType(contentType)) {
    return { status: "unavailable", reason: `unsupported_image_type:${contentType}` };
  }

  try {
    const text = await describeImage({ bytes, contentType });
    return { status: "ready", kind: "image_description", reason: null, text };
  } catch (err) {
    if (err instanceof ImageDescriptionError) {
      return err.transient
        ? { status: "failed", reason: err.message.slice(0, 200) }
        : { status: "unavailable", reason: err.message.slice(0, 200) };
    }
    return {
      status: "failed",
      reason: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    };
  }
}

async function enrichLinkAttachment(attachment: AttachmentRow): Promise<{
  result: AttachmentEnrichmentVerdict;
  link: Partial<LinkEnrichment>;
}> {
  let enrichment: LinkEnrichment;
  try {
    enrichment = await fetchLinkEnrichment(attachment.url);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    // A refused address or an unsupported scheme is a property of the URL, not
    // a bad day for the network: retrying reaches the same verdict.
    const deterministic =
      reason === "private_address" ||
      reason === "unsupported_scheme" ||
      reason === "unfetchable_url" ||
      reason === "unresolvable_host";
    return {
      result: deterministic
        ? { status: "unavailable", reason }
        : { status: "failed", reason: reason.slice(0, 200) },
      link: {},
    };
  }

  if (!enrichment.text) {
    return { result: { status: "unavailable", reason: "page_silent" }, link: enrichment };
  }
  return { result: { status: "ready", kind: "page_body", reason: null }, link: enrichment };
}

/**
 * Enrich one attachment and record the verdict on its row.
 *
 * Fetch outcomes are data, not thrown errors. Source races and persistence
 * failures do throw for a worker retry: cached content and its downstream
 * learning request must commit together. No lock spans a network/model call.
 */
export async function enrichAttachment(
  attachmentId: string,
  deps: EnrichAttachmentDeps = {},
): Promise<EnrichAttachmentResult> {
  const db = deps.db ?? getDb();

  const [attachment] = await db
    .select({
      id: attachments.id,
      profileId: attachments.profileId,
      inspirationId: attachments.inspirationId,
      type: attachments.type,
      url: attachments.url,
      s3Key: attachments.s3Key,
      contentType: attachments.contentType,
      enrichmentStatus: attachments.enrichmentStatus,
      enrichmentKind: attachments.enrichmentKind,
      enrichmentText: attachments.enrichmentText,
      transcriptRevision: attachments.transcriptRevision,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  if (!attachment) return { status: "missing" };

  let result: AttachmentEnrichmentVerdict;
  let link: Partial<LinkEnrichment> = {};

  if (deps.readAttachment) {
    const outcome = await deps.readAttachment(attachment);
    result = outcome.result;
    link = outcome.link ?? {};
  } else if (attachment.type === "link") {
    const outcome = await enrichLinkAttachment(attachment);
    result = outcome.result;
    link = outcome.link;
  } else if (attachment.type === "image") {
    result = await enrichImageAttachment(attachment);
  } else if (attachment.type === 'audio') {
    // Reclaimed/replayed work reuses this owned attachment's committed text.
    // Human transcript corrections are a separate C06 write contract.
    result = attachment.enrichmentStatus === 'ready' && attachment.enrichmentKind === 'audio_transcription'
      ? { status: 'ready', kind: 'audio_transcription', reason: null, text: attachment.enrichmentText ?? '' }
      : await enrichAudioAttachment(attachment);
  } else {
    result = { status: "unavailable", reason: "unsupported_attachment_type" };
  }

  const now = new Date();
  const persisted = await db.transaction(async (tx) => {
    const [parent] = await tx.select({ id: inspirations.id }).from(inspirations)
      .where(and(eq(inspirations.id, attachment.inspirationId), eq(inspirations.profileId, attachment.profileId))).for("update");
    if (!parent) return false;
    const [current] = await tx.select().from(attachments).where(eq(attachments.id, attachmentId)).for("update");
    if (!current) return false;
    if (current.url !== attachment.url || current.type !== attachment.type || current.s3Key !== attachment.s3Key ||
      current.contentType !== attachment.contentType || current.profileId !== attachment.profileId || current.inspirationId !== attachment.inspirationId ||
      (current.type === 'audio' && current.transcriptRevision !== attachment.transcriptRevision)) {
      throw new Error("Attachment material changed during enrichment; retry current source");
    }
    await deps.beforeCommit?.(tx);
    const nextText = result.status === "ready" ? (result.text ?? link.text ?? null) : null;
    const transcriptChanged = current.type === 'audio' && (current.enrichmentStatus !== result.status || current.enrichmentText !== nextText ||
      current.enrichmentKind !== (result.status === 'ready' ? result.kind : null));
    await tx
    .update(attachments)
    .set({
      enrichmentStatus: result.status,
      enrichmentKind: result.status === "ready" ? result.kind : null,
      // A link's text is assembled from its metadata and body; an image's is
      // the description itself, carried on the verdict.
      enrichmentText:
        result.status === "ready" ? (result.text ?? link.text ?? null) : null,
      enrichmentErrorReason: result.status === "ready" ? null : result.reason,
      enrichmentUpdatedAt: now,
      ...(transcriptChanged ? { transcriptRevision: current.transcriptRevision + 1 } : {}),
      finalUrl: link.finalUrl ?? null,
      hostname: link.hostname ?? null,
      title: link.title ?? null,
      description: link.description ?? null,
      siteName: link.siteName ?? null,
      previewImageUrl: link.previewImageUrl ?? null,
      updatedAt: now,
    })
    .where(eq(attachments.id, attachmentId));
    if (current.enrichmentStatus !== result.status || current.enrichmentText !== nextText ||
      current.enrichmentKind !== (result.status === "ready" ? result.kind : null) ||
      current.hostname !== (link.hostname ?? null)) {
      await requestSignalDerivation({ profileId: attachment.profileId, inspirationId: attachment.inspirationId,
        reason: "edited", changedSource: "inspiration" }, tx);
    }
    return true;
  });

  if (persisted) await wakeCommittedBackgroundJobs();
  return persisted ? result : { status: "missing" };
}
