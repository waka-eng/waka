/** WHAT THIS MOCKS, AND WHY: nothing. The provider-free preview policy is
 * exercised directly against literal message arrays; no account, database,
 * network or locale catalogue is read. That last one is deliberate and is
 * the subject of the first case below. */
import {expect,it} from 'vitest';
import {CONVERSATION_STARTERS,conversationPreview} from './conversation-preview.js';

/**
 * THE STARTERS ARE A RECORD OF WHAT WAS SENT, NOT A COPY OF WHAT IS OFFERED.
 *
 * This file used to read `web/src/lib/i18n/messages/*.json` and assert that
 * `CONVERSATION_STARTERS` equalled the three starter pills in both languages.
 * That was the correct test for as long as the pills existed, and it failed
 * the moment they were removed from the chat surface and their locale keys
 * were deleted with them.
 *
 * The failure was right to happen and the fix is NOT to re-add the keys: the
 * web catalogue forbids strings nothing renders, so restoring them to satisfy
 * this would put three dead entries in front of a translator. What changed is
 * the RELATIONSHIP. While the pills were on screen these two lists had to
 * agree. Now the pills are gone and the list is a record of text sitting in
 * rows that were written while they existed — so it must not follow UI copy
 * at all, and this case exists to stop anyone re-coupling them.
 *
 * It can only grow. If a future surface ever offers canned openers again,
 * their text is APPENDED here; nothing is ever removed, because removal
 * silently renames every old conversation that began with one.
 */
it('keeps the starters frozen and independent of what the product currently says',()=>{
  /* The tripwire first: an empty or truncated list makes every case below
     vacuous AND quietly renames old threads in the list, which is the
     expensive half of getting this wrong. */
  expect(CONVERSATION_STARTERS.length,'starters were removed — old conversations are now named by the button they began with').toBeGreaterThanOrEqual(6);
  expect(new Set(CONVERSATION_STARTERS).size,'a duplicated starter means one was edited rather than appended').toBe(CONVERSATION_STARTERS.length);
  for(const starter of CONVERSATION_STARTERS)expect(starter.trim(),'a blank starter would suppress every real first message').toBe(starter);
  /* Both languages are still represented, because a thread begun in Korean
     has to be named by its topic too. */
  expect(CONVERSATION_STARTERS.some(value=>/[\uac00-\ud7af]/.test(value))).toBe(true);
  expect(CONVERSATION_STARTERS.some(value=>/^[\x20-\x7e]+$/.test(value))).toBe(true);
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
