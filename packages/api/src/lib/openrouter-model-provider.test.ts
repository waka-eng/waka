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
import { ModelDidNotAnswerError,type ModelProvider } from "./model-provider.js";
import { stripJsonFence } from "./openrouter-http.js";
import {
  createOpenRouterModelProvider,
  toChatRequest,
  toJsonSchema,
} from "./openrouter-model-provider.js";
import { buildSignalMatchJudgementRequest, buildReviewQuestionRequest,buildPrincipleRelationRequest,buildPrincipleGroundingRequest } from "../queue/gemini.js";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.WAKA_MODEL_JUDGE;
  delete process.env.WAKA_MODEL_CHAT;
  setDefaultModelProviderForTests(null);
});

const chatReply = (content: string): Response =>
  new Response(
    JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

describe('all generation tasks share the V4.1 default',()=>{
  const locale={preferredLocale:'en-US' as const},profile={...locale,profileId:'synthetic-profile'};
  const sources=[{text:'I leave room for small experiments.',reflections:[],attachments:[]}];
  const cases:Array<[string,(provider:ModelProvider)=>Promise<unknown>]>=[
    ['chat',p=>p.answerConversation({...locale,history:[{role:'user',content:'What should I explore?'}],sources:[]})],
    ['reflection',p=>p.askReflectionQuestion({...locale,inspirationText:sources[0]!.text,reflections:[]})],
    ['review question',p=>p.askReviewQuestion({...locale,sources,history:[]})],
    ['review derivation',p=>p.deriveReviewAnswer({...locale,sources,answer:'I want to try something small.',question:null,contextChanged:false,claims:[],discover:true})],
    ['signal extraction',p=>p.extractSignalCandidates({...profile,inspiration:{id:'source',text:sources[0]!.text,source:'app',createdAt:new Date('2026-10-05')},reflections:[],attachments:[],existingCategories:[],existingStatements:[],relatedInspirations:[]})],
    ['signal support',p=>p.assessSignalSupport({sources:[{id:'source',kind:'inspiration',text:sources[0]!.text}],claims:[{signalId:'signal',statement:'Small experiments matter.'}]})],
    ['signal matching',p=>p.judgeSignalMatch({...locale,candidateStatement:'Small experiments matter.',existingStatement:'Try small experiments.'})],
    ['top of mind',p=>p.synthesizeTopOfMind({...profile,signals:[],lockedEntries:[],currentEntries:[],recentFeedback:[],provisional:true})],
    ['principles',p=>p.distillPrinciples({...profile,signals:[],currentPrinciples:[],currentEntries:[]})],
    ['principle grounding',p=>p.assessPrincipleGrounding({...locale,signals:[],candidates:[]})],
    ['principle matching',p=>p.judgePrincipleRelation({...locale,candidateStatement:'Try small experiments.',existingPrinciples:[{id:'existing',statement:'Try small experiments before committing.'}]})],
    ['declaration routing',p=>p.routeDeclaration({...locale,statement:'Try small experiments before committing.'})],
  ];
  it.each(cases)('%s dispatches the common model once without enabling reasoning',async(_name,invoke)=>{
    for(const key of ['WAKA_MODEL_CHAT','WAKA_MODEL_REFLECT','WAKA_MODEL_EXTRACT','WAKA_MODEL_SUPPORT','WAKA_MODEL_JUDGE','WAKA_MODEL_SYNTHESIZE','WAKA_MODEL_PRINCIPLES','WAKA_MODEL_PRINCIPLE_JUDGE','WAKA_MODEL_ROUTE'])vi.stubEnv(key,'');
    // An unusable result isolates dispatch from each task's output parser.
    // No account data, live provider, or database is used by this check.
    fetchMock.mockResolvedValueOnce(chatReply('{}'));
    await invoke(createOpenRouterModelProvider()).catch(()=>undefined);
    expect(fetchMock).toHaveBeenCalledOnce();
    const request=JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(request.model).toBe('deepseek/deepseek-v4.1-flash');
    expect(request.reasoning).toEqual({enabled:false});
  });
});

describe("the translation", () => {
  it('preserves the actual comparison and grounding output-token bounds',()=>{
    expect(toChatRequest(buildPrincipleRelationRequest({preferredLocale:'en-US',candidateStatement:'A rule.',existingPrinciples:[{id:'p',statement:'Another rule.'}]}),'model','principle_relation').max_tokens).toBe(1600);
    expect(toChatRequest(buildPrincipleGroundingRequest({preferredLocale:'en-US',signals:[],candidates:[]}), 'model','principle_grounding').max_tokens).toBe(512);
  });
  it('requests the lowest supported reasoning only for the endpoint that requires it, without changing its token cap',async()=>{
    process.env.WAKA_MODEL_CHAT='google/gemini-3.8-flash';fetchMock.mockResolvedValueOnce(chatReply(JSON.stringify({answer:'We can examine the choice.',followUpQuestion:'What matters in this choice?',citations:[]})));
    await createOpenRouterModelProvider().answerConversation({preferredLocale:'en-US',history:[{role:'user',content:'A choice.'}],sources:[]});
    const request=JSON.parse(fetchMock.mock.calls[0][1].body);expect(request.model).toBe('google/gemini-3.8-flash');expect(request.reasoning).toEqual({effort:'low',exclude:true});expect(request.max_tokens).toBe(1200);
  });
  it.each([undefined,'deepseek/deepseek-v4.1-flash'])('uses V4.1 Flash with chat override %s, one call and 1200 output tokens while validating its quote',async model=>{
    if(model)process.env.WAKA_MODEL_CHAT=model;else delete process.env.WAKA_MODEL_CHAT;
    fetchMock.mockResolvedValueOnce(chatReply(JSON.stringify({answer:'This is one possible guide, not a decision.',followUpQuestion:'What would help you compare the options?',citations:[{sourceNumber:1,quote:'Leave room for thought.'}]})));
    const result=await createOpenRouterModelProvider().answerConversation({preferredLocale:'en-US',history:[{role:'user',content:'What could I consider?'}],sources:[{kind:'principle',text:'Leave room for thought.',state:'held',supportCurrent:true,truncated:false}]});
    expect(result.citations).toHaveLength(1);expect(fetchMock).toHaveBeenCalledTimes(1);
    const request=JSON.parse(fetchMock.mock.calls[0][1].body);expect(request.model).toBe('deepseek/deepseek-v4.1-flash');expect(request.max_tokens).toBe(1200);expect(request.reasoning).toEqual({enabled:false});expect(request.response_format).toEqual({type:'json_object'});
  });
  it.each(['length','error'])('refuses even parseable JSON when the provider marks a reply %s',async finish_reason=>{
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({choices:[{finish_reason,message:{content:JSON.stringify({answer:'Partial but valid.',followUpQuestion:null,citations:[]})}}]}),{status:200}));
    await expect(createOpenRouterModelProvider().answerConversation({preferredLocale:'en-US',history:[{role:'user',content:'A choice.'}],sources:[]})).rejects.toThrow(ModelDidNotAnswerError);expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('still refuses an invented citation with JSON object decoding',async()=>{
    fetchMock.mockResolvedValueOnce(chatReply(JSON.stringify({answer:'A saved claim.',followUpQuestion:null,citations:[{sourceNumber:1,quote:'Invented memory'}]})));
    await expect(createOpenRouterModelProvider().answerConversation({preferredLocale:'en-US',history:[{role:'user',content:'A choice.'}],sources:[{kind:'principle',text:'Actual words.',truncated:false}]})).rejects.toThrow(ModelDidNotAnswerError);
  });
  it("carries a judge request losslessly onto the chat shape", () => {
    const request = buildSignalMatchJudgementRequest({
      preferredLocale: "en-US",
      candidateStatement: "Small tools beat grand systems.",
      existingStatement: "Grand systems beat small tools.",
    }) as never;
    const chat = toChatRequest(request, "deepseek/deepseek-v4.1-flash", "signal_match");

    expect(chat.model).toBe("deepseek/deepseek-v4.1-flash");
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
    expect(sent.model).toBe("deepseek/deepseek-v4.1-flash");
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
