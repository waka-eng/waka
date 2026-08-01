import { describe, expect, it } from "vitest";

import {
  buildCanonicalInspirationEmbeddingInput,
  hashEmbeddingInput,
} from "./inspiration-embeddings.js";
import {
  enrichmentBudgetFor,
  extractArticleBody,
  extractFirstUrl,
  extractHtmlSummary,
  extractYouTubeDescription,
  isAuthWallSummary,
  isPrivateAddress,
  stripBoilerplateLines,
} from "./signal-enrichment.js";

describe("extractFirstUrl", () => {
  it("finds the first link in mixed text", () => {
    expect(extractFirstUrl("watch this https://youtu.be/abc123 before friday")).toBe(
      "https://youtu.be/abc123",
    );
  });

  it("returns null for plain text", () => {
    expect(extractFirstUrl("a thought with no link in it")).toBeNull();
  });

  it("does not swallow trailing punctuation wrappers", () => {
    expect(extractFirstUrl('see (https://example.com/a) now')).toBe("https://example.com/a");
  });
});

describe("extractHtmlSummary", () => {
  it("prefers og tags and joins title with description", () => {
    const html = `<html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="The real title" />
      <meta property="og:description" content="What the page is about" />
    </head></html>`;
    expect(extractHtmlSummary(html)).toBe("The real title — What the page is about");
  });

  it("falls back to title tag and meta description", () => {
    const html = `<head><title>  Plain &amp; simple </title>
      <meta name="description" content="a description"></head>`;
    expect(extractHtmlSummary(html)).toBe("Plain & simple — a description");
  });

  it("returns null for a page with nothing to say", () => {
    expect(extractHtmlSummary("<html><body>no head</body></html>")).toBeNull();
  });

  it("decodes hex entities, not just decimal ones", () => {
    // Seen stored verbatim on a real save: `&#x27;와인 바꿔치기 논란&#x27;`.
    // The embedding read the entity as part of the words.
    const html = `<head><title>&#x27;와인 바꿔치기&#x27; &#39;quoted&#39;</title></head>`;
    expect(extractHtmlSummary(html)).toBe("'와인 바꿔치기' 'quoted'");
  });

  it("says nothing for a page that is asking for an account", () => {
    // A LinkedIn post save came back as LinkedIn's signup page, so the save
    // embedded as *a LinkedIn account page* rather than as the post.
    const html = `<head><title>Sign Up | LinkedIn</title>
      <meta name="description" content="500 million+ members | Manage your professional identity."></head>`;
    expect(extractHtmlSummary(html)).toBeNull();
  });

  it("does not mistake an article about logging in for a login wall", () => {
    const html = `<head><title>Login screens are a design problem</title>
      <meta name="description" content="Why the first screen decides whether anyone sees the second."></head>`;
    expect(extractHtmlSummary(html)).toContain("Login screens are a design problem");
  });

  it("carries the page's own prose, not just its blurb", () => {
    const body = "x".repeat(80);
    const html = `<head><title>T</title><meta name="description" content="D"></head>
      <body><p>nav</p><p>${body}</p></body>`;
    const out = extractHtmlSummary(html);
    expect(out).toContain(body);
    // Short fragments are navigation and captions, not prose.
    expect(out).not.toContain("nav");
  });
});

/**
 * The invariant the module exists to hold. Enrichment fills silence; it does
 * not add volume. A fixed cap gave the same budget to a bare link and to a
 * thousand-word note, which quietly amplified whoever already wrote most —
 * the imbalance the trigger fairness work exists to remove.
 */
describe("enrichmentBudgetFor", () => {
  it("gives a bare link the full top-up", () => {
    expect(enrichmentBudgetFor("https://example.com/a-long-article-slug")).toBeGreaterThan(1000);
  });

  it("gives a save its owner already filled almost nothing", () => {
    const essay = "말".repeat(1400);
    expect(enrichmentBudgetFor(`${essay} https://example.com`)).toBe(200);
  });

  it("scales between the two rather than switching", () => {
    const thin = enrichmentBudgetFor(`${"x".repeat(200)} https://example.com`);
    const thick = enrichmentBudgetFor(`${"x".repeat(800)} https://example.com`);
    expect(thin).toBeGreaterThan(thick);
  });

  /**
   * The URL is the thing being explained, not content. Counting its characters
   * would let a long tracking-laden link argue the save is already audible.
   */
  it("does not let a long URL pass as the owner's own words", () => {
    const longUrl = `https://example.com/${"seg/".repeat(200)}`;
    expect(enrichmentBudgetFor(longUrl)).toBeGreaterThan(1000);
  });
});

describe("stripBoilerplateLines", () => {
  /**
   * Structure over vocabulary: the keyword list only knows the languages
   * someone thought to add, so these shapes must carry the work.
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
   * The bug that killed the first attempt at this: splitting on "." as well as
   * on newlines shredded the text it was meant to clean, because Korean prose
   * and bare URLs both contain periods.
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

  it("returns null when the page has no player JSON", () => {
    expect(extractYouTubeDescription("<html></html>")).toBeNull();
  });
});

describe("extractArticleBody", () => {
  it("keeps paragraphs and skips captions and nav", () => {
    const para = "This is a real paragraph with enough words to be prose rather than a caption.";
    const html = `<article><p>Share</p><p>${para}</p></article>`;
    expect(extractArticleBody(html, 500)).toBe(para);
  });

  it("stays inside its budget", () => {
    const para = "y".repeat(300);
    expect(extractArticleBody(`<p>${para}</p><p>${para}</p>`, 120)).toHaveLength(120);
  });

  it("returns null for a page with no prose", () => {
    expect(extractArticleBody("<body><div>just chrome</div></body>", 500)).toBeNull();
  });
});

describe("enrichment in the embedding input", () => {
  const base = {
    text: "https://example.com/talk",
    kind: "link",
    category: null,
  };

  it("leaves un-enriched inputs byte-identical to the pre-enrichment format", () => {
    // The load-bearing property. Enrichment joins the canonical input only
    // when present, so a row without it hashes exactly as it did before the
    // column existed — and nothing regenerates until a row actually gains
    // enrichment. If this test fails, every stored embedding regenerates.
    const input = buildCanonicalInspirationEmbeddingInput(base);
    expect(input).toBe(
      [
        "waka.inspiration_embedding_input.v2",
        "kind:link",
        "category:null",
        "text:",
        "https://example.com/talk",
        "reflections:",
        "none",
      ].join("\n"),
    );
    expect(buildCanonicalInspirationEmbeddingInput({ ...base, enrichment: null })).toBe(input);
    expect(buildCanonicalInspirationEmbeddingInput({ ...base, enrichment: "" })).toBe(input);
    expect(buildCanonicalInspirationEmbeddingInput({ ...base, enrichment: "   " })).toBe(input);
  });

  it("changes the hash exactly when enrichment appears", () => {
    const before = hashEmbeddingInput(buildCanonicalInspirationEmbeddingInput(base));
    const after = hashEmbeddingInput(
      buildCanonicalInspirationEmbeddingInput({
        ...base,
        enrichment: "The real title — What the page is about",
      }),
    );
    expect(after).not.toBe(before);
  });
});

describe("addresses the enrichment fetch must refuse", () => {
  /**
   * Enrichment fetches a URL a user typed, from inside our network. Without
   * this check that is an SSRF sink: the cloud metadata endpoint at
   * 169.254.169.254 hands out role credentials to anything that asks.
   */
  it("refuses loopback, link-local, and RFC1918 addresses", () => {
    for (const address of [
      "127.0.0.1",
      "0.0.0.0",
      "169.254.169.254", // AWS instance metadata
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
