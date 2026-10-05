import type {DistillPrinciplesInput} from './model-provider.js';

export const PRINCIPLE_INPUT_LIMITS={signals:48,standingContext:24,entries:7,characters:16000} as const;

/** Shared with the provider builder so the budget measures actual prompt
 * text rather than an optimistic estimate. Human wording is never truncated. */
export function renderPrincipleDistillContext(input:DistillPrinciplesInput){
  const sections=[`Locale: ${input.preferredLocale}.`,"The person's long-lived signals (id · statement · stats):"];
  for(const signal of input.signals)sections.push(['<<<signal>>>',`id: ${signal.id}`,`statement: ${signal.statement}`,
    `evidence: ${signal.evidenceCount} captures, first ${signal.firstEvidenceAt?.toISOString().slice(0,10)??'unknown'}, last ${signal.lastEvidenceAt?.toISOString().slice(0,10)??'unknown'}, selected into ${signal.tomAppearances} top-of-mind versions`,'<<<end>>>'].join('\n'));
  if(input.currentPrinciples.length){sections.push('Principles the person already holds (do not restate):');for(const row of input.currentPrinciples)sections.push(['<<<principle>>>',row.statement,'<<<end>>>'].join('\n'));}
  if(input.currentEntries.length){sections.push('Current top-of-mind entries (a principle must generalize beyond these, never echo one):');for(const row of input.currentEntries)sections.push(['<<<entry>>>',row.body,'<<<end>>>'].join('\n'));}
  return sections.join('\n\n');
}

/** Recent focus gets half the space; established evidence gets the remainder.
 * Standing context is advisory only: matching must still check the full set. */
export function selectPrincipleInput(input:DistillPrinciplesInput,focusIds:ReadonlySet<string>=new Set()):DistillPrinciplesInput{
  const span=(row:DistillPrinciplesInput['signals'][number])=>Math.max(0,(row.lastEvidenceAt?.getTime()??0)-(row.firstEvidenceAt?.getTime()??0));
  const ordered=[...input.signals].sort((a,b)=>b.tomAppearances-a.tomAppearances||span(b)-span(a)||b.evidenceCount-a.evidenceCount||a.id.localeCompare(b.id));
  const focused=ordered.filter(row=>focusIds.has(row.id)),background=ordered.filter(row=>!focusIds.has(row.id));
  const chosen=[...focused.slice(0,24),...background];
  chosen.push(...focused.slice(24));
  const selected:DistillPrinciplesInput={...input,signals:chosen.slice(0,PRINCIPLE_INPUT_LIMITS.signals),
    currentPrinciples:input.currentPrinciples.slice(0,PRINCIPLE_INPUT_LIMITS.standingContext),currentEntries:input.currentEntries.slice(0,PRINCIPLE_INPUT_LIMITS.entries)};
  while(renderPrincipleDistillContext(selected).length>PRINCIPLE_INPUT_LIMITS.characters){
    if(selected.signals.length>3)selected.signals.pop();
    else if(selected.currentPrinciples.length)selected.currentPrinciples.pop();
    else if(selected.currentEntries.length)selected.currentEntries.pop();
    else throw new Error('Principle evidence cannot fit the input budget without rewriting its words');
  }
  return selected;
}
