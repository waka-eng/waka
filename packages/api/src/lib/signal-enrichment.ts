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
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { eq } from "drizzle-orm";

import {
  attachments,
  type AttachmentEnrichmentKind,
  type AttachmentType,
} from "../db/index.js";
import { getDb } from "./db.js";
import {
  describeImage,
  ImageDescriptionError,
  isDescribableImageType,
  MAX_IMAGE_BYTES,
} from "./image-description.js";
import type { WakaDb } from "./inspiration-embeddings.js";

/**
 * The whole exchange's budget: connect, redirects, headers, and reading the
 * body. Exported because the test that holds this file honest has to wait out
 * a real one — see the stalled-body test in the sibling spec.
 */
export const FETCH_TIMEOUT_MS = 6000;

/** Redirect hops we will follow, each re-checked. Enough for shorteners. */
const MAX_REDIRECTS = 4;

/**
 * How much of a page is kept.
 *
 * Enough for an article's argument, not enough to mirror the article. The cap
 * is also what keeps one saved link from outweighing everything else a profile
 * has ever written when extraction reads its material.
 */
export const MAX_ENRICHMENT_TEXT_CHARS = 4000;

/**
 * How much of a fetched document the extractors are allowed to see.
 *
 * The patterns below run over attacker-chosen HTML: the page belongs to
 * whoever wrote it and a member only chose to save a link to it. Handing a
 * regex a megabyte of hostile markup is a denial of service waiting to be
 * written, and nothing useful lives that far down — metadata sits in the head
 * and the body extractor takes what it needs from the first screens.
 */
const MAX_HTML_CHARS = 128_000;

/**
 * A realistic browser UA, not an honest bot one. Several large sites serve bot
 * UAs a stripped page with no metadata at all; the page's own words are public,
 * we are fetching them once, and the polite string got us silence.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    // Hex entities as well as decimal ones. Seen on a real save as
    // `&#x27;와인 바꿔치기 논란&#x27;`, which extraction then reads as part of
    // the words.
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, " ");
}

function collapse(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

/**
 * Titles a site serves when it wants a login instead of showing the page.
 *
 * Stored verbatim these are worse than nothing: a LinkedIn post save came back
 * as "Sign Up | LinkedIn — 500 million+ members | Manage your professional
 * identity…", so the capture read as *a LinkedIn account page* rather than as
 * the post its owner reacted to. Silence leaves the person's own words standing
 * alone, which is the truthful outcome.
 */
const AUTH_WALL_TITLE =
  /^(?:sign\s?up|sign\s?in|log\s?in|login|register|create an account|join now|로그인|회원가입)\b/i;

/** True when a page is offering an account rather than its content. */
export function isAuthWallSummary(title: string | null, description: string | null): boolean {
  if (!title) return false;
  if (!AUTH_WALL_TITLE.test(title.trim())) return false;
  // A real article may open with the word "Login"; an auth wall pairs that
  // title with the site's generic pitch rather than with a subject.
  const body = (description ?? "").toLowerCase();
  return (
    body.length === 0 ||
    /members|create (?:an )?account|professional (?:identity|network|community)|sign\s?up|join|비밀번호|계정/.test(
      body,
    )
  );
}

/**
 * Lines a creator repeats on every upload: contact addresses, socials, the
 * schedule, music credits, comment policy. They say nothing about the thing
 * and, on a short description, they outweigh what does.
 *
 * Matched per LINE, never per sentence. Splitting on "." as well shreds the
 * text it is meant to clean — Korean prose and bare URLs both contain periods,
 * so `사업..` becomes `사업 —` and `www.youtube.com` becomes `www — youtube — com`.
 */
const BOILERPLATE_LINE =
  /비즈니스\s*문의|광고\s*문의|협찬|business inquir|인스타그램|틱톡|업로드\s*일정|구독\s*(?:과|및|,)?\s*좋아요|\bBGM\b|음원\s*제공|저작권|편집\s*툴|Premiere\s*Pro|After\s*Effect|댓글은\s*삭제|혐오\s*및\s*차별/i;

/** Places a creator points you at rather than tells you something. */
const SOCIAL_HOST =
  /\b(?:instagram|tiktok|facebook|twitter|threads|patreon|discord|twitch|linkedin|substack|t\.me|open\.kakao|cafe\.naver|blog\.naver)\b/i;

/**
 * Line SHAPES that are a sign-off in any language.
 *
 * A keyword list only knows the languages someone thought to add, so a Japanese
 * or Spanish creator's sign-off walks straight through it. These do not depend
 * on vocabulary: an address, a link to a profile, or a short `label : url` pair
 * is a pointer somewhere else, not a sentence about the thing. Structure is the
 * durable signal; keywords are the top-up.
 */
function isStructuralBoilerplate(line: string): boolean {
  // A bare link on its own line.
  if (/^https?:\/\/\S+$/i.test(line)) return true;
  // `label : https://…` — the shape of every "instagram : <url>" line.
  if (/^.{0,40}[:：]\s*https?:\/\/\S+$/i.test(line)) return true;
  // A short line that exists to carry an address.
  if (line.length <= 120 && /[\w.+-]+@[\w.-]+\.\w{2,}/.test(line)) return true;
  // A short line pointing at a profile somewhere else.
  if (line.length <= 160 && SOCIAL_HOST.test(line) && /https?:\/\//i.test(line)) return true;
  return false;
}

/**
 * Drop a creator's standing sign-off from a description, keeping its prose.
 *
 * Structure first, vocabulary second — see {@link isStructuralBoilerplate}.
 */
export function stripBoilerplateLines(value: string): string {
  const kept = value
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !isStructuralBoilerplate(line) && !BOILERPLATE_LINE.test(line),
    );
  return kept.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * A YouTube video's own description, with the creator's sign-off removed.
 *
 * Read from `shortDescription` in the embedded player JSON rather than from
 * `og:description`, because the og tag arrives already whitespace-collapsed —
 * the line breaks that separate "what this video is about" from "business
 * inquiries / instagram / upload schedule" are gone by then, and the two become
 * one run of text that cannot be told apart. `shortDescription` keeps them, so
 * the sign-off can be dropped line by line.
 */
export function extractYouTubeDescription(html: string): string | null {
  const match = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (!match) return null;
  let raw: string;
  try {
    raw = JSON.parse(`"${match[1]!}"`) as string;
  } catch {
    return null;
  }
  const stripped = stripBoilerplateLines(decodeEntities(raw));
  return stripped.length > 0 ? stripped : null;
}

/** Blocks that exist to move you elsewhere rather than to say anything. */
const CHROME_BLOCK =
  /<(script|style|noscript|svg|nav|header|footer|aside|form|template)[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * The page's own prose.
 *
 * This is the point of link enrichment. A title and a one-line blurb are ~200
 * characters — enough to name what was saved, nowhere near enough to know what
 * it argued — so a profile whose captures are all links carries a fraction of
 * the material of one that pastes essays. Paragraphs are where that closes.
 *
 * Deliberately crude: chrome stripped, `<p>` blocks preferred, short fragments
 * (nav links, captions, cookie notices) dropped, and a whole-container fallback
 * for the many pages that never use a paragraph tag. Not a readability port.
 */
export function extractPageBody(html: string, budget = MAX_ENRICHMENT_TEXT_CHARS): string | null {
  if (budget <= 0) return null;
  const container =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ??
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ??
    html;
  const cleaned = container.replace(CHROME_BLOCK, " ").replace(/<!--[\s\S]*?-->/g, " ");

  const paragraphs: string[] = [];
  for (const match of cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = collapse(match[1]!.replace(/<[^>]+>/g, " "));
    // Long enough to be prose rather than a caption, a byline, or a nav item.
    if (text.length < 60) continue;
    paragraphs.push(text);
    if (paragraphs.join(" ").length >= budget) break;
  }
  if (paragraphs.length > 0) return paragraphs.join(" ").slice(0, budget).trim();

  // Div soup. Most pages that hide their content from a paragraph scan are
  // ordinary sites with an unusual template, not empty ones — taking the
  // stripped container is coarse but recovers material that would otherwise
  // be lost entirely.
  const flattened = collapse(cleaned.replace(/<[^>]+>/g, " "));
  if (flattened.length < 60) return null;
  return flattened.slice(0, budget).trim();
}

export interface LinkMetadata {
  title: string | null;
  description: string | null;
  siteName: string | null;
  previewImageUrl: string | null;
}

/** Structured facts a link card renders, og tags first. */
export function extractLinkMetadata(html: string): LinkMetadata {
  const meta = (name: string): string | null => {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']|` +
        `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`,
      "i",
    );
    const m = html.match(re);
    const raw = m?.[1] ?? m?.[2];
    return raw ? collapse(raw) : null;
  };

  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = meta("og:title") || (titleTag ? collapse(titleTag[1]!) : null);
  const rawDescription = meta("og:description") || meta("description");
  const description = rawDescription ? stripBoilerplateLines(rawDescription) : null;

  // A page asking for an account is not a page speaking. Reporting nothing is
  // what makes the caller record `page_silent` instead of storing the site's
  // own pitch as if it were the material.
  if (isAuthWallSummary(title, rawDescription)) {
    return { title: null, description: null, siteName: null, previewImageUrl: null };
  }

  return {
    title: title && title.length > 0 ? title : null,
    description: description && description.length > 0 ? description : null,
    siteName: meta("og:site_name"),
    previewImageUrl: meta("og:image") || meta("twitter:image"),
  };
}

/**
 * One field for extraction to read.
 *
 * The structured columns beside it exist to render a link card; this is the
 * text. It leads with the page's own naming of itself because a video or a
 * gallery frequently has no prose at all, and a title is still material.
 */
export function composeEnrichmentText(
  parts: Array<string | null>,
  cap = MAX_ENRICHMENT_TEXT_CHARS,
): string | null {
  const joined = parts
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0)
    .join(" — ")
    .trim();
  if (joined.length === 0) return null;
  return joined.slice(0, cap);
}

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
 * Handing the caller a `release` is the smallest shape that keeps a single
 * deadline over the entire exchange — connect, redirects, headers, body — while
 * still letting the connection be dropped the moment the caller has what it
 * needs. It costs the callers one discipline: `release` on every exit, which is
 * why both of them call it from a `finally` rather than at the point they
 * happen to be finished.
 */
async function fetchWithTimeout(
  url: string,
  accept = "text/html,application/xhtml+xml",
): Promise<{ response: Response; finalUrl: string; release: () => void }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
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
        // Still ticking. The caller reads the body under this same signal, and
        // now there is something left to trip it.
        return { response, finalUrl: current, release };
      }
      if (hop >= MAX_REDIRECTS) return { response, finalUrl: current, release };
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
  const { response, finalUrl, release } = await fetchWithTimeout(url);
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

    // Bounded read under the fetch's own deadline. MAX_HTML_CHARS is a
    // character budget; a UTF-8 byte cap of 4× is a safe ceiling that still
    // truncates a runaway page.
    const bytes = await readCappedBody(response, MAX_HTML_CHARS * 4);
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

function isYouTubeHost(hostname: string | null): boolean {
  if (!hostname) return false;
  const host = hostname.replace(/^www\./, "");
  return host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com";
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
    const { GetObjectCommand, S3Client } = await import("@aws-sdk/client-s3");
    const region =
      process.env.ATTACHMENTS_REGION || process.env.AWS_REGION || "us-west-2";
    const bucket = process.env.ATTACHMENTS_BUCKET;
    if (!bucket) throw new Error("attachments_bucket_unconfigured");

    const object = await new S3Client({ region }).send(
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
  const { response, release } = await fetchWithTimeout(attachment.url, "image/*");
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
 * Never throws. A dead link, a login wall, or a page of pure JavaScript is an
 * ordinary outcome of saving things from the internet, and none of them should
 * poison a queue or cost a member their capture. The result is returned so the
 * caller can retry the one case worth retrying — `failed`, which means the page
 * was never reached.
 */
export async function enrichAttachment(
  attachmentId: string,
  deps: EnrichAttachmentDeps = {},
): Promise<EnrichAttachmentResult> {
  const db = deps.db ?? getDb();

  const [attachment] = await db
    .select({
      id: attachments.id,
      type: attachments.type,
      url: attachments.url,
      s3Key: attachments.s3Key,
      contentType: attachments.contentType,
    })
    .from(attachments)
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  if (!attachment) return { status: "missing" };

  let result: AttachmentEnrichmentVerdict;
  let link: Partial<LinkEnrichment> = {};

  if (attachment.type === "link") {
    const outcome = await enrichLinkAttachment(attachment);
    result = outcome.result;
    link = outcome.link;
  } else if (attachment.type === "image") {
    result = await enrichImageAttachment(attachment);
  } else {
    result = { status: "unavailable", reason: "unsupported_attachment_type" };
  }

  const now = new Date();
  await db
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
      finalUrl: link.finalUrl ?? null,
      hostname: link.hostname ?? null,
      title: link.title ?? null,
      description: link.description ?? null,
      siteName: link.siteName ?? null,
      previewImageUrl: link.previewImageUrl ?? null,
      updatedAt: now,
    })
    .where(eq(attachments.id, attachmentId));

  return result;
}
