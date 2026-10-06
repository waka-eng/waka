/** WHAT THIS MOCKS, AND WHY: nothing. Real bilingual UI messages are checked
 * against the provider-free preview policy; no account/database/network. */
import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {CONVERSATION_STARTERS,conversationPreview} from './conversation-preview.js';
it('keeps the declared starters aligned with both UI languages',()=>{
  const words=['en-US','ko-KR'].flatMap(locale=>{
    const messages=JSON.parse(readFileSync(new URL(`../../../web/src/lib/i18n/messages/${locale}.json`,import.meta.url),'utf8'));
    return ['Choice','Meaning','Change'].map(kind=>messages['worldConversationStarter'+kind]);
  });
  expect([...CONVERSATION_STARTERS]).toEqual(words);
});
it.each(CONVERSATION_STARTERS)('uses the first actual topic after %s',content=>{
  expect(conversationPreview([{role:'user',content},{role:'assistant',content:'An invented assistant label'},{role:'user',content:'Should I take the evening course?'}])).toBe('Should I take the evening course?');
});
it('preserves starter-only/empty threads and bounds the human topic',()=>{
  expect(conversationPreview([])).toBe('');
  expect(conversationPreview([{role:'assistant',content:'Do not promote this'}])).toBe('');
  expect(conversationPreview([{role:'user',content:CONVERSATION_STARTERS[0]}])).toBe(CONVERSATION_STARTERS[0]);
  expect(conversationPreview([{role:'user',content:'x'.repeat(500)}])).toHaveLength(120);
});
