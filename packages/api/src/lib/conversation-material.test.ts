/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Pure query construction must
 * preserve human context without making a provider or database request. */
import {expect,it} from 'vitest';
import {conversationSearchQuery,conversationSearchTerms} from './conversation-material.js';
it('retains short Korean concepts while dropping generic question words',()=>{
  expect(conversationSearchTerms('What about 쉼?')).toEqual(['쉼']);
});
it('uses the previous human topic for a short continuation, not assistant assumptions',()=>{
  const history=[{role:'user',content:'I want to make room for quiet mornings.'},{role:'assistant',content:'UNADOPTED_ASSUMPTION'},{role:'user',content:'What about that?'}];
  expect(conversationSearchQuery(history)).toContain('quiet mornings');
  expect(conversationSearchQuery(history)).not.toContain('UNADOPTED_ASSUMPTION');
  expect(conversationSearchQuery([...history,{role:'user',content:'그건 어떻게 생각해요?'}])).toContain('quiet mornings');
});
it('does not attach an old topic to an explicit new one and bounds retrieval-only input',()=>{
  expect(conversationSearchQuery([{role:'user',content:'Quiet mornings'},{role:'user',content:'Explain pottery glazing'}])).toBe('Explain pottery glazing');
  expect(conversationSearchQuery([{role:'user',content:'x'.repeat(4000)}])).toHaveLength(1000);
});
it('a photo- or file-only message searches with the latest words that exist, then with what was attached',()=>{
  const history=[{role:'user',content:'Planning the kitchen remodel'},{role:'assistant',content:'Tell me more.'},{role:'user',content:''}];
  const photo=[{name:'tile_sample.png'}];
  expect(conversationSearchQuery([...history.slice(0,2),{role:'user',content:'',attachments:photo}])).toBe('Planning the kitchen remodel');
  expect(conversationSearchQuery([{role:'user',content:'',attachments:[{name:'kyoto_garden.png'},{name:null}]}])).toBe('kyoto garden');
  // The names of the LATEST message of yours, not of an earlier one.
  expect(conversationSearchQuery([{role:'user',content:'',attachments:photo},{role:'assistant',content:'Nice.'},{role:'user',content:'',attachments:[{name:'IMG_2041.jpg'}]}])).toBe('IMG 2041');
  expect(conversationSearchQuery([{role:'assistant',content:'Hello'},{role:'user',content:''}])).toBe('');
});
