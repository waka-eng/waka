/** WHAT THIS MOCKS, AND WHY (gate G6): This suite mocks nothing. Pure local timing records prove bounded data and profile-specific reply matching without network or browser fixtures. */
import { expect, it, vi } from 'vitest';
import { journeyMeasurements, measureJourney, observeReplyTiming, startJourney, startReplyTiming } from '../src/lib/journey-performance';
it('records acknowledgements separately, bounds local history, and counts failure without swallowing it', async () => {
  const finish = startJourney('home_ready'); finish(); finish();
  expect(journeyMeasurements()).toHaveLength(1);
  await expect(measureJourney('inspiration_saved', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
  expect(journeyMeasurements().at(-1)).toMatchObject({name:'inspiration_saved',success:false});
  for(let i=0;i<110;i++) startJourney('chat_acknowledged')();
  const rows=journeyMeasurements(); expect(rows).toHaveLength(100);
  expect(Object.keys(rows[0]).sort()).toEqual(['durationMs','name','success']);
  rows[0].durationMs=-1; expect(journeyMeasurements()[0].durationMs).toBeGreaterThanOrEqual(0);
});
it('times only the reply to this send, across conversation remounts, without measuring another profile', () => {
  const count=()=>journeyMeasurements().filter(row=>row.name==='chat_reply').length;
  startReplyTiming('mine','chat',3);
  observeReplyTiming({profileId:'other',id:'chat',messages:[{role:'assistant',position:4}]});
  observeReplyTiming({profileId:'mine',id:'chat',messages:[{role:'assistant',position:2},{role:'user',position:3}]});
  expect(count()).toBe(0);
  observeReplyTiming({profileId:'mine',id:'chat',messages:[{role:'assistant',position:4}]});
  expect(count()).toBe(1);
  observeReplyTiming({profileId:'mine',id:'chat',messages:[{role:'assistant',position:4}]});
  expect(count()).toBe(1);
});
