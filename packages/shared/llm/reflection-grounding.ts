export interface ReflectionGroundingContext {
  details: readonly string[];
  phrases: readonly string[];
  themes: readonly string[];
}

const DETAIL_MARKERS = [
  "instead of",
  "rather than",
  "versus",
  "vs",
  "because",
  "while",
  "without",
  "but",
] as const;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "back",
  "be",
  "been",
  "being",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "if",
  "in",
  "into",
  "is",
  "it",
  "instead",
  "its",
  "itself",
  "just",
  "later",
  "maybe",
  "more",
  "my",
  "of",
  "on",
  "or",
  "our",
  "should",
  "so",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "up",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "why",
  "with",
  "without",
  "worth",
  "would",
  "yet",
  "you",
  "your",
  "earlier",
]);

const MAX_GROUNDING_ITEMS_PER_KIND = 2;
const MAX_REFLECTION_ANCHOR_LENGTH = 84;

const GENERIC_REFLECTION_PATTERNS = [
  /\bwhat exactly sparked(?: this| the| your)?(?: thought| idea| capture| note)?\b/iu,
  /\bwhat specifically sparked(?: this| the| your)?(?: thought| idea| capture| note)?\b/iu,
  /\bwhat about (?:this|the|your)\s+(?:thought|idea|capture|note)\b/iu,
  /\bwhat makes (?:this|the|your)\s+(?:thought|idea|capture|note)\s+worth keeping\b/iu,
  /\bwhy (?:does|did) (?:this|the|your)\s+(?:thought|idea|capture|note)\b.*\bmatter(?: to you)?\b/iu,
  /\bwhy did you save (?:this|it)\b/iu,
  /\bhow does .+\bmake you feel\b/iu,
  /\bwhat does .+\bmean to you\b/iu,
  /\bwhat stands out to you\b/iu,
] as const;

const GENERIC_REFLECTION_REFERENCE_TOKENS = new Set([
  "capture",
  "captures",
  "idea",
  "ideas",
  "inspiration",
  "inspirations",
  "note",
  "notes",
  "pattern",
  "patterns",
  "thought",
  "thoughts",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function stripTerminalPunctuation(value: string): string {
  return value.replace(/[.,;:!?]+$/u, "").trim();
}

function normalizeGroundingSnippet(value: string): string | undefined {
  const normalized = stripTerminalPunctuation(normalizeWhitespace(value));

  return normalized.length > 0 ? normalized : undefined;
}

function stripWordEdgePunctuation(value: string): string {
  return value.replace(/^[^a-z0-9]+|[^a-z0-9]+$/giu, "");
}

function isStopWord(value: string): boolean {
  return STOP_WORDS.has(value.toLowerCase());
}

function countWords(value: string): number {
  return value.split(/\s+/u).filter((word) => word.length > 0).length;
}

function normalizeReflectionToken(value: string): string {
  const cleanedValue = stripWordEdgePunctuation(value).toLowerCase();

  if (cleanedValue.endsWith("ies") && cleanedValue.length > 4) {
    return `${cleanedValue.slice(0, -3)}y`;
  }

  if (
    cleanedValue.endsWith("s") &&
    cleanedValue.length > 4 &&
    !cleanedValue.endsWith("ss")
  ) {
    return cleanedValue.slice(0, -1);
  }

  return cleanedValue;
}

function isGenericReflectionReferenceToken(value: string): boolean {
  return GENERIC_REFLECTION_REFERENCE_TOKENS.has(value);
}

function extractGroundingTokens(value: string): string[] {
  return normalizeWhitespace(value)
    .split(/\s+/u)
    .map((word) => normalizeReflectionToken(word))
    .filter(
      (token) =>
        token.length >= 3 &&
        !isStopWord(token) &&
        !isGenericReflectionReferenceToken(token),
    );
}

function splitSentences(content: string): string[] {
  const normalized = normalizeWhitespace(content);
  const matches = normalized.match(/[^.!?\n]+(?:[.!?]+|$)/gu);

  return (matches ?? [normalized])
    .map((sentence) => normalizeGroundingSnippet(sentence))
    .filter((sentence): sentence is string => sentence !== undefined);
}

function pushUniqueCandidate(
  target: string[],
  value: string | undefined,
): void {
  if (!value) {
    return;
  }

  const normalizedValue = value.toLowerCase();

  if (
    target.some((candidate) => candidate.toLowerCase() === normalizedValue) ||
    target.length >= MAX_GROUNDING_ITEMS_PER_KIND
  ) {
    return;
  }

  target.push(value);
}

function trimStopWordsAtEdges(words: readonly string[]): string[] {
  const trimmed = [...words];

  while (trimmed.length > 0 && isStopWord(stripWordEdgePunctuation(trimmed[0]!))) {
    trimmed.shift();
  }

  while (
    trimmed.length > 0 &&
    isStopWord(stripWordEdgePunctuation(trimmed[trimmed.length - 1]!))
  ) {
    trimmed.pop();
  }

  return trimmed;
}

function extractPhraseCandidates(content: string): string[] {
  const phrases: string[] = [];

  for (const match of content.matchAll(/[“"]([^“”"]{3,120})[”"]/gu)) {
    pushUniqueCandidate(phrases, normalizeGroundingSnippet(match[1]));
  }

  for (const sentence of splitSentences(content)) {
    const sentenceWordCount = countWords(sentence);

    if (sentenceWordCount >= 4 && sentenceWordCount <= 24) {
      pushUniqueCandidate(phrases, sentence);
      continue;
    }

    for (const clause of sentence.split(/[;:]/u)) {
      const normalizedClause = normalizeGroundingSnippet(clause);

      if (!normalizedClause) {
        continue;
      }

      const clauseWordCount = countWords(normalizedClause);

      if (clauseWordCount >= 4 && clauseWordCount <= 18) {
        pushUniqueCandidate(phrases, normalizedClause);
      }
    }
  }

  if (phrases.length === 0) {
    pushUniqueCandidate(phrases, normalizeGroundingSnippet(content));
  }

  return phrases;
}

function extractDetailCandidates(content: string): string[] {
  const details: string[] = [];

  for (const sentence of splitSentences(content)) {
    const normalizedSentence = normalizeWhitespace(sentence);
    const lowerSentence = normalizedSentence.toLowerCase();

    for (const marker of DETAIL_MARKERS) {
      const markerIndex = lowerSentence.indexOf(marker);

      if (markerIndex === -1) {
        continue;
      }

      const beforeWords = trimStopWordsAtEdges(
        normalizedSentence.slice(0, markerIndex).split(/\s+/u).slice(-6),
      );
      const afterWords = trimStopWordsAtEdges(
        normalizedSentence
          .slice(markerIndex + marker.length)
          .split(/\s+/u)
          .slice(0, 5),
      );
      const detail = normalizeGroundingSnippet(
        [...beforeWords, marker, ...afterWords].join(" "),
      );

      pushUniqueCandidate(details, detail);
      break;
    }
  }

  if (details.length === 0) {
    for (const sentence of splitSentences(content)) {
      const sentenceWordCount = countWords(sentence);

      if (sentenceWordCount >= 5 && sentenceWordCount <= 14) {
        pushUniqueCandidate(details, sentence);
      }
    }
  }

  return details;
}

interface ThemeCandidate {
  index: number;
  score: number;
  text: string;
}

function extractThemeCandidates(content: string): string[] {
  const candidates: ThemeCandidate[] = [];
  const segments = normalizeWhitespace(content).split(/[.,;:!?()[\]\n]+/u);
  let index = 0;

  for (const segment of segments) {
    const words = segment.trim().split(/\s+/u);
    let buffer: string[] = [];

    const flushBuffer = (): void => {
      if (buffer.length === 0) {
        return;
      }

      if (buffer.length >= 2) {
        const themeWords = buffer.slice(0, Math.min(buffer.length, 3));
        candidates.push({
          index,
          score: themeWords.join(" ").length,
          text: themeWords.join(" "),
        });
        index += 1;
      } else if (candidates.length === 0) {
        candidates.push({
          index,
          score: buffer[0]!.length,
          text: buffer[0]!,
        });
        index += 1;
      }

      buffer = [];
    };

    for (const word of words) {
      const cleanedWord = stripWordEdgePunctuation(word);

      if (
        cleanedWord.length >= 3 &&
        /[a-z]/iu.test(cleanedWord) &&
        !isStopWord(cleanedWord)
      ) {
        buffer.push(cleanedWord);
        continue;
      }

      flushBuffer();
    }

    flushBuffer();
  }

  const deduplicatedCandidates = candidates
    .sort((left, right) => {
      const wordCountDifference =
        countWords(right.text) - countWords(left.text);

      if (wordCountDifference !== 0) {
        return wordCountDifference;
      }

      const scoreDifference = right.score - left.score;

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return left.index - right.index;
    })
    .map((candidate) => candidate.text)
    .filter((theme, themeIndex, collection) => {
      const normalizedTheme = theme.toLowerCase();

      return (
        collection.findIndex(
          (candidate) => candidate.toLowerCase() === normalizedTheme,
        ) === themeIndex
      );
    });
  const hasMultiWordCandidate = deduplicatedCandidates.some(
    (candidate) => countWords(candidate) >= 2,
  );

  return deduplicatedCandidates
    .filter(
      (candidate) =>
        !hasMultiWordCandidate || countWords(candidate) >= 2,
    )
    .slice(0, MAX_GROUNDING_ITEMS_PER_KIND);
}

export function buildReflectionGroundingContext(
  content: string,
): ReflectionGroundingContext {
  const normalizedContent = normalizeWhitespace(content);

  if (normalizedContent.length === 0) {
    return {
      details: [],
      phrases: [],
      themes: [],
    };
  }

  return {
    details: extractDetailCandidates(normalizedContent),
    phrases: extractPhraseCandidates(normalizedContent),
    themes: extractThemeCandidates(normalizedContent),
  };
}

export function hasReflectionGroundingContext(
  groundingContext: ReflectionGroundingContext | undefined,
): groundingContext is ReflectionGroundingContext {
  return Boolean(
    groundingContext &&
      (groundingContext.details.length > 0 ||
        groundingContext.phrases.length > 0 ||
        groundingContext.themes.length > 0),
  );
}

function collectGroundingCandidates(
  content: string,
  groundingContext?: ReflectionGroundingContext,
): string[] {
  const resolvedGroundingContext =
    groundingContext ?? buildReflectionGroundingContext(content);
  const candidates: string[] = [];

  for (const candidate of [
    ...resolvedGroundingContext.details,
    ...resolvedGroundingContext.phrases,
    ...resolvedGroundingContext.themes,
  ]) {
    pushUniqueCandidate(candidates, normalizeGroundingSnippet(candidate));
  }

  if (candidates.length === 0) {
    pushUniqueCandidate(candidates, normalizeGroundingSnippet(content));
  }

  return candidates;
}

function promptContainsGroundingReference(
  prompt: string,
  groundingCandidates: readonly string[],
): boolean {
  const normalizedPrompt = normalizeWhitespace(prompt);
  const lowerPrompt = normalizedPrompt.toLowerCase();
  const promptTokens = new Set(extractGroundingTokens(normalizedPrompt));

  for (const candidate of groundingCandidates) {
    const normalizedCandidate = normalizeGroundingSnippet(candidate);

    if (!normalizedCandidate) {
      continue;
    }

    if (
      normalizedCandidate.length >= 8 &&
      lowerPrompt.includes(normalizedCandidate.toLowerCase())
    ) {
      return true;
    }

    const candidateTokens = extractGroundingTokens(normalizedCandidate);

    if (candidateTokens.length === 0) {
      continue;
    }

    const overlap = candidateTokens.filter((token) => promptTokens.has(token));

    if (candidateTokens.length === 1) {
      if (candidateTokens[0]!.length >= 5 && overlap.length === 1) {
        return true;
      }

      continue;
    }

    if (overlap.length >= 2 && overlap.some((token) => token.length >= 4)) {
      return true;
    }
  }

  return false;
}

function isGenericReflectionPrompt(prompt: string): boolean {
  return GENERIC_REFLECTION_PATTERNS.some((pattern) => pattern.test(prompt));
}

function clampReflectionAnchor(value: string): string {
  const normalizedValue = normalizeGroundingSnippet(value);

  if (!normalizedValue) {
    return "the saved note";
  }

  const sanitizedValue = normalizedValue.replace(/[“”"]/gu, "'");

  if (sanitizedValue.length <= MAX_REFLECTION_ANCHOR_LENGTH) {
    return sanitizedValue;
  }

  const truncatedValue = sanitizedValue
    .slice(0, MAX_REFLECTION_ANCHOR_LENGTH - 3)
    .trimEnd();
  const lastWordBoundary = truncatedValue.lastIndexOf(" ");

  if (lastWordBoundary >= Math.floor(MAX_REFLECTION_ANCHOR_LENGTH / 2)) {
    return `${truncatedValue.slice(0, lastWordBoundary)}...`;
  }

  return `${truncatedValue}...`;
}

function resolveReflectionAnchor(
  content: string,
  groundingContext?: ReflectionGroundingContext,
): string {
  const resolvedGroundingContext =
    groundingContext ?? buildReflectionGroundingContext(content);

  for (const candidate of [
    ...resolvedGroundingContext.details,
    ...resolvedGroundingContext.themes,
    ...resolvedGroundingContext.phrases,
    content,
  ]) {
    const normalizedCandidate = normalizeGroundingSnippet(candidate);

    if (normalizedCandidate) {
      return clampReflectionAnchor(normalizedCandidate);
    }
  }

  return "the saved note";
}

export function isGroundedReflectionPrompt(
  prompt: string,
  content: string,
  groundingContext?: ReflectionGroundingContext,
): boolean {
  const normalizedPrompt = normalizeWhitespace(prompt);

  if (
    normalizedPrompt.length === 0 ||
    isGenericReflectionPrompt(normalizedPrompt)
  ) {
    return false;
  }

  return promptContainsGroundingReference(
    normalizedPrompt,
    collectGroundingCandidates(content, groundingContext),
  );
}

export function buildFallbackReflectionPrompt(
  content: string,
  groundingContext?: ReflectionGroundingContext,
): string {
  const resolvedGroundingContext =
    groundingContext ?? buildReflectionGroundingContext(content);
  const detail = resolvedGroundingContext.details[0]?.toLowerCase();
  const anchor = resolveReflectionAnchor(content, resolvedGroundingContext);

  if (detail) {
    if (/\b(?:instead of|rather than|versus|vs)\b/iu.test(detail)) {
      return `What tradeoff in "${anchor}" needs the clearest decision next?`;
    }

    if (/\bbecause\b/iu.test(detail)) {
      return `What evidence behind "${anchor}" do you want to test next?`;
    }

    if (/\bwithout\b/iu.test(detail)) {
      return `What constraint in "${anchor}" are you trying to preserve?`;
    }

    if (/\b(?:while|but)\b/iu.test(detail)) {
      return `What tension in "${anchor}" still needs a clearer decision?`;
    }
  }

  return `What concrete example would make "${anchor}" easier to test or revisit later?`;
}

export function ensureGroundedReflectionPrompt(
  prompt: string,
  content: string,
  groundingContext?: ReflectionGroundingContext,
): string {
  const normalizedPrompt = normalizeWhitespace(prompt);

  if (isGroundedReflectionPrompt(normalizedPrompt, content, groundingContext)) {
    return normalizedPrompt;
  }

  return buildFallbackReflectionPrompt(content, groundingContext);
}

export function buildReflectionGroundingPromptContent(
  content: string,
  groundingContext?: ReflectionGroundingContext,
): string {
  const resolvedGroundingContext =
    groundingContext ?? buildReflectionGroundingContext(content);
  const sections = [`Captured inspiration:\n${content}`];

  if (!hasReflectionGroundingContext(resolvedGroundingContext)) {
    return sections.join("\n\n");
  }

  const groundingLines = [
    ...resolvedGroundingContext.phrases.map((phrase) => `- phrase: ${phrase}`),
    ...resolvedGroundingContext.details.map((detail) => `- detail: ${detail}`),
    ...resolvedGroundingContext.themes.map((theme) => `- theme: ${theme}`),
  ];

  sections.push(`Grounding context:\n${groundingLines.join("\n")}`);

  return sections.join("\n\n");
}
