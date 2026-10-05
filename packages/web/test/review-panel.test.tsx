// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: `lib/api` responses only. Review, single-inspiration
 * ReflectionFlow, durable save journals, confirmation and navigation run real.
 * No model calls or user data are used. SQL selection/deletion has DB tests. */
import {act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReviewPanel} from '../src/components/ReviewPanel';
import {profileStorageKey} from '../src/lib/profile-storage';
import {newReviewDraft,storeReviewDraft} from '../src/lib/review-dialogue-drafts';
import {ApiError,chooseReviewInspiration,createReflection,deleteInspiration,fetchActiveReview,fetchInspiration,fetchInspirationPage,fetchInspirationSaveRequest,fetchReflectionQuestionStatus,fetchReviewDialogue,fetchReviewProcessing,fetchReviewSession,finishReviewSession,requestReflectionQuestion,requestReviewQuestion,saveReviewAnswer,startReviewSession,type ApiInspiration,type ApiReviewSession} from '../src/lib/api';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),
  chooseReviewInspiration:vi.fn(),createReflection:vi.fn(),deleteInspiration:vi.fn(),fetchActiveReview:vi.fn(),fetchInspiration:vi.fn(),fetchInspirationPage:vi.fn(),fetchInspirationSaveRequest:vi.fn(),fetchReflectionQuestionStatus:vi.fn(),fetchReviewDialogue:vi.fn(),fetchReviewProcessing:vi.fn(),fetchReviewSession:vi.fn(),finishReviewSession:vi.fn(),requestReflectionQuestion:vi.fn(),requestReviewQuestion:vi.fn(),saveReviewAnswer:vi.fn(),startReviewSession:vi.fn()}));
const SID='11111111-1111-4111-8111-111111111111',SOURCE='22222222-2222-4222-8222-222222222222',SECOND='33333333-3333-4333-8333-333333333333',scope={accountId:'account',profileId:'profile'};
let host:HTMLDivElement,root:Root,current:ApiReviewSession|null,source:ApiInspiration,missing:boolean;
const onId=vi.fn(),onClose=vi.fn(),onNewInspiration=vi.fn(),onOpen=vi.fn(),onSaved=vi.fn(),onSynchronized=vi.fn(),onInspirationRemoved=vi.fn();
const copy=()=>structuredClone(current);
beforeEach(()=>{
  vi.resetAllMocks();localStorage.clear();missing=false;(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  current={id:SID,profileId:scope.profileId,revision:0,cursor:0,currentInspirationId:SOURCE,createdAt:'2026-10-02T00:00:00Z',completedAt:null,
    items:[{inspirationId:SOURCE,position:0,sourceRevision:'1',currentRevision:'1',sourceChanged:false,reason:'unreviewed',choice:null,decidedAt:null,inspirationCreatedAt:'2026-10-01T00:00:00Z'}]};
  source={id:SOURCE,profileId:scope.profileId,text:'A little room for unplanned ideas.',kind:'note',source:'app',visibility:'private',createdAt:'2026-10-01T00:00:00Z',updatedAt:'2026-10-01T00:00:00Z',attachments:[],reflections:[]};
  vi.mocked(fetchActiveReview).mockImplementation(async()=>copy());vi.mocked(fetchReviewSession).mockImplementation(async()=>copy());
  vi.mocked(fetchInspiration).mockImplementation(async id=>{if(missing)throw new ApiError({status:404,message:'Not found'});return {...structuredClone(source),id,text:id===SOURCE?source.text:'A second inspiration.'};});
  vi.mocked(fetchInspirationPage).mockResolvedValue({inspirations:[{id:SOURCE,textPreview:source.text,kind:'note',source:'app',visibility:'private',createdAt:source.createdAt,updatedAt:source.updatedAt,attachmentSummary:[],reflectionCount:0}],total:1});
  vi.mocked(chooseReviewInspiration).mockImplementation(async(_id,input)=>{
    const position=current!.items.find(row=>row.inspirationId===input.inspirationId)!.position;
    const cursor=input.choice===null?position:position+1;
    current={...current!,revision:input.revision+1,cursor,currentInspirationId:current!.items.find(row=>row.position>=cursor)?.inspirationId??null,
      items:current!.items.map(item=>item.inspirationId===input.inspirationId?{...item,choice:input.choice}:item)};return copy();
  });
  vi.mocked(finishReviewSession).mockImplementation(async()=>{current={...current!,revision:current!.revision+1,completedAt:'2026-10-02T01:00:00Z',currentInspirationId:null};return copy();});
  vi.mocked(deleteInspiration).mockImplementation(async()=>{missing=true;current={...current!,items:[],currentInspirationId:null};});
  vi.mocked(fetchReviewDialogue).mockImplementation(async()=>({sessionId:SID,profileId:scope.profileId,revision:current!.revision,answers:[],question:{phase:'closed'}}));
  vi.mocked(fetchReviewProcessing).mockResolvedValue({profileId:scope.profileId,sessionId:SID,phase:'empty',answerCount:0,completedCount:0,canRetry:false,runAfter:null,result:null,relatedPrinciples:[]});
  vi.mocked(fetchReflectionQuestionStatus).mockResolvedValue({phase:'idle'});
  vi.mocked(fetchInspirationSaveRequest).mockRejectedValue(new ApiError({status:404,code:'save_not_found',message:'Not found'}));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
const mount=(id=SID,thoughtId:string|null=null)=>act(async()=>root.render(<ReviewPanel scope={scope} id={id} thoughtId={thoughtId} locale="en-US" onId={onId} onClose={onClose} onNewInspiration={onNewInspiration} onOpen={onOpen} onSaved={onSaved} onSynchronized={onSynchronized} onInspirationRemoved={onInspirationRemoved}/>));
const button=(label:string)=>{const row=[...host.querySelectorAll('button')].find(row=>row.textContent?.trim()===label);if(!row)throw new Error(`Missing button: ${label}`);return row;};
const click=(label:string)=>act(async()=>button(label).click());
const answer=(value:string)=>act(async()=>{const textarea=host.querySelector('textarea')!;Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(textarea,value);textarea.dispatchEvent(new Event('input',{bubbles:true}));});
it('opens directly to one original with Reflect, Next and Remove, not stages or batch selection',async()=>{
  await mount();expect(host.textContent).toContain(source.text);expect(button('reflect')).toBeDefined();expect(button('Next inspiration →')).toBeDefined();expect(button('Remove')).toBeDefined();
  expect(host.querySelector('.jar-review-steps')).toBeNull();expect(host.textContent).not.toMatch(/Choose inspirations|Start review|Stays with me|Selected inspirations/);
  expect(requestReviewQuestion).not.toHaveBeenCalled();expect(requestReflectionQuestion).not.toHaveBeenCalled();expect(saveReviewAnswer).not.toHaveBeenCalled();
});
it('uses the snapshot original without a source/session/count round trip',async()=>{
  current={...current!,currentInspiration:{...source,materialRevision:'1'}};
  await mount();expect(host.textContent).toContain(source.text);expect(fetchInspiration).not.toHaveBeenCalled();expect(fetchInspirationPage).not.toHaveBeenCalled();expect(fetchReviewSession).toHaveBeenCalledOnce();
  expect(vi.mocked(fetchReviewSession).mock.calls[0]![3]).toBe(true);
});
it('starts a suggested single-source review on entry, with no manual manifest or model request',async()=>{
  const original=copy()!;current=null;
  vi.mocked(startReviewSession).mockImplementation(async input=>{current={...original,id:input.id};return copy();});
  await mount('new');expect(startReviewSession).toHaveBeenCalledOnce();expect(vi.mocked(startReviewSession).mock.calls[0]![0]).not.toHaveProperty('inspirationIds');
  expect(host.textContent).toContain(source.text);expect(requestReviewQuestion).not.toHaveBeenCalled();expect(requestReflectionQuestion).not.toHaveBeenCalled();
});
it('Next retains the inspiration, finishes its session and advances without a joint reflection',async()=>{
  await mount();await click('Next inspiration →');
  expect(chooseReviewInspiration).toHaveBeenCalledWith(SID,{revision:0,inspirationId:SOURCE,sourceRevision:'1',choice:'skip'},scope.profileId,expect.any(AbortSignal));
  expect(finishReviewSession).toHaveBeenCalledWith(SID,1,scope.profileId,expect.any(AbortSignal));expect(onId).toHaveBeenCalledWith('new');
  expect(deleteInspiration).not.toHaveBeenCalled();expect(requestReviewQuestion).not.toHaveBeenCalled();expect(saveReviewAnswer).not.toHaveBeenCalled();
});
it('keeps advancing across three real panel URL transitions without remounting or starting twice',async()=>{
  const original=copy()!,ids=[SOURCE,SECOND,'44444444-4444-4444-8444-444444444444'];let starts=0;
  current=null;
  vi.mocked(fetchActiveReview).mockImplementation(async()=>current&&!current.completedAt?copy():null);
  vi.mocked(startReviewSession).mockImplementation(async input=>{
    const inspirationId=ids[starts++]!;
    current={...original,id:input.id,currentInspirationId:inspirationId,items:[{...original.items[0]!,inspirationId}]};return copy();
  });
  function CyclingReview(){const[id,setId]=useState('new');return <ReviewPanel scope={scope} id={id} locale="en-US" onId={next=>{onId(next);setId(next);}} onClose={onClose} onNewInspiration={onNewInspiration} onOpen={onOpen}/>;}
  await act(async()=>root.render(<CyclingReview/>));
  for(let n=0;n<3;n++){
    expect(current?.currentInspirationId).toBe(ids[n]);expect(button('reflect').disabled).toBe(false);
    expect(startReviewSession).toHaveBeenCalledTimes(n+1);
    if(n<2)await click('Next inspiration →');
  }
  expect(chooseReviewInspiration).toHaveBeenCalledTimes(2);expect(finishReviewSession).toHaveBeenCalledTimes(2);
  expect(deleteInspiration).not.toHaveBeenCalled();expect(requestReviewQuestion).not.toHaveBeenCalled();
});
it('allows closing without advancing or deleting the current inspiration',async()=>{
  await mount();await click('done for now');expect(onClose).toHaveBeenCalledOnce();expect(chooseReviewInspiration).not.toHaveBeenCalled();expect(deleteInspiration).not.toHaveBeenCalled();
});
it('reflects on this inspiration only and saves into its normal reflection history',async()=>{
  vi.mocked(createReflection).mockImplementation(async(id,input)=>{
    const row={id:'answer-1',inspirationId:id,question:input.question,answer:input.answer!,skipped:false,createdAt:source.createdAt};
    source={...source,reflections:[row]};current={...current!,items:current!.items.map(item=>({...item,currentRevision:'2',sourceChanged:true}))};return row;
  });
  await mount();await click('reflect');expect(host.textContent).toContain('What made you want to keep this?');expect(host.querySelector('textarea')?.getAttribute('aria-label')).toBe('What made you want to keep this?');expect(host.querySelector('.jar-review-item-actions')).toBeNull();
  await answer('I need room to change my mind.');await click('Keep thought & return');
  expect(createReflection).toHaveBeenCalledOnce();expect(vi.mocked(createReflection).mock.calls[0]).toMatchObject([SOURCE,{answer:'I need room to change my mind.'},{profile:scope.profileId}]);
  expect(onSaved).toHaveBeenCalledOnce();expect(onSynchronized).toHaveBeenCalledWith(SOURCE,expect.objectContaining({reflections:[expect.objectContaining({answer:'I need room to change my mind.'})]}));
  expect(host.textContent).toContain('earlier thoughts (1)');expect(host.querySelector('textarea')).toBeNull();
  expect(requestReflectionQuestion).not.toHaveBeenCalled();expect(saveReviewAnswer).not.toHaveBeenCalled();
  await click('Next inspiration →');expect(vi.mocked(chooseReviewInspiration).mock.calls[0]![1]).toMatchObject({sourceRevision:'2',choice:'keep'});
});
it('requests a follow-up only for the current inspiration when Continue is chosen',async()=>{
  vi.mocked(createReflection).mockImplementation(async(id,input)=>{const row={id:'answer-1',inspirationId:id,question:input.question,answer:input.answer!,skipped:false,createdAt:source.createdAt};source={...source,reflections:[row]};return row;});
  vi.mocked(requestReflectionQuestion).mockResolvedValue({phase:'ready',question:'What would make that possible?'});
  await mount();await click('reflect');await answer('I want more space.');await click('continue →');
  expect(requestReflectionQuestion).toHaveBeenCalledWith(SOURCE,'answer-1',false,{profile:scope.profileId,signal:expect.any(AbortSignal)});
  expect(host.textContent).toContain('What would make that possible?');expect(requestReviewQuestion).not.toHaveBeenCalled();expect(chooseReviewInspiration).not.toHaveBeenCalled();
});
it('restores a source-scoped reflection draft on return without asking an AI',async()=>{
  localStorage.setItem(profileStorageKey(scope,`reflectionDraft:${SOURCE}`)!,JSON.stringify({afterId:null,question:'My unfinished question?',answer:'My unfinished thought'}));
  await mount();expect(host.querySelector('textarea')?.value).toBe('My unfinished thought');expect(host.textContent).toContain('My unfinished question?');
  expect(requestReflectionQuestion).not.toHaveBeenCalled();expect(createReflection).not.toHaveBeenCalled();
});
it('requires confirmation, focuses Keep and makes cancellation non-destructive',async()=>{
  await mount();await click('Remove');expect(host.textContent).toContain('cannot be undone');expect(document.activeElement).toBe(button('Keep inspiration'));expect(deleteInspiration).not.toHaveBeenCalled();
  await click('Keep inspiration');expect(host.textContent).not.toContain('cannot be undone');expect(deleteInspiration).not.toHaveBeenCalled();expect(host.textContent).toContain(source.text);
});
it('deletes only the displayed owned revision and advances after confirmed removal',async()=>{
  await mount();await click('Remove');await click('Delete inspiration');
  expect(deleteInspiration).toHaveBeenCalledWith(SOURCE,{profile:scope.profileId,sourceRevision:'1',signal:expect.any(AbortSignal)});
  expect(onInspirationRemoved).toHaveBeenCalledWith(SOURCE);expect(onId).toHaveBeenCalledWith('new');expect(chooseReviewInspiration).not.toHaveBeenCalled();
});
it('reconciles a lost delete response with GET, not another DELETE',async()=>{
  vi.mocked(deleteInspiration).mockImplementation(async()=>{missing=true;current={...current!,items:[],currentInspirationId:null};throw new ApiError({status:0,message:'Response lost'});});
  await mount();await click('Remove');await click('Delete inspiration');expect(deleteInspiration).toHaveBeenCalledOnce();expect(onInspirationRemoved).toHaveBeenCalledWith(SOURCE);expect(onId).toHaveBeenCalledWith('new');
});
it('keeps an inspiration visible when removal cannot be confirmed and never claims it was removed',async()=>{
  vi.mocked(deleteInspiration).mockRejectedValue(new ApiError({status:0,message:'offline'}));
  await mount();await click('Remove');await click('Delete inspiration');expect(host.textContent).toContain('Removal isn’t confirmed');expect(host.textContent).toContain(source.text);expect(onInspirationRemoved).not.toHaveBeenCalled();expect(onId).not.toHaveBeenCalled();
});
it('requires reading and confirming again after the original changed',async()=>{
  vi.mocked(deleteInspiration).mockImplementationOnce(async()=>{source={...source,text:'Updated original'};current={...current!,items:current!.items.map(item=>({...item,currentRevision:'2',sourceChanged:true}))};throw new ApiError({status:409,code:'inspiration_changed',message:'Changed'});});
  await mount();await click('Remove');await click('Delete inspiration');expect(host.textContent).toContain('Updated original');expect(host.textContent).not.toContain('cannot be undone');expect(onInspirationRemoved).not.toHaveBeenCalled();expect(deleteInspiration).toHaveBeenCalledOnce();
});
it('does not turn arrows or a touch swipe into an implicit deletion',async()=>{
  await mount();await act(async()=>{const card=host.querySelector('.jar-review-card')!;card.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
    for(const type of ['pointerdown','pointerup']){const event=new Event(type,{bubbles:true});Object.assign(event,{clientX:type==='pointerdown'?100:0,clientY:0,pointerId:1,pointerType:'touch'});card.dispatchEvent(event);}});
  expect(deleteInspiration).not.toHaveBeenCalled();expect(chooseReviewInspiration).not.toHaveBeenCalled();
});
it('opens old multi-item sessions one original at a time, never as a group reflection',async()=>{
  current={...current!,items:[current!.items[0]!,{...current!.items[0]!,inspirationId:SECOND,position:1}]};
  await mount();expect(host.textContent).not.toContain('A second inspiration.');await click('Next inspiration →');expect(host.textContent).toContain('A second inspiration.');expect(host.textContent).not.toContain(source.text);
  expect(finishReviewSession).not.toHaveBeenCalled();expect(requestReviewQuestion).not.toHaveBeenCalled();
});
it('distinguishes an empty archive from having no eligible inspiration right now',async()=>{
  current=null;vi.mocked(startReviewSession).mockResolvedValue(null);vi.mocked(fetchInspirationPage).mockResolvedValue({inspirations:[],total:0});
  await mount('new');expect(host.textContent).toContain('Nothing to review yet');await click('Capture inspiration');expect(onNewInspiration).toHaveBeenCalledOnce();expect(requestReflectionQuestion).not.toHaveBeenCalled();
  await act(async()=>root.unmount());root=createRoot(host);vi.mocked(fetchInspirationPage).mockResolvedValue({inspirations:[],total:3});await mount('new');expect(host.textContent).toContain('You’re caught up for now');
});
it('preserves historical thought links without creating a new collective question',async()=>{
  vi.mocked(fetchReviewDialogue).mockResolvedValue({sessionId:SID,profileId:scope.profileId,revision:1,latestAnswerId:SECOND,
    answers:[{id:SECOND,revision:1,question:'What stayed with you?',connection:null,answer:'The actual thought behind this reading.',contextValid:true,createdAt:source.createdAt,updatedAt:source.createdAt,sources:[]}],question:{phase:'idle',retryAfter:null}});
  await mount(SID,SECOND);expect(host.querySelector(`#thought-${SECOND}`)?.textContent).toContain('The actual thought behind this reading.');expect(host.querySelector<HTMLDetailsElement>('.jar-review-history')!.open).toBe(true);expect(document.activeElement?.id).toBe(`thought-${SECOND}`);
  expect(requestReviewQuestion).not.toHaveBeenCalled();expect(host.querySelector('.jar-review-card')).toBeNull();
});
it.each([false,true])('keeps legacy drafts copyable without a collective question, completed=%s',async completed=>{
  current={...current!,completedAt:completed?source.createdAt:null,currentInspirationId:null};
  const draft=newReviewDraft(crypto.randomUUID(),{phase:'ready',jobId:SOURCE,question:'Old question?',connection:null,sourceIds:[SOURCE],contextHash:'a'.repeat(64),retryAfter:null});storeReviewDraft(scope,SID,{...draft,answer:'Keep my unfinished words',submitted:true});
  await mount();expect(host.textContent).toContain('Your earlier draft is kept here');expect(button('Copy draft')).toBeDefined();expect(host.querySelector('textarea')?.readOnly).toBe(true);expect(requestReviewQuestion).not.toHaveBeenCalled();
});
