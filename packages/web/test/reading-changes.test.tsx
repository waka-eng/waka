// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` provides stored reading
 * snapshots and failures. Real comparison selection, modal and owner fencing
 * run; these tests do not claim visual or database verification. */
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ReadingChanges} from '../src/components/ReadingChanges';
import {fetchTopOfMindVersions,fetchTopOfMindVersion,type ApiTopOfMind} from '../src/lib/api';
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),fetchTopOfMindVersions:vi.fn(),fetchTopOfMindVersion:vi.fn()}));
let host:HTMLDivElement,root:Root;
const make=(id:string,version:number,body:string):ApiTopOfMind=>({id,version,profileId:'owner',reason:'regenerated',createdAt:'2026-10-03T12:00:00Z',entries:[{id:`${id}-entry`,type:'pattern',body,locked:false,pinned:false,dismissed:false,sortOrder:0,citedSignals:[]}]});
const readings=[make('old',1,'The earlier words.'),make('shown',2,'The words currently displayed.'),make('newer',3,'A later reading not yet displayed.')];
beforeEach(()=>{
  vi.resetAllMocks();(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  host=document.createElement('div');host.className='jar';document.body.append(host);root=createRoot(host);
  vi.mocked(fetchTopOfMindVersions).mockResolvedValue(readings.map(row=>({...row,status:row.version===3?'live':'superseded',entryCount:1,replacedById:null,replacedAt:null})));
  vi.mocked(fetchTopOfMindVersion).mockImplementation(async id=>readings.find(row=>row.id===id)!);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
const mount=()=>act(async()=>root.render(<ReadingChanges profileId="owner" readingId="shown" locale="en-US"/>));
const click=(text:string)=>act(async()=>{[...document.querySelectorAll('button')].find(row=>row.textContent===text)!.click();});
it('compares the displayed reading with its predecessor even when a newer reading exists',async()=>{
  await mount();expect(fetchTopOfMindVersions).not.toHaveBeenCalled();await click('What changed');
  expect(fetchTopOfMindVersions).toHaveBeenCalledWith({profile:'owner'},expect.any(AbortSignal));
  expect(vi.mocked(fetchTopOfMindVersion).mock.calls.map(row=>row[0])).toEqual(['shown','old']);
  /* THE EARLIER READING IS NO LONGER PRINTED IN FULL, and that is the
     redesign rather than a regression: one passage is shown — the current
     one — with the words this rewrite brought carrying the light, and the
     words it dropped faded beneath. What still has to be true is that the
     comparison was made against the PREDECESSOR of the displayed reading,
     which the call order above asserts, and that its dropped words actually
     surface. "The earlier words." against "The words currently displayed."
     drops exactly one: "earlier". */
  expect(document.querySelector('.jar-drift-left')!.textContent).toContain('earlier');
  expect(document.querySelector('.jar-drift-reading')!.textContent).toContain('The words currently displayed.');
  expect(document.querySelector('[role="dialog"]')!.closest('.jar')).toBe(host);
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain('A later reading');
  await click('close');expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it('can retry a failed read without replacing it with an invented first-reading state',async()=>{
  vi.mocked(fetchTopOfMindVersions).mockRejectedValueOnce(new Error('Unavailable'));await mount();await click('What changed');
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('couldn’t be opened');expect(document.body.textContent).not.toContain('This is your first reading');
  await click('Try again');expect(document.querySelector('[role="alert"]')).toBeNull();expect(document.querySelector('.jar-drift-left')!.textContent).toContain('earlier');
});
it('refuses a foreign reading instead of displaying its words',async()=>{
  vi.mocked(fetchTopOfMindVersion).mockResolvedValueOnce({...readings[1],profileId:'other-owner'});
  await mount();await click('What changed');expect(document.querySelector('[role="alert"]')).not.toBeNull();expect(document.body.textContent).not.toContain('The words currently displayed.');
});
it('states that wording stayed the same when the actual stored bodies match',async()=>{
  vi.mocked(fetchTopOfMindVersion).mockImplementation(async id=>{const row=readings.find(value=>value.id===id)!;return {...row,entries:row.entries.map(entry=>({...entry,body:'The same kept wording.'}))};});
  await mount();await click('What changed');expect(document.body.textContent).toContain('The reading stayed the same.');
});
it('does not call a missing predecessor the first reading when the displayed reading is later',async()=>{
  vi.mocked(fetchTopOfMindVersions).mockResolvedValue([]);await mount();await click('What changed');
  expect(document.body.textContent).not.toContain('This is your first reading');expect(document.body.textContent).toContain('no longer available');
});
