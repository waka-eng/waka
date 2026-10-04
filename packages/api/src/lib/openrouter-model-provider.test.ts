/**
 * ONE PROMPT, TWO ROADS — the translation is the whole risk, so it is what
 * this suite pins. The prompts and parsers themselves are the incumbent's,
 * already held by queue/prompt-fence.test.ts and friends; here the claims
 * are that the second road carries them faithfully:
 *
 *   1. A Gemini-shaped request becomes a chat request losslessly: the system
 *      instruction, the user parts in order, temperature 0 preserved (a
 *      judge that samples merges on Tuesday and mints on Wednesday), and the
 *      response schema translated dialect-for-dialect.
 *   2. Provider selection: the OpenRouter key's presence — and nothing
 *      else — picks the road; its absence keeps every environment on the
 *      incumbent (CI before the secret lands, a fresh checkout).
 *   3. The judge's null posture survives the road: a broken envelope or
 *      fenced-but-invalid JSON still lands on "independent", never a verdict
 *      nobody reached.
 *
 * WHAT THIS MOCKS, AND WHY: `fetch`, at the transport boundary — the suite
 * is about what WAKA sends and how it treats what comes back, not about
 * OpenRouter's uptime.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setDefaultModelProviderForTests, getDefaultModelProvider } from "./model-provider.js";
import { ModelDidNotAnswerError } from "./model-provider.js";
import { stripJsonFence } from "./openrouter-http.js";
import {
  createOpenRouterModelProvider,
  toChatRequest,
  toJsonSchema,
} from "./openrouter-model-provider.js";
import { buildSignalMatchJudgementRequest, buildReviewQuestionRequest } from "../queue/gemini.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.WAKA_MODEL_JUDGE;
  setDefaultModelProviderForTests(null);
});

const chatReply = (content: string): Response =>
  new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

describe("the translation", () => {
  it('bounds a conversation reply to one call and 1200 output tokens while validating its quote',async()=>{
    fetchMock.mockResolvedValueOnce(chatReply(JSON.stringify({answer:'This is one possible guide, not a decision.',followUpQuestion:'What would help you compare the options?',citations:[{sourceNumber:1,quote:'Leave room for thought.'}]})));
    const result=await createOpenRouterModelProvider().answerConversation({preferredLocale:'en-US',history:[{role:'user',content:'What could I consider?'}],sources:[{kind:'principle',text:'Leave room for thought.',state:'held',supportCurrent:true,truncated:false}]});
    expect(result.citations).toHaveLength(1);expect(fetchMock).toHaveBeenCalledTimes(1);
    const request=JSON.parse(fetchMock.mock.calls[0][1].body);expect(request.max_tokens).toBe(1200);expect(request.reasoning).toEqual({enabled:false});
  });
  it("carries a judge request losslessly onto the chat shape", () => {
    const request = buildSignalMatchJudgementRequest({
      preferredLocale: "en-US",
      candidateStatement: "Small tools beat grand systems.",
      existingStatement: "Grand systems beat small tools.",
    }) as never;
    const chat = toChatRequest(request, "deepseek/deepseek-v4-flash-0731", "signal_match");

    expect(chat.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(chat.temperature, "a comparison, not a composition").toBe(0);
    expect(chat.messages[0]!.role).toBe("system");
    expect(chat.messages[0]!.content).toContain("Exactly one of three answers");
    expect(chat.messages[1]!.role).toBe("user");
    expect(chat.messages[1]!.content).toContain("Small tools beat grand systems.");
    expect(chat.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "signal_match",
        schema: {
          type: "object",
          properties: { relation: { type: "string", enum: ["same", "independent", "opposed"] } },
          required: ["relation"],
        },
      },
    });
  });

  it("translates the schema dialect recursively — arrays, nesting, enums", () => {
    expect(
      toJsonSchema({
        type: "OBJECT",
        properties: {
          entries: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                kind: { type: "STRING", enum: ["pattern", "tension"] },
                rank: { type: "NUMBER" },
              },
              required: ["kind"],
            },
          },
        },
        required: ["entries"],
      } as never),
    ).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {
        entries: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: ["pattern", "tension"] },
              rank: { type: "number" },
            },
            required: ["kind"],
          },
        },
      },
      required: ["entries"],
    });
  });

  it("strips one outer markdown fence and nothing else", () => {
    expect(stripJsonFence('```json\n{"relation":"same"}\n```')).toBe('{"relation":"same"}');
    expect(stripJsonFence('{"relation":"same"}')).toBe('{"relation":"same"}');
    expect(stripJsonFence('```\n{"a":"```"}\n```')).toBe('{"a":"```"}');
  });
  it('preserves review branch bounds and punctuation constraints on the chat road',()=>{
    const request=buildReviewQuestionRequest({preferredLocale:'en-US',history:[],sources:[{text:'One',attachments:[],reflections:[]},{text:'Two',attachments:[],reflections:[]}]});
    const schema=toJsonSchema(request.generationConfig.responseSchema as never);
    expect(schema).toMatchObject({type:'object',anyOf:[
      {type:'object',additionalProperties:false,properties:{connection:{type:'null'},question:{minLength:12,maxLength:240,pattern:'^[^?？]*[?？]$'},sourceNumbers:{type:'array',minItems:1,maxItems:1,items:{type:'integer',minimum:1,maximum:2}}}},
      {type:'object',additionalProperties:false,properties:{connection:{type:'string',minLength:8,maxLength:280,pattern:'^[^?？]*$'},sourceNumbers:{type:'array',minItems:2,maxItems:2}}},
    ]});
  });
});

describe("the road is chosen by the key, and only the key", () => {
  it("routes to OpenRouter when the key is present", async () => {
    const provider = await getDefaultModelProvider();
    expect(provider.name).toBe("openrouter");
  });

  it("stays on the incumbent without it", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const provider = await getDefaultModelProvider();
    expect(provider.name).toBe("gemini");
  });
});

describe("the judge over the second road", () => {
  it("sends the pinned model, honors a per-task override, and reads a verdict", async () => {
    const provider = createOpenRouterModelProvider();

    fetchMock.mockResolvedValueOnce(chatReply('{"relation":"same"}'));
    const verdict = await provider.judgeSignalMatch({
      preferredLocale: "en-US",
      candidateStatement: "a",
      existingStatement: "b",
    });
    expect(verdict).toEqual({ relation: "same" });
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(sent.model).toBe("deepseek/deepseek-v4-flash-0731");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("openrouter.ai");

    process.env.WAKA_MODEL_JUDGE = "some-lab/other-model";
    fetchMock.mockResolvedValueOnce(chatReply('```json\n{"relation":"opposed"}\n```'));
    const fenced = await provider.judgeSignalMatch({
      preferredLocale: "en-US",
      candidateStatement: "a",
      existingStatement: "b",
    });
    expect(fenced, "a fenced verdict still reads").toEqual({ relation: "opposed" });
    const second = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string);
    expect(second.model).toBe("some-lab/other-model");
  });

  it("throws when the road answers garbage — a malfunction retries, it never invents a verdict", async () => {
    /* the old posture here was "independent", which quietly MINTED a
       duplicate signal every time the provider had a bad hour; the queue
       retries a thrown attempt instead */
    const provider = createOpenRouterModelProvider();
    fetchMock.mockResolvedValueOnce(chatReply("the model apologizes at length"));
    await expect(
      provider.judgeSignalMatch({
        preferredLocale: "en-US",
        candidateStatement: "a",
        existingStatement: "b",
      }),
    ).rejects.toThrow(ModelDidNotAnswerError);
  });

  it("keeps the safe posture for a considered refusal — a content filter is terminal", async () => {
    const provider = createOpenRouterModelProvider();
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: null }, finish_reason: "content_filter" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const verdict = await provider.judgeSignalMatch({
      preferredLocale: "en-US",
      candidateStatement: "a",
      existingStatement: "b",
    });
    expect(verdict, "declined ≠ broken: retrying a refusal cannot help").toEqual({
      relation: "independent",
    });
  });
});
