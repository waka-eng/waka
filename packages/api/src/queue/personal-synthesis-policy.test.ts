/** WHAT THIS MOCKS, AND WHY: nothing. These policy regressions pin constraints
 * exposed by the fixed live matrix; behavioral quality is evaluated separately. */
import {expect,it} from 'vitest';
import {TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION} from './gemini.js';
it('distinguishes a saved reference from attendance and leads with selected focus',()=>{
  expect(TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION).toContain('does not mean the person attended it');
  expect(TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION).toContain('first supplied signal is the selected leading focus');
  expect(TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION).toContain('unless a human-kept entry already leads');
});
