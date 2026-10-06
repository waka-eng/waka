/** WHAT THIS MOCKS, AND WHY: nothing. Temporal intent is a bounded, pure
 * routing hint, not a model inference or authorization decision. */
import {expect,it} from 'vitest';
import {asksAboutThinkingChange} from './conversation-readings.js';
it.each(['What has changed in how I think?','How has my thinking evolved?','Compare my earlier reading with now.','내 생각은 어떻게 달라졌나요?','이전 생각과 지금 생각을 비교해 주세요.'])('recognizes a comparison request: %s',question=>expect(asksAboutThinkingChange(question)).toBe(true));
it.each(['Help me make a choice.','Try a small experiment before committing.','What is important to me lately?','How can I learn drawing?','작게 시도해 보고 싶어요.'])('does not collect historical context for %s',question=>expect(asksAboutThinkingChange(question)).toBe(false));
