const URL_IMPORT_SUPPORTED_HTML_CONTENT_TYPE_PATTERN =
  /\b(?:text\/html|application\/xhtml\+xml)\b/i;
export const URL_IMPORT_FETCH_TIMEOUT_MS = 10_000;

const URL_IMPORT_REMOVAL_SELECTORS = [
  "aside",
  "footer",
  "form",
  "header",
  "iframe",
  "nav",
  "noscript",
  "script",
  "style",
  "template",
  "svg",
  "[aria-hidden='true']",
  "[hidden]",
  "[role='banner']",
  "[role='complementary']",
  "[role='contentinfo']",
  "[role='navigation']",
  "[data-ad]",
  "[data-ad-client]",
  "[data-ad-slot]",
  "[class*='advert']",
  "[class*='banner']",
  "[class*='cookie']",
  "[class*='newsletter']",
  "[class*='popup']",
  "[id*='advert']",
  "[id*='banner']",
  "[id*='cookie']",
  "[id*='newsletter']",
] as const;

export interface UrlImportExtractionRequest {
  rawContent: string;
  sourceUrl: string;
}

export interface UrlImportExtractionResult {
  content: string;
  sourceMeta?: UrlImportSourceMeta;
  title?: string;
}

export interface UrlImportExtractor {
  extract(
    request: UrlImportExtractionRequest,
  ): Promise<UrlImportExtractionResult>;
}

export interface UrlImportExtractorDependencies {
  clearTimeout?: typeof globalThis.clearTimeout;
  fetch?: typeof fetch;
  setTimeout?: typeof globalThis.setTimeout;
  timeoutMs?: number;
}

export type UrlImportContentType =
  | "article"
  | "video"
  | "pdf"
  | "image"
  | "other";

export interface UrlImportSourceMeta {
  contentType: UrlImportContentType;
  domain: string;
  favicon?: string;
  ogDescription?: string;
  ogImage?: string;
  ogTitle?: string;
}

interface UrlImportCheerioStatic {
  load(html: string): UrlImportCheerioApi;
}

interface UrlImportCheerioApi {
  html(): string;
  text(): string;
  remove(): void;
  first(): UrlImportCheerioApi;
  find(selector: string): UrlImportCheerioApi;
  attr(name: string): string | undefined;
  length: number;
  (selector: string): UrlImportCheerioApi;
}

interface UrlImportJsdomModule {
  new (
    html: string,
    options: {
      url: string;
    },
  ): {
    window: {
      document: unknown;
    };
  };
}

interface UrlImportReadabilityArticle {
  textContent?: string | null;
  title?: string | null;
}

interface UrlImportReadabilityModule {
  new (document: unknown): {
    parse(): UrlImportReadabilityArticle | null;
  };
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function resolveAbsoluteUrl(
  value: string | undefined,
  sourceUrl: string,
): string | undefined {
  const normalizedValue = readOptionalTrimmedString(value);

  if (normalizedValue === undefined) {
    return undefined;
  }

  try {
    return new URL(normalizedValue, sourceUrl).toString();
  } catch {
    return undefined;
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function selectLongestTextBlock(
  candidates: readonly string[],
): string | undefined {
  let selectedCandidate: string | undefined;

  for (const candidate of candidates) {
    if (
      selectedCandidate === undefined ||
      candidate.length > selectedCandidate.length
    ) {
      selectedCandidate = candidate;
    }
  }

  return selectedCandidate;
}

function extractFallbackArticleText($: UrlImportCheerioApi): string | undefined {
  const candidates = [
    normalizeWhitespace($("article").first().text()),
    normalizeWhitespace($("main").first().text()),
    normalizeWhitespace($("[role='main']").first().text()),
    normalizeWhitespace($("body").text()),
  ].filter((candidate) => candidate.length > 0);

  return selectLongestTextBlock(candidates);
}

function extractDocumentTitle($: UrlImportCheerioApi): string | undefined {
  return (
    readOptionalTrimmedString($("meta[property='og:title']").attr("content")) ??
    readOptionalTrimmedString($("title").first().text()) ??
    readOptionalTrimmedString($("h1").first().text())
  );
}

function readFirstMetadataContent(
  $: UrlImportCheerioApi,
  selectors: readonly string[],
): string | undefined {
  for (const selector of selectors) {
    const value = readOptionalTrimmedString(
      $(selector).first().attr("content"),
    );

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function readFirstHrefAttribute(
  $: UrlImportCheerioApi,
  selectors: readonly string[],
): string | undefined {
  for (const selector of selectors) {
    const value = readOptionalTrimmedString($(selector).first().attr("href"));

    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function resolveUrlImportDomain(sourceUrl: string): string {
  return new URL(sourceUrl).hostname.toLowerCase();
}

function formatUrlImportTimeoutSeconds(timeoutMs: number): string {
  const timeoutSeconds = timeoutMs / 1000;

  return Number.isInteger(timeoutSeconds)
    ? timeoutSeconds.toString()
    : timeoutSeconds.toFixed(1);
}

function createUrlImportFetchTimeoutError(
  sourceUrl: string,
  timeoutMs: number,
): Error {
  return new Error(
    `URL import timed out after ${formatUrlImportTimeoutSeconds(timeoutMs)} seconds for ${sourceUrl}.`,
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function normalizeUrlImportContentType(
  rawValue: string | undefined,
): UrlImportContentType {
  const normalizedValue = rawValue?.trim().toLowerCase();

  if (normalizedValue?.includes("video")) {
    return "video";
  }

  if (normalizedValue?.includes("image")) {
    return "image";
  }

  if (normalizedValue?.includes("pdf")) {
    return "pdf";
  }

  if (
    normalizedValue === undefined ||
    normalizedValue.length === 0 ||
    normalizedValue.includes("article")
  ) {
    return "article";
  }

  return "other";
}

function buildUrlImportSourceMeta(
  $: UrlImportCheerioApi,
  args: {
    sourceUrl: string;
    title?: string;
  },
): UrlImportSourceMeta {
  const ogTitle =
    readFirstMetadataContent($, [
      "meta[property='og:title']",
      "meta[name='twitter:title']",
    ]) ?? args.title;
  const ogDescription =
    readFirstMetadataContent($, [
      "meta[property='og:description']",
      "meta[name='description']",
      "meta[name='twitter:description']",
    ]);
  const ogImage = resolveAbsoluteUrl(
    readFirstMetadataContent($, [
      "meta[property='og:image:secure_url']",
      "meta[property='og:image:url']",
      "meta[property='og:image']",
      "meta[name='twitter:image']",
    ]),
    args.sourceUrl,
  );
  const favicon = resolveAbsoluteUrl(
    readFirstHrefAttribute($, [
      "link[rel='apple-touch-icon']",
      "link[rel='shortcut icon']",
      "link[rel='icon']",
      "link[rel='alternate icon']",
    ]) ?? "/favicon.ico",
    args.sourceUrl,
  );
  const contentType = normalizeUrlImportContentType(
    readFirstMetadataContent($, [
      "meta[property='og:type']",
      "meta[name='og:type']",
    ]),
  );

  return {
    contentType,
    domain: resolveUrlImportDomain(args.sourceUrl),
    ...(favicon === undefined ? {} : { favicon }),
    ...(ogDescription === undefined ? {} : { ogDescription }),
    ...(ogImage === undefined ? {} : { ogImage }),
    ...(ogTitle === undefined ? {} : { ogTitle }),
  };
}

async function loadUrlImportDependencies(): Promise<{
  JSDOM: UrlImportJsdomModule;
  Readability: UrlImportReadabilityModule;
  cheerio: UrlImportCheerioStatic;
}> {
  const [cheerioModule, jsdomModule, readabilityModule] = await Promise.all([
    import("cheerio"),
    import("jsdom"),
    import("@mozilla/readability"),
  ]);

  const cheerio = cheerioModule as unknown as Partial<UrlImportCheerioStatic>;
  const JSDOM = (jsdomModule as unknown as { JSDOM?: UrlImportJsdomModule })
    .JSDOM;
  const Readability = (
    readabilityModule as unknown as { Readability?: UrlImportReadabilityModule }
  ).Readability;

  if (typeof cheerio.load !== "function") {
    throw new Error("cheerio.load is not available for URL imports.");
  }

  if (typeof JSDOM !== "function") {
    throw new Error("jsdom.JSDOM is not available for URL imports.");
  }

  if (typeof Readability !== "function") {
    throw new Error(
      "@mozilla/readability.Readability is not available for URL imports.",
    );
  }

  return {
    JSDOM,
    Readability,
    cheerio: cheerio as UrlImportCheerioStatic,
  };
}

export function isPureUrlImportCapture(
  rawContent: string,
  sourceUrl: string,
): boolean {
  const normalizedRawContent = rawContent.trim();
  const normalizedSourceUrl = sourceUrl.trim();

  try {
    return (
      new URL(normalizedRawContent).toString() ===
      new URL(normalizedSourceUrl).toString()
    );
  } catch {
    return normalizedRawContent === normalizedSourceUrl;
  }
}

export async function extractUrlImportContentFromHtml(args: {
  html: string;
  sourceUrl: string;
}): Promise<UrlImportExtractionResult> {
  const { JSDOM, Readability, cheerio } = await loadUrlImportDependencies();
  const $ = cheerio.load(args.html);

  $(URL_IMPORT_REMOVAL_SELECTORS.join(", ")).remove();

  const sanitizedHtml = $.html();
  const document = new JSDOM(sanitizedHtml, {
    url: args.sourceUrl,
  }).window.document;
  const article = new Readability(document).parse();
  const readabilityText = normalizeWhitespace(
    readOptionalTrimmedString(article?.textContent) ?? "",
  );
  const fallbackText = extractFallbackArticleText($);
  const content = readOptionalTrimmedString(readabilityText) ?? fallbackText;

  if (content === undefined) {
    throw new Error(
      `Could not extract meaningful content from ${args.sourceUrl}.`,
    );
  }

  const title =
    readOptionalTrimmedString(article?.title) ?? extractDocumentTitle($);
  const sourceMeta = buildUrlImportSourceMeta($, {
    sourceUrl: args.sourceUrl,
    ...(title === undefined ? {} : { title }),
  });

  return {
    content,
    sourceMeta,
    ...(title === undefined ? {} : { title }),
  };
}

export async function extractUrlImportContent(
  request: UrlImportExtractionRequest,
  dependencies: UrlImportExtractorDependencies = {},
): Promise<UrlImportExtractionResult> {
  const fetchImplementation = dependencies.fetch ?? fetch;
  const setTimeoutImplementation =
    dependencies.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const clearTimeoutImplementation =
    dependencies.clearTimeout ?? globalThis.clearTimeout.bind(globalThis);
  const timeoutMs = dependencies.timeoutMs ?? URL_IMPORT_FETCH_TIMEOUT_MS;
  const abortController = new AbortController();
  const timeoutError = createUrlImportFetchTimeoutError(
    request.sourceUrl,
    timeoutMs,
  );
  const timeoutId = setTimeoutImplementation(() => {
    abortController.abort(timeoutError);
  }, timeoutMs);
  let response: Response;

  try {
    response = await fetchImplementation(request.sourceUrl, {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
      signal: abortController.signal,
    });
  } catch (error) {
    if (
      abortController.signal.aborted &&
      abortController.signal.reason === timeoutError &&
      (error === timeoutError || isAbortError(error))
    ) {
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeoutImplementation(timeoutId);
  }

  if (!response.ok) {
    throw new Error(
      `URL import fetch failed for ${request.sourceUrl} with status ${response.status}.`,
    );
  }

  const contentType = readOptionalTrimmedString(
    response.headers.get("content-type"),
  );

  if (
    contentType !== undefined &&
    !URL_IMPORT_SUPPORTED_HTML_CONTENT_TYPE_PATTERN.test(contentType)
  ) {
    throw new Error(
      `URL import extraction only supports HTML content; received ${contentType}.`,
    );
  }

  const html = await response.text();

  return extractUrlImportContentFromHtml({
    html,
    sourceUrl: request.sourceUrl,
  });
}

export function createUrlImportExtractor(
  dependencies: UrlImportExtractorDependencies = {},
): UrlImportExtractor {
  return {
    async extract(request) {
      return extractUrlImportContent(request, dependencies);
    },
  };
}
