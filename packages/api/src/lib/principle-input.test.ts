/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Pure selection and the actual
 * provider serializer prove input bounds without a database or model call. */
import {expect,it} from 'vitest';
import {PRINCIPLE_INPUT_LIMITS,renderPrincipleDistillContext,selectPrincipleInput} from './principle-input.js';
import {buildPrincipleDistillRequest} from '../queue/gemini.js';
import type {DistillPrinciplesInput} from './model-provider.js';
const fixture=(count=400):DistillPrinciplesInput=>({profileId:'fixture',preferredLocale:'en-US',
  signals:Array.from({length:count},(_,i)=>({id:`s${String(i).padStart(3,'0')}`,statement:`A supported signal ${i}.`,evidenceCount:3,firstEvidenceAt:new Date('2026-01-01'),lastEvidenceAt:new Date('2026-09-01'),tomAppearances:1})),
  currentPrinciples:Array.from({length:200},(_,i)=>({id:`p${i}`,statement:`Standing preference ${i}.`,state:'held'})),currentEntries:[{body:'A current focus.'}]});
it('bounds a large input without mutating or rewriting human text',()=>{
  const input=fixture(),before=JSON.stringify(input),selected=selectPrincipleInput(input);
  expect(selected.signals).toHaveLength(48);expect(selected.currentPrinciples).toHaveLength(24);
  expect(renderPrincipleDistillContext(selected).length).toBeLessThanOrEqual(PRINCIPLE_INPUT_LIMITS.characters);
  expect(JSON.stringify(input)).toBe(before);
  for(const row of selected.signals)expect(input.signals.find(source=>source.id===row.id)?.statement).toBe(row.statement);
});
it('makes room for a current focus while retaining established background',()=>{
  const selected=selectPrincipleInput(fixture(),new Set(['s399']));
  expect(selected.signals[0]?.id).toBe('s399');expect(selected.signals.some(row=>row.id==='s000')).toBe(true);
});
it('budgets actual serialized characters and refuses unbounded provider requests',()=>{
  const input=fixture();input.signals.forEach(row=>{row.statement='긴 문장을 그대로 보존한다. '.repeat(80);});
  const selected=selectPrincipleInput(input);
  expect(selected.signals.length).toBeGreaterThanOrEqual(3);
  expect(buildPrincipleDistillRequest(selected).contents[0]!.parts[0]!.text.length).toBeLessThanOrEqual(16000);
  expect(()=>buildPrincipleDistillRequest(input)).toThrow(/principle input bounds/);
});
