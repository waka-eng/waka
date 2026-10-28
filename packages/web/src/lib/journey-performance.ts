/** Local User Timing only: no text, identifiers or analytics transport. These
 * numbers distinguish an acknowledged save from later model processing. */
export type JourneyMetric = 'home_ready' | 'inspiration_saved' | 'chat_acknowledged' | 'chat_reply';
export interface JourneyMeasurement { name: JourneyMetric; durationMs: number; success: boolean }
const recent: JourneyMeasurement[] = [];
export function startJourney(name: JourneyMetric) {
  const start = performance.now(); let finished = false;
  return (success = true) => {
    if (finished) return; finished = true;
    const end = performance.now(), row = { name, durationMs: Math.round((end - start) * 10) / 10, success };
    recent.push(row); if (recent.length > 100) recent.shift();
    try { performance.clearMeasures(`waka:${name}`); performance.measure(`waka:${name}`, { start, end, detail: { success } }); } catch { /* Diagnostics never affect a journey. */ }
    if (import.meta.env.VITE_PERFORMANCE_DEBUG === '1') console.info('[waka-performance]', JSON.stringify(row));
  };
}
export async function measureJourney<T>(name: JourneyMetric, work: () => Promise<T>): Promise<T> {
  const finish = startJourney(name);
  try { const result = await work(); finish(); return result; }
  catch (error) { finish(false); throw error; }
}
export function journeyMeasurements(): JourneyMeasurement[] { return recent.map(row => ({ ...row })); }
const replies = new Map<string, { after: number; finish: (success?: boolean) => void }>();
export function startReplyTiming(profile: string, conversation: string, after: number) {
  const key = `${profile}:${conversation}`;
  if (!replies.has(key)) replies.set(key, { after, finish: startJourney('chat_reply') });
  while (replies.size > 20) replies.delete(replies.keys().next().value!);
}
export function observeReplyTiming(row: { profileId: string; id: string; messages: Array<{ role: string; position: number }> }) {
  const key = `${row.profileId}:${row.id}`, current = replies.get(key);
  if (current && row.messages.some(message => message.role === 'assistant' && message.position > current.after)) {
    replies.delete(key); current.finish();
  }
}

export function cancelReplyTiming(profile: string, conversation: string) {
  const key = `${profile}:${conversation}`, current = replies.get(key);
  if (current) { replies.delete(key); current.finish(false); }
}
