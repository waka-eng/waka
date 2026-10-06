/** Shared, provider-free sidebar preview policy. No generated title or write. */
export const CONVERSATION_STARTERS=[
  'Help me think through a choice.',
  'What seems important to me lately?',
  'What has changed in how I think?',
  '선택을 함께 생각해 보고 싶어요.',
  '요즘 나에게 무엇이 중요한가요?',
  '내 생각은 어떻게 달라졌나요?',
] as const;

export function conversationPreview(messages:ReadonlyArray<{role:string;content:string}>):string {
  const human=messages.filter(message=>message.role==='user');
  const topic=human.find(message=>!CONVERSATION_STARTERS.some(starter=>starter===message.content.trim()));
  return (topic??human[0])?.content.trim().slice(0,120)??'';
}
