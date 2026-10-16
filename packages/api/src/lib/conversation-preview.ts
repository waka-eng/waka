/**
 * Shared, provider-free preview policy. No generated title or write.
 *
 * ── THESE ARE HISTORICAL DATA, NOT UI COPY, AND THE DIFFERENCE IS NEW ──
 *
 * These six sentences were the three starter pills the chat surface offered,
 * in both languages. The pills are gone: the founder, on that screen, "so
 * many different buttons that I have no idea what its supposed to do" — and
 * each pill SENT A MESSAGE ON ONE PRESS, so three of the first things a
 * stranger saw were irreversible.
 *
 * The strings have to stay anyway, and that is the point of this note. Every
 * conversation begun by pressing a pill has one of them stored as its first
 * human message, and `conversationPreview` exists so that such a thread is
 * named by what the person actually went on to ask rather than by the button
 * they pressed to begin. Deleting these would silently rename every one of
 * those older conversations in the list to "Help me think through a choice."
 *
 * SO THIS LIST IS FROZEN AND MUST NEVER AGAIN BE ALIGNED TO UI COPY. Its
 * test used to read the web locale catalogue and assert these matched it,
 * which was right while the pills existed and broke the moment the keys were
 * deleted with them. The relationship is inverted now: this is a record of
 * text that was once sent, so it changes only by GROWING, never by following
 * what the product currently says. See `conversation-preview.test.ts`.
 */
export const CONVERSATION_STARTERS=[
  'Help me think through a choice.',
  'What seems important to me lately?',
  'What has changed in how I think?',
  '선택을 함께 생각해 보고 싶어요.',
  '요즘 나에게 무엇이 중요한가요?',
  '내 생각은 어떻게 달라졌나요?',
] as const;

export function conversationPreview(messages:ReadonlyArray<{role:string;content:string}>):string {
  // A photo- or file-only message (0076) has no words to name a thread by.
  const human=messages.filter(message=>message.role==='user'&&message.content.trim().length>0);
  const topic=human.find(message=>!CONVERSATION_STARTERS.some(starter=>starter===message.content.trim()));
  return (topic??human[0])?.content.trim().slice(0,120)??'';
}
