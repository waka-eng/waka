// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` provides network outcomes.
 * The shipped review panel, draft journal, keyboard/pointer handlers and
 * original-source loading remain real; SQL and rendering have separate checks.
 * `Clipboard.writeText` is replaced in the closed-review recovery test only. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReviewPanel} from '../src/components/ReviewPanel';
import {readViewLocation} from '../src/lib/view-location';
import {storeReviewSelection,readReviewSelections} from '../src/lib/review-selection-drafts';
import {newReviewDraft,storeReviewDraft} from '../src/lib/review-dialogue-drafts';
import {chooseReviewInspiration,fetchActiveReview,fetchInspiration,fetchInspirationPage,fetchReviewSession,finishReviewSession,startReviewSession,fetchReviewDialogue,saveReviewAnswer,requestReviewQuestion,type ApiInspiration,type ApiReviewSession} from '../src/lib/api';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),chooseReviewInspiration:vi.fn(),fetchActiveReview:vi.fn(),fetchInspiration:vi.fn(),fetchInspirationPage:vi.fn(),fetchReviewSession:vi.fn(),finishReviewSession:vi.fn(),startReviewSession:vi.fn(),fetchReviewDialogue:vi.fn(),saveReviewAnswer:vi.fn(),requestReviewQuestion:vi.fn()}));
const SID='11111111-1111-4111-8111-111111111111',SOURCE='22222222-2222-4222-8222-222222222222',scope={accountId:'account',profileId:'profile'};
let host:HTMLDivElement,root:Root,current:ApiReviewSession|null,source:ApiInspiration;
const onId=vi.fn(),onClose=vi.fn(),onNewInspiration=vi.fn(),onOpen=vi.fn();
const copy=()=>JSON.parse(JSON.stringify(current)) as ApiReviewSession|null;
beforeEach(()=>{
  vi.resetAllMocks();localStorage.clear();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  current={id:SID,profileId:scope.profileId,revision:0,cursor:0,currentInspirationId:SOURCE,createdAt:'2026-10-02T00:00:00Z',completedAt:null,
    items:[{inspirationId:SOURCE,position:0,sourceRevision:'1',currentRevision:'1',sourceChanged:false,reason:'unreviewed',choice:null,decidedAt:null,inspirationCreatedAt:'2026-10-01T00:00:00Z'}]};
  source={id:SOURCE,profileId:scope.profileId,text:'A little room for unplanned ideas.',kind:'note',source:'app',visibility:'private',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',attachments:[],reflections:[]};
  vi.mocked(fetchActiveReview).mockImplementation(async()=>copy());vi.mocked(fetchReviewSession).mockImplementation(async()=>copy());
  vi.mocked(fetchInspiration).mockImplementation(async()=>({...source}));
  vi.mocked(fetchInspirationPage).mockResolvedValue({inspirations:[{id:SOURCE,textPreview:source.text,kind:'note',source:'app',visibility:'private',createdAt:source.createdAt,updatedAt:source.updatedAt,attachmentSummary:[],reflectionCount:0}],total:1});
  vi.mocked(chooseReviewInspiration).mockImplementation(async(_id,input)=>{current={...current!,revision:input.revision+1,cursor:input.choice===null?0:1,currentInspirationId:input.choice===null?SOURCE:null,
    items:current!.items.map(item=>({...item,choice:input.choice}))};return copy();});
  vi.mocked(finishReviewSession).mockImplementation(async()=>{current={...current!,revision:current!.revision+1,completedAt:'2026-10-02T01:00:00Z',currentInspirationId:null};return copy();});
  vi.mocked(fetchReviewDialogue).mockImplementation(async()=>({sessionId:SID,profileId:scope.profileId,revision:current!.revision,answers:[],question:{phase:current!.completedAt?'closed':'empty'}}));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();window.history.replaceState(null,'','/');vi.useRealTimers();});
const mount=(id=SID)=>act(async()=>root.render(<ReviewPanel scope={scope} id={id} thoughtId={readViewLocation(window.location.pathname,window.location.search)?.reviewAnswerId} locale="en-US" onId={onId} onClose={onClose} onNewInspiration={onNewInspiration} onOpen={onOpen}/>));
const button=(label:string)=>[...host.querySelectorAll('button')].find(row=>row.textContent===label)!;
const click=(label:string)=>act(async()=>button(label).click());
it('opens the exact linked thought even while the review cursor is still on an inspiration',async()=>{
  const answerId='33333333-3333-4333-8333-333333333333';
  window.history.replaceState(null,'',`/review/${SID}?thought=${answerId}`);
  vi.mocked(fetchReviewDialogue).mockResolvedValue({sessionId:SID,profileId:scope.profileId,revision:1,latestAnswerId:answerId,
    answers:[{id:answerId,revision:1,question:'What stayed with you?',connection:null,answer:'The actual thought behind this reading.',contextValid:true,createdAt:source.createdAt,updatedAt:source.createdAt,sources:[]}],question:{phase:'idle',retryAfter:null}});
  await mount();const thought=host.querySelector(`#thought-${answerId}`)!;
  expect(thought.textContent).toContain('The actual thought behind this reading.');expect(host.querySelector<HTMLDetailsElement>('.jar-review-history')!.open).toBe(true);
  expect(document.activeElement).toBe(thought);expect(saveReviewAnswer).not.toHaveBeenCalled();expect(requestReviewQuestion).not.toHaveBeenCalled();
  await act(async()=>{host.querySelector<HTMLDetailsElement>('.jar-review-history')!.open=false;});
  expect(host.querySelector<HTMLDetailsElement>('.jar-review-history')!.open).toBe(false);
});
it('explains a removed linked thought without asking a model to replace it',async()=>{
  window.history.replaceState(null,'',`/review/${SID}?thought=33333333-3333-4333-8333-333333333333`);
  await mount();expect(host.textContent).toContain('This thought is no longer available.');expect(requestReviewQuestion).not.toHaveBeenCalled();
});
it('renders the current original and saves skip then reconsider without changing source words',async()=>{
  await mount();expect(host.textContent).toContain(source.text);expect(host.textContent).toContain('1 / 1');
  await click('Skip for now');expect(chooseReviewInspiration).toHaveBeenLastCalledWith(SID,{revision:0,inspirationId:SOURCE,sourceRevision:'1',choice:'skip'},scope.profileId,expect.any(AbortSignal));
  await click('Reconsider last choice');expect(vi.mocked(chooseReviewInspiration).mock.calls[1]![1].choice).toBeNull();expect(host.textContent).toContain(source.text);
});
it('uses arrows and touch swipes for the same choices but never treats mouse text selection as a swipe',async()=>{
  await mount();
  const pointer=(type:string,x:number,pointerType:string)=>{const event=new Event(type,{bubbles:true,cancelable:true});Object.assign(event,{clientX:x,clientY:20,pointerId:1,pointerType});host.querySelector('.jar-review-card')!.dispatchEvent(event);};
  await act(async()=>{pointer('pointerdown',20,'mouse');pointer('pointerup',130,'mouse');});expect(chooseReviewInspiration).not.toHaveBeenCalled();
  await act(async()=>{pointer('pointerdown',20,'touch');pointer('pointerup',130,'touch');});expect(vi.mocked(chooseReviewInspiration).mock.calls[0]![1].choice).toBe('keep');
  await click('Reconsider last choice');
  await act(async()=>host.querySelector('.jar-review-card')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true,cancelable:true})));
  expect(vi.mocked(chooseReviewInspiration).mock.calls.at(-1)![1].choice).toBe('skip');
});
it('offers a capture path for an empty archive without automatically starting a session',async()=>{
  current=null;vi.mocked(fetchInspirationPage).mockResolvedValue({inspirations:[],total:0});await mount('new');
  expect(host.textContent).toContain('Nothing to review yet');expect(startReviewSession).not.toHaveBeenCalled();await click('Capture inspiration');expect(onNewInspiration).toHaveBeenCalledOnce();
});
it('finishes early as an explicit action rather than implying a new principle was created',async()=>{
  await mount();await click('Finish review');expect(finishReviewSession).toHaveBeenCalledWith(SID,0,scope.profileId,expect.any(AbortSignal));
  expect(host.textContent).toContain('Review saved');expect(host.textContent).not.toContain('principle');
});
it('does not display or choose an older source under a newer material revision',async()=>{
  vi.mocked(fetchInspiration).mockImplementationOnce(async()=>{const before={...source,text:'Stale source wording'};source={...source,text:'Current source wording'};
    current={...current!,items:current!.items.map(item=>({...item,currentRevision:'2',sourceChanged:true}))};return before;});
  await mount();expect(host.textContent).not.toContain('Stale source wording');expect(host.textContent).toContain('Current source wording');
  await click('Stays with me');expect(vi.mocked(chooseReviewInspiration).mock.calls[0]![1].sourceRevision).toBe('2');
});
it('preserves manual selection order when starting from searched inspirations',async()=>{
  vi.useFakeTimers();const existing=copy();current=null;
  vi.mocked(startReviewSession).mockImplementation(async input=>{current={...existing!,id:input.id};return copy();});
  await mount('new');await click('Choose inspirations');
  await act(async()=>{const input=host.querySelector<HTMLInputElement>('.jar-inspiration-search input')!;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'room');input.dispatchEvent(new Event('input',{bubbles:true}));});
  await act(async()=>vi.advanceTimersByTimeAsync(250));await act(async()=>host.querySelector<HTMLButtonElement>('.jar-search-results button')!.click());
  await click('Start review');expect(vi.mocked(startReviewSession).mock.calls[0]![0].inspirationIds).toEqual([SOURCE]);
});
it.each([true,false,'keyboard'] as const)('keeps a single thought with Continue=%s and advances the finish revision',async continueThinking=>{
  const job='33333333-3333-4333-8333-333333333333';
  vi.mocked(fetchReviewDialogue).mockImplementation(async()=>({sessionId:SID,profileId:scope.profileId,revision:current!.revision,answers:[],latestAnswerId:null,
    question:{phase:'ready',question:'What stayed with you?',connection:null,sourceIds:[SOURCE],jobId:job,contextHash:'a'.repeat(64),retryAfter:null}}));
  vi.mocked(saveReviewAnswer).mockImplementation(async(_id,_profile,input)=>({sessionId:SID,profileId:scope.profileId,revision:current!.revision+1,latestAnswerId:input.id,
    answers:[{id:input.id,revision:1,question:'What stayed with you?',connection:null,answer:input.answer,contextValid:true,createdAt:current!.createdAt,updatedAt:current!.createdAt,
      sources:[{inspirationId:SOURCE,sourceRevision:'1',currentRevision:'1',referenced:true}]}],question:{phase:'idle',retryAfter:null}}));
  vi.mocked(requestReviewQuestion).mockImplementation(async(_id,_profile,after)=>({sessionId:SID,profileId:scope.profileId,revision:2,answers:[],latestAnswerId:after,question:{phase:'processing',retryAfter:null}}));
  await mount();await click('Stays with me');expect(host.textContent).toContain('What stayed with you?');expect(requestReviewQuestion).not.toHaveBeenCalled();
  await act(async()=>{const textarea=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,'My answer is one thought.');textarea.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(button('Finish review').disabled).toBe(true);
  if(continueThinking==='keyboard'){
    await act(async()=>host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true,cancelable:true})));
    expect(saveReviewAnswer).not.toHaveBeenCalled();
    await act(async()=>host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true})));
  }else await click(continueThinking?'Continue':'Keep thought, pause here');
  expect(saveReviewAnswer).toHaveBeenCalledOnce();expect(vi.mocked(saveReviewAnswer).mock.calls[0]![2]).toMatchObject({questionJobId:job,answer:'My answer is one thought.'});
  expect(requestReviewQuestion).toHaveBeenCalledTimes(continueThinking?1:0);expect(button('Finish review').disabled).toBe(false);
  await click('Finish review');expect(finishReviewSession).toHaveBeenCalledWith(SID,2,scope.profileId,expect.any(AbortSignal));
  expect(host.textContent).not.toContain('Explore another question');expect(host.querySelector('textarea')).toBeNull();
});
it('restores only selection ids and loads current source wording before Start',async()=>{
  current=null;storeReviewSelection(scope,{id:crypto.randomUUID(),writer:crypto.randomUUID(),ids:[SOURCE],query:'garden',updatedAt:Date.now()});
  source={...source,text:'Newly edited source words'};
  await mount('new');expect(host.textContent).toContain('Newly edited source words');expect(button('Start review').disabled).toBe(false);
  vi.mocked(startReviewSession).mockImplementation(async input=>({id:input.id,profileId:scope.profileId,revision:0,cursor:0,currentInspirationId:null,createdAt:source.createdAt,completedAt:null,items:[]}));
  await click('Start review');expect(vi.mocked(startReviewSession).mock.calls[0]![0].inspirationIds).toEqual([SOURCE]);expect(readReviewSelections(scope)).toHaveLength(0);
});
it('preserves an unavailable selection for explicit removal even when the archive is empty',async()=>{
  current=null;storeReviewSelection(scope,{id:crypto.randomUUID(),writer:crypto.randomUUID(),ids:[SOURCE],query:'',updatedAt:Date.now()});
  vi.mocked(fetchInspirationPage).mockResolvedValue({inspirations:[],total:0});vi.mocked(fetchInspiration).mockRejectedValue(new Error('Unavailable'));
  await mount('new');expect(button('Start review').disabled).toBe(true);expect(readReviewSelections(scope)[0]?.value.ids).toEqual([SOURCE]);
  await act(async()=>host.querySelector<HTMLButtonElement>('button[aria-label^="remove "]')!.click());expect(host.textContent).toContain('Nothing to review yet');
  expect(readReviewSelections(scope)[0]?.value.ids).toEqual([]);expect(startReviewSession).not.toHaveBeenCalled();
});
it.each([false,true])('offers copying rather than a futile retry for a closed review, clipboard unavailable=%s',async unavailable=>{
  current={...current!,completedAt:source.createdAt,currentInspirationId:null};
  const draft=newReviewDraft(crypto.randomUUID(),{phase:'ready',jobId:SOURCE,question:'Old question?',connection:null,sourceIds:[SOURCE],contextHash:'a'.repeat(64),retryAfter:null});
  storeReviewDraft(scope,SID,{...draft,answer:'Keep my unfinished words',submitted:true});
  const previous=Object.getOwnPropertyDescriptor(navigator,'clipboard'),writeText=vi.fn(async()=>{if(unavailable)throw new Error('Clipboard unavailable');});
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}});
  try{
    await mount();expect(host.textContent).toContain('This review is finished');expect(host.textContent).not.toContain('Retry this change');
    const textarea=host.querySelector('textarea')!;expect(textarea.readOnly).toBe(true);expect(textarea.disabled).toBe(false);
    await click('Copy draft');expect(writeText).toHaveBeenCalledWith('Keep my unfinished words');expect(host.textContent).toContain(unavailable?'Text selected. Copy it before leaving.':'Draft copied');expect(saveReviewAnswer).not.toHaveBeenCalled();
    if(unavailable){expect(textarea.selectionStart).toBe(0);expect(textarea.selectionEnd).toBe(textarea.value.length);}
  }finally{if(previous)Object.defineProperty(navigator,'clipboard',previous);else Reflect.deleteProperty(navigator,'clipboard');}
});
