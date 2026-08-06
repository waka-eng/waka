/**
 * Turn a bare-link save into something the pipeline can hear.
 *
 * A save is often just a URL. The heart reacted to something *inside* that
 * page — a line, a person, a moment — and the pipeline embeds text, so the
 * wrapper alone is nearly mute. This module fetches the page's own words
 * (title, description) and stores them beside the save.
 *
 * Deliberately modest: no headless browser, no transcripts, one request per
 * URL with a short timeout. The goal is audibility, not archival. A page that
 * refuses to speak (blocked, dead, empty) is recorded as attempted so it is
 * not knocked on forever.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { and, eq } from "drizzle-orm";

import { inspirations } from "../db/index.js";
import type { WakaDb } from "./inspiration-embeddings.js";

const FETCH_TIMEOUT_MS = 6000;
/** Redirect hops we will follow, each re-checked. Enough for shorteners. */
const MAX_REDIRECTS = 4;
/**
 * How much text a save needs before the pipeline can hear it at all.
 *
 * Enrichment fills silence; it does not add volume. A fixed cap does the
 * opposite: it hands the same budget to a save that is nothing but a URL and
 * to a save whose owner already wrote a thousand words, so the second one
 * doubles in weight for reasons that have nothing to do with what its owner
 * said. That amplifies whoever writes most — the exact imbalance the trigger
 * fairness work exists to remove — while doing nothing extra for the save
 * that actually needed help.
 *
 * So the budget is a TOP-UP toward this floor, not an allowance. A bare link
 * gets the lot; a long note with a link in it gets almost none.
 */
const AUDIBILITY_FLOOR_CHARS = 1200;
/** Never fetch more than this, however silent the save. Not an article mirror. */
const MAX_ENRICHMENT_CHARS = 1600;

/**
 * Below this many readable characters, a save says nothing an embedding can
 * use, and the pipeline must not pretend otherwise.
 *
 * Distinct from {@link AUDIBILITY_FLOOR_CHARS}, which is what enrichment aims
 * *at*. This is the far lower bar for being heard at all — a title and a
 * fragment. The two were previously one number in the lib and a different one
 * in a backfill script, so nothing enforced either.
 *
 * 60 admits one concrete captured sentence while still rejecting bare links,
 * labels, and fragmentary titles. The capture surface is intentionally quick;
 * requiring 120 characters made several coherent sentences collectively
 * invisible to rooms even though the solo context graph could read them.
 */
export const MIN_AUDIBLE_CHARS = 60;

/**
 * How much of this save an embedding can actually read.
 *
 * URLs are stripped before counting, for the same reason the enrichment budget
 * strips them: a long link would otherwise argue that a save is full of words.
 * A bare `https://youtu.be/8IWA3Pud2aA?si=g1k0` is 40 characters of nothing.
 *
 * Enrichment counts, because that is the entire point of it — a link that has
 * been fetched carries the page's own words and is genuinely audible now.
 */
export function audibleLength(text: string, enrichment: string | null): number {
  const ownWords = text.replace(/https?:\/\/\S+/g, " ");
  return `${ownWords} ${enrichment ?? ""}`.replace(/\s+/g, " ").trim().length;
}

/**
 * Can the pipeline hear this save?
 *
 * The gate, not a judgement of worth. A save below the floor still lives on
 * its owner's wall, still belongs to them, and still counts as something they
 * reacted to — it simply cannot seed or support a reading, because there is
 * nothing in it to read. Saving is never gatekept; being *quoted* requires
 * words.
 */
export function isAudible(signal: { text: string; enrichment: string | null }): boolean {
  return audibleLength(signal.text, signal.enrichment) >= MIN_AUDIBLE_CHARS;
}
/**
 * Even a save that needs no help should say WHAT it linked to. This is enough
 * for a title and a blurb — identification, not substance.
 */
const MIN_ENRICHMENT_CHARS = 200;

/**
 * How much page text this save should be topped up with.
 *
 * Measured against the owner's OWN words, with the URL itself discounted: the
 * link is the thing being explained, so counting its characters as content
 * would let a long URL argue that the save is already audible.
 *
 * Exported because the invariant it encodes — thin saves get a lot, thick
 * saves get almost nothing — is the whole point of the module and is not
 * observable through a live fetch.
 */
export function enrichmentBudgetFor(text: string): number {
  const ownWords = text.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  const topUp = AUDIBILITY_FLOOR_CHARS - ownWords.length;
  if (topUp <= MIN_ENRICHMENT_CHARS) return MIN_ENRICHMENT_CHARS;
  return Math.min(topUp, MAX_ENRICHMENT_CHARS);
}
/**
 * How much of a fetched page the extractors are allowed to see.
 *
 * The regexes below run over attacker-chosen HTML: the page belongs to
 * whoever wrote it, and a user only chose to save a link to it. Handing a
 * pattern 1.5 MB of hostile markup is a denial-of-service waiting to be
 * written, and nothing useful lives that far down anyway — og tags and the
 * player JSON are in the head, and the article body extractor takes what it
 * needs from the first screens of markup.
 *
 * Small enough to bound the worst case, large enough that a real article's
 * opening paragraphs are always inside it.
 */
const MAX_HTML_CHARS = 64_000;

/**
 * A realistic browser UA, not an honest bot one. YouTube (and others) serve
 * bot UAs a stripped page with no og tags at all; the page's own words are
 * public, we are fetching them once, and the polite string got us silence.
 */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/** The first http(s) URL in a save's text, or null. */
export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  return match ? match[0] : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    // Hex entities too. Decimal-only left `&#x27;` sitting in stored text —
    // seen on a real save as `&#x27;와인 바꿔치기 논란&#x27;` — which the
    // embedding then reads as part of the words.
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/g, " ");
}

function collapse(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

/**
 * Titles a site serves when it wants a login instead of showing the page.
 *
 * Stored verbatim, these are worse than nothing: a LinkedIn post save came
 * back as "Sign Up | LinkedIn — 500 million+ members | Manage your
 * professional identity…", so the save embedded as *a LinkedIn account page*
 * rather than as the post its owner reacted to. Silence at least leaves the
 * URL's own words standing alone.
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
 * schedule, music credits, comment policy. They say nothing about the video
 * and, on a short description, they outweigh what does.
 *
 * Matched per LINE, never per sentence. An earlier pass split on "." as well
 * and shredded the text it was meant to clean — Korean prose and bare URLs
 * both contain periods, so `사업..` became `사업 —` and `www.youtube.com`
 * became `www — youtube — com`.
 */
const BOILERPLATE_LINE =
  /비즈니스\s*문의|광고\s*문의|협찬|business inquir|인스타그램|틱톡|업로드\s*일정|구독\s*(?:과|및|,)?\s*좋아요|\bBGM\b|음원\s*제공|저작권|편집\s*툴|Premiere\s*Pro|After\s*Effect|댓글은\s*삭제|혐오\s*및\s*차별/i;

/** Places a creator points you at rather than tells you something. */
const SOCIAL_HOST =
  /\b(?:instagram|tiktok|facebook|twitter|threads|patreon|discord|twitch|linkedin|substack|t\.me|open\.kakao|cafe\.naver|blog\.naver)\b/i;

/**
 * Line SHAPES that are a sign-off in any language.
 *
 * The keyword list above only knows the languages someone thought to add, so
 * a Japanese or Spanish creator's sign-off walks straight through it. These
 * do not depend on vocabulary: an address, a link to a profile, or a short
 * `label : url` pair is a pointer somewhere else, not a sentence about the
 * thing. Structure is the durable signal; keywords are the top-up.
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
 * inquiries / instagram / upload schedule" are gone by then, and the two
 * become one run of text that cannot be told apart. `shortDescription` keeps
 * them, so the sign-off can be dropped line by line.
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

/**
 * The page's own prose, for pages that have some.
 *
 * A title and a one-line description are ~200 characters, and a member whose
 * saves are all links therefore carries a fraction of the text of a member who
 * pastes essays — measured on a real board, ~290 characters against ~1,150,
 * which is most of why their saves never won a candidate slot. Paragraphs are
 * where the difference closes.
 *
 * Deliberately crude: `<p>` blocks, script/style stripped, short fragments
 * (nav links, captions, cookie notices) dropped. Not a readability port.
 */
export function extractArticleBody(html: string, budget: number): string | null {
  const article = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? html;
  const cleaned = article
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const paragraphs: string[] = [];
  for (const match of cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = collapse(match[1]!.replace(/<[^>]+>/g, " "));
    // Long enough to be prose rather than a caption, a byline or a nav item.
    if (text.length < 60) continue;
    paragraphs.push(text);
    if (paragraphs.join(" ").length >= budget) break;
  }
  if (paragraphs.length === 0) return null;
  return paragraphs.join(" ").slice(0, budget).trim();
}

/** Pull title + description out of an HTML document, og tags first. */
export function extractHtmlSummary(
  html: string,
  budget: number = MAX_ENRICHMENT_CHARS,
): string | null {
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

  const ogTitle = meta("og:title");
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = ogTitle || (titleTag ? collapse(titleTag[1]!) : null);
  const rawDescription = meta("og:description") || meta("description");
  const description = rawDescription ? stripBoilerplateLines(rawDescription) : null;

  // A page asking for an account is not a page speaking. Return null so the
  // caller records `page_silent` rather than storing the site's own pitch.
  if (isAuthWallSummary(title, rawDescription)) return null;

  const head = [title, description].filter(
    (part): part is string => Boolean(part && part.length > 0),
  );
  if (head.length === 0) return null;

  const summary = head.join(" — ");
  // Prose, when the page has any, is what makes a link save weigh the same as
  // a pasted one. Appended rather than substituted: the title still names the
  // thing, and a page with no paragraphs is no worse off than before.
  const body = extractArticleBody(html, budget - summary.length);
  const full = body ? `${summary} — ${body}` : summary;
  return full.slice(0, budget);
}

/**
 * Is this address one the open internet cannot reach?
 *
 * Loopback, link-local (which on AWS is the instance metadata endpoint at
 * 169.254.169.254), RFC1918, carrier NAT, and the v6 equivalents.
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
    // v4-mapped (::ffff:10.0.0.1) would otherwise slip past the v6 checks.
    const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    if (value === "::1" || value === "::") return true;
    if (/^f[cd]/.test(value)) return true; // unique local
    if (/^fe[89ab]/.test(value)) return true; // link local
    return false;
  }
  return false;
}

/**
 * Server-side fetch of a URL a user typed is an SSRF sink: without this the
 * pipeline would happily read the cloud metadata endpoint or anything else
 * inside the VPC and store the response on a save. Scheme is allowlisted and
 * the host is resolved and checked before we connect.
 *
 * DNS is re-resolved by fetch after this check, so a hostile record could in
 * principle change between the two. Blocking on resolution is still the
 * meaningful barrier, and the response body only ever reaches us as a title
 * and description on one save.
 */
async function assertFetchableUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("unfetchable url");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("unfetchable url: scheme");
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("unfetchable url: private address");
    return;
  }
  const resolved = await lookup(host, { all: true });
  if (resolved.length === 0) throw new Error("unfetchable url: unresolvable");
  // `all`, not the first: a name that returns one public and one private
  // address must not be reachable through the private one.
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("unfetchable url: private address");
  }
}

/**
 * Follow redirects by hand so every hop is checked. `redirect: "follow"` would
 * let a public URL bounce us into the VPC on its second hop, which is the
 * usual way this protection is bypassed.
 */
async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let current = url;
    for (let hop = 0; ; hop += 1) {
      await assertFetchableUrl(current);
      const response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json" },
      });
      const location = response.headers.get("location");
      if (response.status < 300 || response.status >= 400 || !location) return response;
      if (hop >= MAX_REDIRECTS) return response;
      current = new URL(location, current).toString();
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * YouTube blocks plain HTML scraping but publishes oEmbed for exactly this
 * use: title + author, no key required.
 */
async function fetchYouTubeSummary(url: string, budget: number): Promise<string | null> {
  // oEmbed for the reliable title/author; the watch page's og:description for
  // the video's own words. A title alone is often too short to make a save
  // audible — the description is where the content lives.
  let titleLine: string | null = null;
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const res = await fetchWithTimeout(oembed);
    if (res.ok) {
      const body = (await res.json()) as { title?: string; author_name?: string };
      const parts = [body.title, body.author_name && `by ${body.author_name}`].filter(Boolean);
      if (parts.length > 0) titleLine = parts.join(" — ");
    }
  } catch {
    // fall through to the page itself
  }

  let description: string | null = null;
  try {
    const res = await fetchWithTimeout(url);
    if (res.ok) {
      const html = (await res.text()).slice(0, MAX_HTML_CHARS);
      // The player JSON first: it is the only copy of the description that
      // still has line breaks, so it is the only one the sign-off can be
      // stripped out of. `og:description` is the fallback for a page whose
      // shape has changed.
      description = extractYouTubeDescription(html);
      if (!description) {
        const summary = extractHtmlSummary(html, budget);
        // The HTML summary repeats the title; keep only what it adds.
        if (summary && (!titleLine || summary.length > titleLine.length + 20)) {
          description = summary;
        }
      }
    }
  } catch {
    // title alone is still better than silence
  }

  const combined = [titleLine, description].filter(Boolean).join(" — ");
  return combined.length > 0 ? combined.slice(0, budget) : null;
}

/** Fetch what a URL says about itself. Null when the page will not speak. */
export async function fetchUrlEnrichment(
  url: string,
  budget: number = MAX_ENRICHMENT_CHARS,
): Promise<string | null> {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com") {
      return await fetchYouTubeSummary(url, budget);
    }
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;
    // "Meta lives in the head" is a lie on modern sites: YouTube puts its og
    // tags ~690KB in. Read generously; this runs once per URL ever.
    const html = (await res.text()).slice(0, MAX_HTML_CHARS);
    return extractHtmlSummary(html, budget);
  } catch {
    return null;
  }
}

export type EnrichSignalOutcome =
  | "enriched"
  | "no_url"
  | "already_attempted"
  | "page_silent";

/**
 * Best-effort, at-most-once enrichment for one signal.
 *
 * Writes `enriched_at` on every attempt — including failures — so a dead link
 * costs one fetch ever, not one per synthesis pass. `force` re-attempts.
 * Never throws: a save must not fail, and a pass must not stall, over a page
 * that would not speak.
 */
export async function ensureSignalEnrichment(
  db: WakaDb,
  input: { userId: string; signalId: string; force?: boolean },
): Promise<EnrichSignalOutcome> {
  const [row] = await db
    .select({
      text: inspirations.text,
      enrichedAt: inspirations.enrichedAt,
    })
    .from(inspirations)
    .where(and(eq(inspirations.id, input.signalId), eq(inspirations.userId, input.userId)))
    .limit(1);
  if (!row) return "no_url";
  if (row.enrichedAt && !input.force) return "already_attempted";

  const url = extractFirstUrl(row.text);
  if (!url) {
    // Not a link save; mark attempted so it is never scanned again.
    await db
      .update(inspirations)
      .set({ enrichedAt: new Date() })
      .where(and(eq(inspirations.id, input.signalId), eq(inspirations.userId, input.userId)));
    return "no_url";
  }

  // Top up toward the audibility floor, measured against what the owner
  // already wrote. A bare link gets the full budget; a long note with a link
  // in it gets only enough to name what it linked to.
  const enrichment = await fetchUrlEnrichment(url, enrichmentBudgetFor(row.text));
  await db
    .update(inspirations)
    .set({ enrichment, enrichedAt: new Date() })
    .where(and(eq(inspirations.id, input.signalId), eq(inspirations.userId, input.userId)));
  return enrichment ? "enriched" : "page_silent";
}
