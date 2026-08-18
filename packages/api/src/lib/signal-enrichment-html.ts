/**
 * Reading a saved page: HTML and text in, plain words out.
 *
 * This is the half of attachment enrichment that never touches the network.
 * `signal-enrichment.ts` next door goes and GETS the page — the address guard,
 * the two deadlines, the byte caps, the database write. Everything here is
 * given a string and returns a string, so it can be reasoned about and tested
 * without a socket, a clock, or a fixture server.
 *
 * The seam is real and not merely a line count. Nothing in this file imports
 * anything: no node builtins, no drizzle, no sibling module. That closure is
 * the argument for the split — a set of functions that needs nothing from the
 * rest of the system is already a module, it just had not been given a file.
 *
 * WHAT WAS DELIBERATELY LEFT NEXT DOOR. The fetch deadline is computed from
 * the caller's byte cap so that the two cannot drift into a combination that
 * forbids what it advertises, and both callers that pass a cap sit beside the
 * function that derives from it. Splitting along "link fetching" versus "image
 * description" would have put those two callers in two files with the
 * derivation in a third, which is how the original contradiction happened. So
 * the cut was made where no derived value is separated from what it derives
 * from, and this file is the only place that is true.
 *
 * These functions run over HTML the page's own author wrote, not the member's,
 * and the member only chose to save a link. So the input is hostile by default:
 * every regex here is bounded, and the caller truncates the document before any
 * of it runs. Nothing in this file may be given an unbounded string.
 *
 * Whatever comes out is machine-derived context, never the person's words. A
 * quote drawn from it downstream belongs to the source — attributing an
 * article's claim to its reader would be a statement about them that nobody
 * made.
 */
/**
 * How much of a page is kept.
 *
 * Enough for an article's argument, not enough to mirror the article. The cap
 * is also what keeps one saved link from outweighing everything else a profile
 * has ever written when extraction reads its material.
 */
export const MAX_ENRICHMENT_TEXT_CHARS = 4000;

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

export function isYouTubeHost(hostname: string | null): boolean {
  if (!hostname) return false;
  const host = hostname.replace(/^www\./, "");
  return host === "youtube.com" || host === "youtu.be" || host === "m.youtube.com";
}
