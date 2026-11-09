/** WHAT THIS MOCKS, AND WHY: `fetch` supplies the wire. The real client
 * builds the image-words requests and verifies what comes back. */
import {afterEach,expect,it,vi} from 'vitest';
import {correctImageWords,fetchImageWords,retryImageWords} from '../src/lib/api/attachments';
afterEach(()=>vi.unstubAllGlobals());
const words={attachmentId:'img',inspirationId:'source',profileId:'owner',status:'ready',text:'Begin badly.',read:'Begin badly.',
  correction:null,revision:'0',correctedAt:null,canEdit:true,canRetry:false,retryAfter:null};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status});

it('reads the words for one image',async()=>{
  const fetch=vi.fn().mockResolvedValue(reply(words));vi.stubGlobal('fetch',fetch);
  expect(await fetchImageWords('img')).toEqual(words);
  expect(fetch.mock.calls[0][0]).toBe('/api/attachments/img/words');
});
it('sends a fix with its revision and returns the new state',async()=>{
  const fixed={...words,text:'The line that stuck',correction:'The line that stuck',revision:'1',correctedAt:'2026-11-08T00:00:00Z'};
  const fetch=vi.fn().mockResolvedValue(reply(fixed));vi.stubGlobal('fetch',fetch);
  expect(await correctImageWords('img',{revision:'0',correction:'The line that stuck'})).toEqual(fixed);
  expect(fetch.mock.calls[0][0]).toBe('/api/attachments/img/words');
  expect(fetch.mock.calls[0][1].method).toBe('PATCH');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({revision:'0',correction:'The line that stuck'});
});
it('queues another read',async()=>{
  const fetch=vi.fn().mockResolvedValue(reply({...words,status:'retrying',text:null,read:null},202));vi.stubGlobal('fetch',fetch);
  expect(await retryImageWords('img')).toMatchObject({status:'retrying'});
  expect(fetch.mock.calls[0][0]).toBe('/api/attachments/img/words/retry');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({});
});
it.each([{...words,attachmentId:'other'},{...words,status:'queued'},{...words,revision:'x'},{...words,text:3},{...words,canRetry:'no'}])
('refuses words it cannot verify %#',async(body)=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(reply(body)));
  await expect(fetchImageWords('img')).rejects.toMatchObject({code:'invalid_response'});
});
