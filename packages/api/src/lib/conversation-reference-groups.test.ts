/** WHAT THIS MOCKS, AND WHY: `select` refuses database reads so empty and
 * malformed group bounds cannot quietly purchase unbounded read work. */
import {expect,it,vi} from 'vitest';
import {currentConversationReferenceGroups} from './conversation-context.js';
const reference={kind:'principle' as const,id:'synthetic',hash:'synthetic'};
it('returns empty groups without reading memory',async()=>{
  const select=vi.fn(()=>{throw new Error('Unexpected SQL');});
  expect(await currentConversationReferenceGroups({select} as never,'owner',Array.from({length:200},()=>[]))).toHaveLength(200);
  expect(select).not.toHaveBeenCalled();
});
it.each([{groups:Array.from({length:201},()=>[])},{groups:[Array.from({length:4},()=>reference)]}])('refuses oversized groups before SQL %#',async({groups})=>{
  const select=vi.fn(()=>{throw new Error('Unexpected SQL');});
  await expect(currentConversationReferenceGroups({select} as never,'owner',groups)).rejects.toThrow('Conversation reference bounds');
  expect(select).not.toHaveBeenCalled();
});
