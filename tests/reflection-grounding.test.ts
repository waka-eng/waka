import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFallbackReflectionPrompt,
  buildReflectionGroundingContext,
  buildReflectionGroundingPromptContent,
  ensureGroundedReflectionPrompt,
  isGroundedReflectionPrompt,
} from "../packages/shared/llm/reflection-grounding.ts";
import {
  NEGATIVE_REFLECTION_GROUNDING_FIXTURES,
  PRIMARY_REFLECTION_GROUNDING_FIXTURE,
  REFLECTION_GROUNDING_FIXTURES,
} from "./helpers/reflection-grounding-fixture.ts";

test("buildReflectionGroundingContext extracts explicit phrases, details, and themes from a nuanced capture", () => {
  const content = PRIMARY_REFLECTION_GROUNDING_FIXTURE.sourceText;
  const groundingContext = buildReflectionGroundingContext(content);

  assert.deepEqual(groundingContext.phrases, [
    "Maybe Waka should group inspiration by latent themes instead of source",
  ]);
  assert.deepEqual(groundingContext.details, [
    "group inspiration by latent themes instead of source",
  ]);
  assert.deepEqual(groundingContext.themes, [
    "group inspiration",
    "latent themes",
  ]);
});

test("buildReflectionGroundingPromptContent serializes extracted grounding context alongside the captured inspiration", () => {
  const content = PRIMARY_REFLECTION_GROUNDING_FIXTURE.sourceText;

  assert.equal(
    buildReflectionGroundingPromptContent(
      content,
      buildReflectionGroundingContext(content),
    ),
    "Captured inspiration:\n" +
      "Maybe Waka should group inspiration by latent themes instead of source.\n\n" +
      "Grounding context:\n" +
      "- phrase: Maybe Waka should group inspiration by latent themes instead of source\n" +
      "- detail: group inspiration by latent themes instead of source\n" +
      "- theme: group inspiration\n" +
      "- theme: latent themes",
  );
});

test("isGroundedReflectionPrompt accepts questions that name concrete elements from the saved inspiration", () => {
  const content = PRIMARY_REFLECTION_GROUNDING_FIXTURE.sourceText;

  assert.equal(
    isGroundedReflectionPrompt(
      "What tension between latent themes and source are you trying to resolve?",
      content,
      buildReflectionGroundingContext(content),
    ),
    true,
  );
});

test("grounded reflection fixtures stay anchored to the source details they reference", () => {
  for (const fixture of REFLECTION_GROUNDING_FIXTURES) {
    assert.equal(
      isGroundedReflectionPrompt(
        fixture.expectedGroundedQuestion,
        fixture.sourceText,
        buildReflectionGroundingContext(fixture.sourceText),
      ),
      true,
      `expected ${fixture.id} to remain grounded in its source text`,
    );
  }
});

test("grounded reflection fixtures do not validate against unrelated source texts", () => {
  for (const [index, fixture] of REFLECTION_GROUNDING_FIXTURES.entries()) {
    const mismatchedFixture =
      REFLECTION_GROUNDING_FIXTURES[
        (index + 1) % REFLECTION_GROUNDING_FIXTURES.length
      ]!;

    assert.equal(
      isGroundedReflectionPrompt(
        mismatchedFixture.expectedGroundedQuestion,
        fixture.sourceText,
        buildReflectionGroundingContext(fixture.sourceText),
      ),
      false,
      `expected ${mismatchedFixture.id} to fail against ${fixture.id}`,
    );
  }
});

test("negative reflection fixtures fail when prompts are generic, templated, or only loosely related to the source", () => {
  for (const fixture of NEGATIVE_REFLECTION_GROUNDING_FIXTURES) {
    assert.equal(
      isGroundedReflectionPrompt(
        fixture.prompt,
        fixture.sourceText,
        buildReflectionGroundingContext(fixture.sourceText),
      ),
      false,
      `expected ${fixture.id} (${fixture.category}) to fail for ${fixture.sourceFixtureId}`,
    );
  }
});

test("ensureGroundedReflectionPrompt rewrites rejected reflection prompts into source-grounded fallback questions", () => {
  for (const fixture of NEGATIVE_REFLECTION_GROUNDING_FIXTURES) {
    const groundingContext = buildReflectionGroundingContext(fixture.sourceText);

    assert.equal(
      ensureGroundedReflectionPrompt(
        fixture.prompt,
        fixture.sourceText,
        groundingContext,
      ),
      buildFallbackReflectionPrompt(fixture.sourceText, groundingContext),
      `expected ${fixture.id} (${fixture.category}) to rewrite into a grounded fallback question`,
    );
  }

  const content = PRIMARY_REFLECTION_GROUNDING_FIXTURE.sourceText;
  const groundingContext = buildReflectionGroundingContext(content);

  assert.equal(
    buildFallbackReflectionPrompt(content, groundingContext),
    PRIMARY_REFLECTION_GROUNDING_FIXTURE.expectedGroundedQuestion,
  );
});
