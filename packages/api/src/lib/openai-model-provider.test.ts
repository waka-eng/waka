/** WHAT THIS MOCKS, AND WHY: `fetch` is the only transport seam. Real builders,
 * parsers, capability selection and Responses decoding execute without a key,
 * database or provider. Synthetic credentials/words must never reach logs. */
import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createOpenAiModelProvider} from './openai-model-provider.js';
import {callOpenAi,openAiRequest} from './openai-http.js';
import {MODEL_DECLINED,getDefaultModelProvider,setDefaultModelProviderForTests,type ModelProvider} from './model-provider.js';
import {configuredGenerationProvider} from './model-routing.js';
const fetchMock=vi.fn(),write=vi.spyOn(process.stdout,'write');
beforeEach(()=>{
  fetchMock.mockReset();write.mockImplementation(()=>true);vi.stubGlobal('fetch',fetchMock);
  vi.stubEnv('OPENAI_API_KEY','SYNTHETIC_OPENAI_KEY');vi.stubEnv('OPENROUTER_API_KEY','SYNTHETIC_OR_KEY');
  vi.stubEnv('WAKA_GENERATION_PROVIDER','openai');
  for(const k of ['CHAT','EXTRACT','SUPPORT','JUDGE','REFLECT','SYNTHESIZE','TOP_OF_MIND_REVIEW','PRINCIPLES','PRINCIPLE_JUDGE','ROUTE','IMAGE'])vi.stubEnv('WAKA_MODEL_'+k,'');
  setDefaultModelProviderForTests(null);write.mockClear();
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();setDefaultModelProviderForTests(null);});
afterAll(()=>write.mockRestore());
const response=(payload:unknown,model='gpt-6.1-terra',patch:Record<string,unknown>={})=>new Response(JSON.stringify({
  status:'completed',model,output:[{type:'reasoning',encrypted_content:'PRIVATE_REASONING_CANARY'},
    {type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(payload)}]}],
  usage:{input_tokens:25,output_tokens:8,input_tokens_details:{cached_tokens:4},output_tokens_details:{reasoning_tokens:3},cost:999},...patch,
}));
const locale={preferredLocale:'en-US' as const},profile={...locale,profileId:'synthetic'};
const source={text:'I prefer small tests before committing.',reflections:[],attachments:[]};
const cases:Array<[string,(p:ModelProvider)=>Promise<unknown>,unknown,string?,number?]>=[
  ['chat',p=>p.answerConversation({...locale,history:[{role:'user',content:'What next?'}],sources:[]}),{answer:'Try one small test.',followUpQuestion:null,citations:[]},undefined,1200],
  ['reflection',p=>p.askReflectionQuestion({...locale,inspirationText:source.text,reflections:[]}),{question:'What would you like to explore further?'}],
  ['review question',p=>p.askReviewQuestion({...locale,sources:[source],history:[]}),{connection:null,question:'What would you like to explore further?',sourceNumbers:[1]}],
  ['review derivation',p=>p.deriveReviewAnswer({...locale,sources:[source],answer:'I want to try something small.',question:null,contextChanged:false,claims:[],discover:true}),{assessments:[],statements:[]}],
  ['extraction',p=>p.extractSignalCandidates({...profile,inspiration:{id:'a',text:source.text,source:'app',createdAt:new Date('2026-11-13')},reflections:[],attachments:[],existingCategories:[],existingStatements:[],relatedInspirations:[]}),{statements:[],category:null}],
  ['support',p=>p.assessSignalSupport({sources:[{id:'a',kind:'inspiration',text:source.text}],claims:[{signalId:'s',statement:source.text}]}),{assessments:[{signalId:'s',verdict:'supported',sourceIds:['a']}]}],
  ['matching',p=>p.judgeSignalMatch({...locale,candidateStatement:source.text,existingStatement:source.text}),{relation:'independent'}],
  ['synthesis',p=>p.synthesizeTopOfMind({...profile,signals:[],lockedEntries:[],currentEntries:[],recentFeedback:[],provisional:true}),{entries:[],noChange:true},'gpt-6.1-sol'],
  ['publication review',p=>p.reviewTopOfMind({...locale,entries:[],inspirations:[]}),{entries:[]},undefined,2400],
  ['principles',p=>p.distillPrinciples({...profile,signals:[],currentPrinciples:[],currentEntries:[]}),{candidates:[]}],
  ['grounding',p=>p.assessPrincipleGrounding({...locale,signals:[],candidates:[]}),{assessments:[]},undefined,512],
  ['principle matching',p=>p.judgePrincipleRelation({...locale,candidateStatement:source.text,existingPrinciples:[{id:'p',statement:source.text}]}),{relations:[{principleId:'p',relation:'independent'}]},undefined,1600],
  ['declaration',p=>p.routeDeclaration({...locale,statement:source.text}),{route:'inspiration',type:null}],
];
describe('all native task paths retain real output contracts',()=>{
  it.each(cases)('%s dispatches one stateless native request',async(_name,invoke,payload,model='gpt-6.1-terra',cap=8192)=>{
    fetchMock.mockResolvedValueOnce(response(payload,model));await invoke(createOpenAiModelProvider());
    expect(fetchMock).toHaveBeenCalledOnce();const [url,init]=fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/responses');expect(init.headers.Authorization).toBe('Bearer SYNTHETIC_OPENAI_KEY');
    const body=JSON.parse(init.body);expect(body).toMatchObject({model,store:false,stream:false,max_output_tokens:cap,reasoning:{effort:model.endsWith('sol')?'medium':'low'}});
    for(const key of ['temperature','top_p','tools','previous_response_id','conversation','metadata'])expect(body).not.toHaveProperty(key);
    const logs=write.mock.calls.map(x=>String(x[0])).filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
    const usage=logs.find(x=>x.event==='model_usage');expect(usage).toMatchObject({Provider:'openai',UnpricedRequests:1,costStatus:'unknown',inputTokens:25,outputTokens:8,reasoningTokens:3,cachedInputTokens:4});
    expect(usage).not.toHaveProperty('_aws');expect(usage).not.toHaveProperty('CostUsd');expect(logs.some(x=>x.event==='model_result'&&x.outcome==='accepted')).toBe(true);
    expect(JSON.stringify(logs)).not.toMatch(/PRIVATE_REASONING|SYNTHETIC_OPENAI_KEY|SYNTHETIC_OR_KEY|small tests before/);
  });
});
it('uses explicit selection despite a retained OR key; missing/unknown credentials/config fail before dispatch',async()=>{
  expect((await getDefaultModelProvider()).name).toBe('openai');setDefaultModelProviderForTests(null);
  vi.stubEnv('OPENAI_API_KEY','');await expect(getDefaultModelProvider()).rejects.toThrow('requires OPENAI_API_KEY');
  vi.stubEnv('WAKA_GENERATION_PROVIDER','foreign');expect(()=>configuredGenerationProvider()).toThrow('Unknown generation provider');
  vi.stubEnv('WAKA_GENERATION_PROVIDER','openai');vi.stubEnv('WAKA_MODEL_CHAT','openai/gpt-6.1-terra');
  expect(()=>openAiRequest('chat',[],'chat',undefined)).toThrow('Unsupported native');expect(fetchMock).not.toHaveBeenCalled();
});
it('retains the conditional multi-source Review parser with JSON mode instead of unsupported root anyOf',async()=>{
  fetchMock.mockResolvedValueOnce(response({connection:'Small experiments may connect these notes.',question:'What would you like to test together?',sourceNumbers:[1,2]}));
  await createOpenAiModelProvider().askReviewQuestion({...locale,sources:[source,{...source,text:'I want feedback before deciding.'}],history:[]});
  const b=JSON.parse(fetchMock.mock.calls[0][1].body);expect(b.text.format).toEqual({type:'json_object'});expect(JSON.stringify(b.input)).toContain('Return only valid JSON.');
});
it.each(['incomplete','failed','queued'])('refuses %s and never calls a paid fallback',async status=>{
  fetchMock.mockResolvedValueOnce(response({},'gpt-6.1-terra',{status}));await expect(callOpenAi(openAiRequest('chat',[],'chat',undefined),'conversation reply')).rejects.toThrow('did not complete');expect(fetchMock).toHaveBeenCalledOnce();
});
it('treats refusal as a decline, malformed output as failure and foreign model as a refusal to publish',async()=>{
  fetchMock.mockResolvedValueOnce(response(null,'gpt-6.1-terra',{output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'PRIVATE_REFUSAL'}]}]}));
  expect(await callOpenAi(openAiRequest('chat',[],'chat',undefined),'conversation reply')).toBe(MODEL_DECLINED);
  fetchMock.mockResolvedValueOnce(response({},'foreign-model'));await expect(callOpenAi(openAiRequest('chat',[],'chat',undefined),'conversation reply')).rejects.toThrow('model did not match');
  fetchMock.mockResolvedValueOnce(response({},'gpt-6.1-terra',{output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'PRIVATE_NOT_JSON'}]}]}));
  await expect(callOpenAi(openAiRequest('chat',[],'chat',undefined),'conversation reply')).rejects.toThrow('not valid JSON');
  expect(write.mock.calls.map(x=>String(x[0])).join('')).not.toMatch(/PRIVATE_REFUSAL|foreign-model|PRIVATE_NOT_JSON/);
});
it('keeps HTTP bodies private and has no automatic 429 retry',async()=>{
  fetchMock.mockResolvedValueOnce(new Response('PRIVATE_PROVIDER_BODY',{status:429}));
  await expect(callOpenAi(openAiRequest('chat',[],'chat',undefined),'conversation reply')).rejects.toThrow('HTTP 429');
  expect(fetchMock).toHaveBeenCalledOnce();expect(write.mock.calls.map(x=>String(x[0])).join('')).not.toContain('PRIVATE_PROVIDER_BODY');
});
it('bounds a non-cooperating native transport with the existing deadline',async()=>{
  vi.useFakeTimers();vi.stubEnv('WAKA_MODEL_TIMEOUT_MS','1000');fetchMock.mockImplementation(()=>new Promise(()=>{}));
  const pending=callOpenAi(openAiRequest('chat',[],'chat',undefined),'conversation reply');const rejected=expect(pending).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(1000);await rejected;expect(fetchMock).toHaveBeenCalledOnce();
});
