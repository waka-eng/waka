/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real URL parsing rejects
 * external and cross-account return metadata and retains owned local paths. */
import {expect,it} from 'vitest';
import {chatReturnPath} from '../src/lib/chat-navigation';
import {EMPTY_VIEW,readViewLocation,viewHref} from '../src/lib/view-location';
it('retains the principle context on the new composer route',()=>{
  const view={...EMPTY_VIEW,conversationId:'new',principleId:'principle-one'};
  expect(viewHref(view)).toBe('/chat/new?principle=principle-one');
  expect(readViewLocation('/chat/new','?principle=principle-one')).toEqual(view);
});
it('returns only to scoped local views, never to external or looping chat paths',()=>{
  const state=(from:unknown,scope='a:p')=>({wakaView:{scope,conversationFrom:from}});
  expect(chatReturnPath(state('/principles/principle-one'),'a:p')).toBe('/principles/principle-one');
  expect(chatReturnPath(state('/?view=field&inspiration=one'),'a:p')).toBe('/?view=field&inspiration=one');
  for(const value of ['//evil.test/w/one','/\\evil.test','https://evil.test','/chat/new','/missing',42,null])expect(chatReturnPath(state(value),'a:p')).toBe('/');
  expect(chatReturnPath(state('/principles/private','other'),'a:p')).toBe('/');
});
