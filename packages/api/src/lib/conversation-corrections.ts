import type {ConversationReplyInput} from './model-provider.js';

/** The worker, prompt and citation decoder share one correction policy. This
 * routes the current reply only; it never edits or erases stored memory. */
export function conversationUsesSavedSources(history:ConversationReplyInput['history']):boolean{
  const latest=history.at(-1);
  const comparison=latest&&/\b(?:compare|comparison|contrast|versus)\b|different from|비교|대조|차이/iu.test(latest.content);
  return !(latest?.role==='user'&&latest.correction&&!comparison);
}
