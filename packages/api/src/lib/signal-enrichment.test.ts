import { describe, expect, it } from "vitest";

import {
  MAX_ENRICHMENT_TEXT_CHARS,
  assertFetchableUrl,
  composeEnrichmentText,
  extractLinkMetadata,
  extractPageBody,
  extractYouTubeDescription,
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
