import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES } from "./image-description.js";
import {
  FETCH_HEADERS_TIMEOUT_MS,
  MAX_ENRICHMENT_TEXT_CHARS,
  MAX_HTML_BYTES,
  assertFetchableUrl,
  bodyTimeoutMs,
  composeEnrichmentText,
  extractLinkMetadata,
  extractPageBody,
  extractYouTubeDescription,
  fetchLinkEnrichment,
  isAuthWallSummary,
  isPrivateAddress,
  stripBoilerplateLines,
} from "./signal-enrichment.js";

describe("extractLinkMetadata", () => {
  it("prefers og tags over the title element", () => {
    const html = `<html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="The real title" />
      <meta property="og:description" content="What the page is about" />
      <meta property="og:site_name" content="Example" />
    </head></html>`;
    expect(extractLinkMetadata(html)).toEqual({
      title: "The real title",
      description: "What the page is about",
      siteName: "Example",
      previewImageUrl: null,
    });
  });

  it("falls back to the title element and the plain description", () => {
    const html = `<head><title>  Plain &amp; simple </title>
      <meta name="description" content="a description"></head>`;
    const metadata = extractLinkMetadata(html);
    expect(metadata.title).toBe("Plain & simple");
    expect(metadata.description).toBe("a description");
  });

  it("decodes hex entities, not only decimal ones", () => {
    // Seen stored verbatim on a real save: `&#x27;와인 바꿔치기 논란&#x27;`.
    // Extraction read the entity itself as part of the words.
    const html = `<head><title>&#x27;와인 바꿔치기&#x27; &#39;quoted&#39;</title></head>`;
    expect(extractLinkMetadata(html).title).toBe("'와인 바꿔치기' 'quoted'");
  });

  it("says nothing for a page that is asking for an account", () => {
    // A LinkedIn post save came back as LinkedIn's signup page, so the capture
    // read as *a LinkedIn account page* rather than as the post.
    const html = `<head><title>Sign Up | LinkedIn</title>
      <meta name="description" content="500 million+ members | Manage your professional identity."></head>`;
    expect(extractLinkMetadata(html)).toEqual({
      title: null,
      description: null,
      siteName: null,
      previewImageUrl: null,
    });
  });

  it("does not mistake an article about logging in for a login wall", () => {
    expect(
      isAuthWallSummary(
        "Login screens are a design problem",
        "Why the first screen decides whether anyone sees the second.",
      ),
    ).toBe(false);
  });
});

/**
 * The point of link enrichment. A title and a blurb name what was saved; only
 * the body says what it argued, and extraction can cite nothing it cannot read.
 */
describe("extractPageBody", () => {
  it("keeps paragraphs and skips captions and navigation", () => {
    const para = "This is a real paragraph with enough words to be prose rather than a caption.";
    const html = `<article><p>Share</p><p>${para}</p></article>`;
    expect(extractPageBody(html, 500)).toBe(para);
  });

  it("drops the chrome around the prose", () => {
    const para = "The argument of the piece, stated at enough length to count as prose.";
    const html = `<body>
      <nav><p>Home — About — Contact — Subscribe to the newsletter today</p></nav>
      <script>var tracking = "Home About Contact Subscribe";</script>
      <main><p>${para}</p></main>
      <footer><p>Copyright, all rights reserved, terms of service and privacy</p></footer>
    </body>`;
    expect(extractPageBody(html, 500)).toBe(para);
  });

  it("reads a page that never uses a paragraph tag", () => {
    // Div soup is an unusual template, not an empty page. Losing it entirely
    // would silence a whole class of ordinary sites.
    const html = `<main><div><span>${"the body of a div-only page ".repeat(4)}</span></div></main>`;
    expect(extractPageBody(html, 500)).toContain("the body of a div-only page");
  });

  it("stays inside its budget", () => {
    const para = "y".repeat(300);
    expect(extractPageBody(`<p>${para}</p><p>${para}</p>`, 120)).toHaveLength(120);
  });

  it("returns null for a page with nothing to read", () => {
    expect(extractPageBody("<body><div>chrome</div></body>", 500)).toBeNull();
  });
});

describe("stripBoilerplateLines", () => {
  /**
   * Structure over vocabulary: a keyword list only knows the languages someone
   * thought to add, so these shapes have to carry the work.
   */
  it("drops sign-off shapes in a language the keyword list never learned", () => {
    const description = [
      "気候変動と都市計画についての話",
      "お仕事のご依頼 : contacto@ejemplo.jp",
      "Instagram : https://instagram.com/ejemplo",
      "https://t.me/canal",
    ].join("\n");
    expect(stripBoilerplateLines(description)).toBe("気候変動と都市計画についての話");
  });

  it("keeps a sentence that merely mentions a subject in passing", () => {
    const line = "The paper argues that Instagram reshaped how cities are photographed.";
    expect(stripBoilerplateLines(line)).toBe(line);
  });

  it("drops a creator's standing sign-off and keeps the subject", () => {
    const description = [
      "#스웨덴 #난민 #이민",
      "비즈니스 문의 : scopepublic@naver.com",
      "인스타그램 : https://www.instagram.com/hanip_reels",
      "업로드 일정 : 매주 토요일 오전 11시",
    ].join("\n");
    expect(stripBoilerplateLines(description)).toBe("#스웨덴 #난민 #이민");
  });

  /**
   * Splitting on "." as well as on newlines shreds the text it is meant to
   * clean: Korean prose and bare URLs both contain periods.
   */
  it("never splits prose or URLs on their periods", () => {
    const line = "정주영도 너무 힘들었던 사업.. 참고 https://www.youtube.com/watch?v=abc";
    expect(stripBoilerplateLines(line)).toBe(line);
  });
});

describe("extractYouTubeDescription", () => {
  it("reads the description that still has its line breaks", () => {
    // og:description arrives whitespace-collapsed, so the boundary between the
    // subject and the sign-off is already gone by then. The player JSON keeps it.
    const html = `<script>var x = {"shortDescription":"왜 정책이 중요한가\\n\\n비즈니스 문의 : a@b.com\\n인스타그램 : https://instagram.com/x"};</script>`;
    expect(extractYouTubeDescription(html)).toBe("왜 정책이 중요한가");
  });

  it("returns null when the page carries no player JSON", () => {
    expect(extractYouTubeDescription("<html></html>")).toBeNull();
  });
});

describe("composeEnrichmentText", () => {
  it("leads with what the page calls itself, then what it says", () => {
    expect(composeEnrichmentText(["A title", null, "The body."])).toBe("A title — The body.");
  });

  it("is null when the page offered nothing", () => {
    expect(composeEnrichmentText([null, "", "   "])).toBeNull();
  });

  it("caps what one saved link can contribute", () => {
    const text = composeEnrichmentText(["t", "x".repeat(MAX_ENRICHMENT_TEXT_CHARS * 2)]);
    expect(text).toHaveLength(MAX_ENRICHMENT_TEXT_CHARS);
  });
});

describe("addresses the enrichment fetch must refuse", () => {
  /**
   * Enrichment fetches a URL a member typed, from inside our network. Unguarded
   * that is an SSRF sink: the cloud metadata endpoint at 169.254.169.254 hands
   * role credentials to anything that asks.
   */
  it("refuses loopback, link-local, and RFC1918 addresses", () => {
    for (const address of [
      "127.0.0.1",
      "0.0.0.0",
      "169.254.169.254", // instance metadata
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1", // carrier NAT
      "::1",
      "fd00::1", // unique local
      "fe80::1", // link local
      "::ffff:169.254.169.254", // v4-mapped, the usual bypass
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["93.184.216.34", "8.8.8.8", "172.32.0.1", "2606:2800:220:1::1"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

/** Address literals only, so the guard is proven without asking a resolver. */
describe("assertFetchableUrl", () => {
  it("refuses a scheme that is not http(s)", async () => {
    await expect(assertFetchableUrl("file:///etc/passwd")).rejects.toThrow("unsupported_scheme");
    await expect(assertFetchableUrl("gopher://example.com/")).rejects.toThrow(
      "unsupported_scheme",
    );
  });

  it("refuses the metadata endpoint and the private ranges", async () => {
    await expect(assertFetchableUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      "private_address",
    );
    await expect(assertFetchableUrl("http://127.0.0.1:5432/")).rejects.toThrow("private_address");
    await expect(assertFetchableUrl("http://[::1]/")).rejects.toThrow("private_address");
  });

  it("refuses something that is not a URL at all", async () => {
    await expect(assertFetchableUrl("not a url")).rejects.toThrow("unfetchable_url");
  });

  it("allows a public address literal", async () => {
    await expect(assertFetchableUrl("https://93.184.216.34/article")).resolves.toBeUndefined();
  });
});

/**
 * A RULE NOBODY CAN EXECUTE IS A RULE NOBODY HAS CHECKED.
 *
 * The v4-mapped branch of `isPrivateAddress` was written against the DOTTED
 * spelling and the only caller never produces it — `new URL().hostname`
 * re-serialises a v4-mapped literal to hex — so the branch was dead on the
 * one path that reaches it, and the metadata endpoint was fetchable. These
 * assert the shapes the URL parser actually emits, not the shapes the
 * function was written for.
 */
describe("isPrivateAddress — IPv4 hiding inside IPv6", () => {
  const parsedHost = (u: string) => new URL(u).hostname.replace(/^\[|\]$/g, "");

  it("refuses the cloud metadata endpoint however it is spelled", () => {
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("::ffff:169.254.169.254")).toBe(true);
    // the form the WHATWG parser actually hands the guard
    expect(isPrivateAddress("::ffff:a9fe:a9fe")).toBe(true);
    expect(isPrivateAddress(parsedHost("http://[::ffff:169.254.169.254]/"))).toBe(true);
  });

  it("refuses loopback and RFC1918 through the same disguise", () => {
    expect(isPrivateAddress(parsedHost("http://[::ffff:127.0.0.1]/"))).toBe(true);
    expect(isPrivateAddress(parsedHost("http://[::ffff:10.0.0.1]/"))).toBe(true);
    expect(isPrivateAddress(parsedHost("http://[::ffff:192.168.1.1]/"))).toBe(true);
  });

  it("refuses the other prefixes that carry a v4 address", () => {
    expect(isPrivateAddress("64:ff9b::a9fe:a9fe")).toBe(true); // NAT64
    expect(isPrivateAddress("::7f00:1")).toBe(true); // v4-compatible loopback
  });

  it("still allows ordinary public addresses", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
    expect(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
    expect(isPrivateAddress("::ffff:93.184.216.34")).toBe(false);
  });
});

/**
 * A DEADLINE MUST BE ABLE TO PAY FOR THE ALLOWANCE ADVERTISED BESIDE IT.
 *
 * A byte cap in one file and a deadline in another can be individually
 * reasonable and jointly impossible, and nothing notices, because no single
 * line is wrong. That is what happened here: the deadline was stretched to
 * cover the body read without anyone asking whether it could still deliver
 * MAX_IMAGE_BYTES, and it could not — 8 MiB in six seconds needs an origin
 * sustaining well over a megabyte a second, so the cap was advertising an
 * allowance most real servers could not spend.
 *
 * These cost nothing to run and are the reason the two numbers cannot drift
 * apart again: raise a cap without raising its budget and the arithmetic here
 * says so, in the suite, rather than in a report about images that never get
 * described.
 */
describe("what the body deadline can actually pay for", () => {
  /**
   * An unremarkable origin: a megabyte a second. Not a CDN, not a drip — the
   * middle of the range these fetches actually meet, and deliberately NOT the
   * floor rate the budget is derived from, which would make this arithmetic
   * true by construction and prove nothing.
   */
  const ORDINARY_BYTES_PER_SEC = 1_000_000;

  function deliverableWithin(budgetMs: number): number {
    return (budgetMs / 1000) * ORDINARY_BYTES_PER_SEC;
  }

  it("gives an image cap's worth of bytes time to arrive", () => {
    expect(deliverableWithin(bodyTimeoutMs(MAX_IMAGE_BYTES + 1))).toBeGreaterThan(
      MAX_IMAGE_BYTES,
    );
  });

  it("gives a page cap's worth of bytes time to arrive", () => {
    expect(deliverableWithin(bodyTimeoutMs(MAX_HTML_BYTES))).toBeGreaterThan(
      MAX_HTML_BYTES,
    );
  });
});

/**
 * A DEADLINE THAT EXPIRES BEFORE THE SLOW PART IS NOT A DEADLINE — AND ONE
 * THAT EXPIRES DURING THE HONEST PART IS NOT A DEADLINE EITHER.
 *
 * `fetch` resolves at the response HEADERS, so a timer cleared when the fetch
 * helper returns is already gone by the time the body — the only part whose
 * pace the other end chooses — is read. The helper's own comment claimed the
 * opposite, and nothing executed the claim.
 *
 * Making the deadline survive into the body read fixes that and immediately
 * creates the opposite hazard, which is why these come in pairs. Every test
 * below that proves something is cut off has a sibling proving that something
 * slower than the headers budget, but genuinely finishing, is not. Only one of
 * those two failures shows up as a hang in a log; the other shows up as a
 * member's saved page silently never getting enriched, because an abort is a
 * retryable failure that then fails identically on every retry until the
 * attempts run out. The quiet one needs the test more.
 *
 * These run against a real loopback server through the real fetch stack on
 * purpose. The whole question is whether an abort reaches a socket that is
 * mid-stream; a stubbed response body would only prove that our stub honours
 * our own signal, which is the part that was never in doubt.
 *
 * They cost real seconds, because the real seconds are what ships. A shortened
 * deadline injected for the test would be a different mechanism from the one
 * running in production, and this is precisely the file where "the test
 * passed" and "the guard works" came apart once already.
 */
describe("the enrichment fetch deadline", () => {
  let server: Server | null = null;
  const allowlistBefore = process.env.WAKA_ENRICHMENT_ALLOWED_HOSTS;

  afterEach(async () => {
    if (allowlistBefore === undefined) delete process.env.WAKA_ENRICHMENT_ALLOWED_HOSTS;
    else process.env.WAKA_ENRICHMENT_ALLOWED_HOSTS = allowlistBefore;

    const running = server;
    server = null;
    if (!running) return;
    running.closeAllConnections();
    await new Promise<void>((resolve) => running.close(() => resolve()));
  });

  /**
   * A page served from loopback, which the address guard refuses outright
   * unless the host is named — so the fixture names it, the same narrow
   * exception `enrichmentHostAllowlist` exists for.
   */
  async function serveOnLoopback(handler: RequestListener): Promise<string> {
    const started = createServer(handler);
    // Aborting mid-stream destroys the socket under a response that may still
    // be writing. That is the behaviour under test, not a broken fixture, so
    // the resulting stream errors are swallowed rather than left to take the
    // whole run down as an unhandled event.
    started.on("clientError", () => undefined);
    server = started;
    await new Promise<void>((resolve) => started.listen(0, "127.0.0.1", resolve));
    const { port } = started.address() as AddressInfo;
    process.env.WAKA_ENRICHMENT_ALLOWED_HOSTS = `127.0.0.1:${port}`;
    return `http://127.0.0.1:${port}/`;
  }

  /**
   * What the link path actually gets to read its body in, asked of production
   * rather than restated here — the whole point of deriving it from the byte
   * cap is that a change to either moves both, and a number copied into the
   * test would be the one thing that did not move.
   */
  const LINK_BODY_MS = bodyTimeoutMs(MAX_HTML_BYTES);

  it(
    "gives up on a page that answers its headers and then dribbles its body",
    async () => {
      // The shape that walked straight through the old code: headers at once,
      // then a byte at a time, forever. Every byte that does arrive resets
      // undici's own inactivity timer, so nothing underneath us will ever call
      // time on it — the enrichment deadline is the only thing that can, and it
      // had already been cleared.
      let drip: NodeJS.Timeout | undefined;
      const url = await serveOnLoopback((_req, res) => {
        res.on("error", () => undefined);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.write("<html><head><title>");
        drip = setInterval(() => res.write("."), 100);
        res.on("close", () => clearInterval(drip));
      });

      const startedAt = Date.now();
      // The abort, specifically. A bare `.rejects.toThrow()` would also be
      // satisfied by the connection failing for some unrelated reason, which
      // would prove nothing about the deadline.
      await expect(fetchLinkEnrichment(url)).rejects.toThrow(/abort/i);
      const elapsed = Date.now() - startedAt;
      clearInterval(drip);

      // Near the body deadline — not near the Lambda's fourteen minutes, which
      // is how long every other account's derivation used to wait behind this
      // one job on the shared worker. The headers landed at once here, so the
      // upper bound is the worst case the two phases can add up to.
      expect(elapsed).toBeGreaterThanOrEqual(LINK_BODY_MS - 1000);
      expect(elapsed).toBeLessThan(LINK_BODY_MS + FETCH_HEADERS_TIMEOUT_MS);
    },
    LINK_BODY_MS * 3,
  );

  /**
   * THE CASE THIS CHANGE CAN BREAK, WHICH IS WHY IT IS TESTED.
   *
   * Not everything slow is hostile. A server-rendered page under load, a cold
   * cache, a database behind the request — these answer their headers at once
   * and then take seconds to produce a body of one or two kilobytes, nowhere
   * near any cap. Before the deadline reached past the headers, that page was
   * read without complaint; a six-second budget stretched over the whole
   * exchange would have started refusing it.
   *
   * So the fixture takes longer than the headers budget on purpose, and the
   * elapsed assertion is not decoration: without it, someone could quietly
   * shorten the pause and leave behind a test that only proves a fast page is
   * fast. It has to be the slow one that succeeds, or it proves nothing.
   */
  it(
    "still reads a small page from an origin slower than the headers budget",
    async () => {
      const paragraph =
        "The argument of the piece, arriving late because the origin was busy, not because it was lying.";
      // Comfortably past FETCH_HEADERS_TIMEOUT_MS so the test is about the body
      // phase, and comfortably inside LINK_BODY_MS so it is about a page that
      // finishes rather than one that is cut off. Both margins are seconds
      // wide, because a timing test that fails on a loaded machine teaches
      // people to rerun the suite until it is green.
      const bodyDelayMs = FETCH_HEADERS_TIMEOUT_MS + 1500;
      let thinking: NodeJS.Timeout | undefined;
      const url = await serveOnLoopback((_req, res) => {
        res.on("error", () => undefined);
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.write(`<html><head><title>Slow but real</title></head><body><main>`);
        thinking = setTimeout(() => {
          res.end(`<p>${paragraph}</p></main></body></html>`);
        }, bodyDelayMs);
        res.on("close", () => clearTimeout(thinking));
      });

      const startedAt = Date.now();
      const enrichment = await fetchLinkEnrichment(url);
      const elapsed = Date.now() - startedAt;
      clearTimeout(thinking);

      expect(enrichment.title).toBe("Slow but real");
      expect(enrichment.text).toContain(paragraph);
      // It really did outlive the headers budget, and it really did land
      // inside the body one.
      expect(elapsed).toBeGreaterThan(FETCH_HEADERS_TIMEOUT_MS);
      expect(elapsed).toBeLessThan(LINK_BODY_MS);
    },
    LINK_BODY_MS * 3,
  );

  /**
   * The other half of the same change: the deadline now outlives the fetch, so
   * every exit has to hand it back. If `release` were missed on the ordinary
   * path this would still return a title, and then hold a live timer and an
   * open socket afterwards.
   */
  it("still reads a page that answers promptly", async () => {
    const paragraph =
      "The argument of the piece, stated at enough length that the body extractor treats it as prose.";
    const url = await serveOnLoopback((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<html><head><title>A page that finished</title></head>` +
          `<body><main><p>${paragraph}</p></main></body></html>`,
      );
    });

    const enrichment = await fetchLinkEnrichment(url);
    expect(enrichment.title).toBe("A page that finished");
    expect(enrichment.text).toContain(paragraph);
  });
});
