import { describe, expect, it } from 'vitest';
import type { TopOfMindReviewInput, TopOfMindReviewResult } from '../src/lib/model-provider.js';
import type { TopOfMindSynthesisEntry } from '../src/lib/model-provider.js';
import { approveReadingReview } from './helpers/top-of-mind-review.js';
import { buildTopOfMindComparisonRequest, applyTopOfMindComparison } from '../src/queue/gemini.js';
import { callOpenRouter, OPENROUTER_GENERATION_MODEL, OPENROUTER_TOP_OF_MIND_MODEL } from '../src/lib/openrouter-http.js';
import { toChatRequest } from '../src/lib/openrouter-model-provider.js';
import { getDefaultModelProvider } from '../src/lib/model-provider.js';
import { topOfMindNoveltyCases } from './helpers/top-of-mind-novelty-cases.js';
import { reviewReadingEntries, type TopOfMindQualityContext } from '../src/lib/top-of-mind-quality.js';

// Synthetic material only. Opt in to real, paid provider calls; no database.
const live = process.env.WAKA_RUN_LIVE_EVALS === '1' && Boolean(process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY);
const context: TopOfMindQualityContext = {
  locale: 'en-US',
  signalOrigins: new Map([['save', ['a']], ['close', ['b']], ['solo', ['c']], ['team', ['d']], ['coffee', ['e']]]),
  sourceTexts: new Map([
    ['a', ['I watched a first-time visitor hesitate because the Save control was hidden in a menu.']],
    ['b', ['In another test, a person expected Close to return them to the page they had just left.']],
    ['c', ['I get my best work done alone without interruptions.']],
    ['d', ['This week I got unstuck much faster by talking through a problem with my team.']],
    ['e', ['I tried a new coffee blend this morning and liked its chocolate taste.']],
  ]),
};
const ui = ['save', 'close'];

describe.skipIf(!live)('live Top of Mind publication review', () => {
  it('accepts supported connections and rejects wrong languages, invented conclusions, decorative citations and contradictions', async () => {
    const cases = [
      { body: 'You are noticing how clear controls and predictable navigation can reduce hesitation during a capture.', citedSignalIds: ui, accepted: true },
      { body: 'Vous cherchez des chemins plus clairs pour enregistrer vos idées.', citedSignalIds: ui, accepted: false },
      { body: 'Estás explorando cómo una navegación más clara ayuda a guardar ideas.', citedSignalIds: ui, accepted: false },
      { body: 'You enjoy climbing mountains and camping alone.', citedSignalIds: ui, accepted: false },
      { body: 'The save control was hard to locate in the first test.', citedSignalIds: ui, accepted: false },
      { body: 'Your fear of failure makes you obsessively redesign every interface.', citedSignalIds: ui, accepted: false },
      { body: 'Clear controls and predictable navigation may help people complete a capture.', prompt: 'Que souhaitez-vous essayer ensuite?', citedSignalIds: ui, accepted: false },
      { body: 'You noticed a hidden save button and enjoyed chocolate-tasting coffee.', citedSignalIds: ['save', 'coffee'], accepted: false },
      { body: 'You do your best work only when you are alone, so collaboration is unhelpful.', citedSignalIds: ['solo', 'team'], accepted: false },
      { body: 'You are weighing uninterrupted individual work against the benefit of talking through problems together.', citedSignalIds: ['solo', 'team'], accepted: true },
    ];
    const approved = await reviewReadingEntries(cases, context, await getDefaultModelProvider());
    expect(cases.map((entry, index) => ({ body: entry.body, accepted: approved.has(index) })))
      .toEqual(cases.map(entry => ({ body: entry.body, accepted: entry.accepted })));
  }, 90_000);

  it('recognizes Korean prose with product names, mixed-language failures and optional fields', async () => {
    const cases = [
      { body: '명확한 버튼과 예측 가능한 이동 방식이 사람들이 기록할 때 느끼는 망설임을 줄이는 데 도움이 될 수 있어요.', accepted: true },
      { body: 'Clear controls and predictable navigation help people complete a capture. 명확해요.', accepted: false },
      { body: 'Save 버튼과 Close 동작을 살피면서 사람들이 기록하는 흐름을 더 쉽게 만드는 방법에 주목하고 있어요.', prompt: '어떤 작은 변화를 시도해 볼까요?', accepted: true },
      { body: '명확한 버튼과 예측 가능한 이동 방식이 기록을 돕는다는 점에 주목하고 있어요.', prompt: 'What would you try next?', accepted: false },
    ].map(entry => ({ ...entry, citedSignalIds: ui }));
    const approved = await reviewReadingEntries(cases, { ...context, locale: 'ko-KR' }, await getDefaultModelProvider());
    expect(cases.map((_, index) => approved.has(index))).toEqual(cases.map(entry => entry.accepted));
  }, 90_000);
});

const comparisonLive = process.env.WAKA_RUN_LIVE_EVALS === '1' && Boolean(process.env.OPENROUTER_API_KEY);

// Test-only override: quality and every application model keep their defaults.
const comparisonModel = process.env.WAKA_NOVELTY_EVAL_MODEL?.trim() || process.env.WAKA_MODEL_JUDGE || OPENROUTER_GENERATION_MODEL;
const effort = process.env.WAKA_NOVELTY_EVAL_REASONING?.trim() || 'low';
if (effort !== 'low' && effort !== 'medium') throw new Error('WAKA_NOVELTY_EVAL_REASONING must be low or medium');
const comparisonEffort: 'low' | 'medium' = effort;
async function compareForEvaluation(input: TopOfMindReviewInput, reviewed: TopOfMindReviewResult) {
  const terra = comparisonModel === OPENROUTER_TOP_OF_MIND_MODEL;
  const request = toChatRequest(buildTopOfMindComparisonRequest(input, reviewed),
    comparisonModel, 'top_of_mind_comparison', terra);
  if (terra) {
    request.reasoning = { effort: comparisonEffort, exclude: true };
    delete request.temperature;
  }
  const payload = await callOpenRouter(request, 'top-of-mind comparison');
  return applyTopOfMindComparison(input, reviewed, payload);
}

// Independent boundary controls. The original corpus and labels above remain
// untouched, including its disputed causal/source and action-detail cases.
const observation: TopOfMindSynthesisEntry = { type: 'pattern', citedSignalIds: ui,
  body: 'Finding Save and anticipating where Close will lead connect as two parts of navigating an interface.' };
const reworded = { ...observation, body: 'Locating the Save control and predicting the destination of Close are connected aspects of interface navigation.' };
const repeated = { ...observation, body: 'Finding Save and anticipating the destination of Close are linked parts of navigating an interface.' };
const boundaries = [
  { name:'grounded-merge', proposed:[observation], current:[reworded,repeated], changed:false },
  { name:'grounded-split', proposed:[reworded,repeated], current:[observation], changed:false },
  { name:'exact-duplicate-after-leading-paraphrase', proposed:[observation], current:[reworded,observation], changed:false },
  { name:'action-detail-lost', proposed:[{...observation,body:'You observed interface navigation.'}], current:[observation], changed:true },
  { name:'action-changed', proposed:[{...observation,body:'Finding Save and deleting the current note connect as two parts of navigating an interface.'}], current:[observation], changed:true },
  { name:'unsupported-belief-added', proposed:[{...observation,belief:'These interface choices may recover suppressed memories.'}], current:[observation], changed:true },
  { name:'question-added', proposed:[{...observation,prompt:'Which control will you test next?'}], current:[observation], changed:true },
  { name:'time-scope-added', proposed:[{...observation,body:'Only this week, finding Save and anticipating where Close will lead connect as two parts of navigating an interface.'}], current:[observation], changed:true },
];

describe.skipIf(!comparisonLive)('live novelty boundary controls', () => {
  it.each(boundaries.flatMap(fixture => (fixture.changed ? ['comparison-only'] : ['comparison-only','quality-and-comparison'])
    .map(mode => ({ ...fixture, mode }))))('$name ($mode)', async fixture => {
    const entries = [...fixture.proposed,...fixture.current];
    const provider = fixture.mode === 'quality-and-comparison' ? await getDefaultModelProvider() : undefined;
    let changed: boolean | undefined;
    let quality: TopOfMindReviewResult | undefined;
    let compared: TopOfMindReviewResult | undefined;
    const approved = await reviewReadingEntries(entries,context,{ reviewTopOfMind:async input => {
      quality = provider ? await provider.reviewTopOfMind({...input,comparison:undefined}) : await approveReadingReview(input);
      compared = await compareForEvaluation(input,quality);
      return compared;
    } },undefined,{ proposedCount:fixture.proposed.length,onCompared:value=>{changed=value;} });
    console.log('[novelty-boundary-eval]',JSON.stringify({ name:fixture.name,mode:fixture.mode,comparisonModel,comparisonEffort,
      expected:fixture.changed,changed,approved:[...approved],quality,compared }));
    expect(changed).toBe(fixture.changed);
    expect([...approved]).toEqual(entries.map((_,index)=>index));
  },90_000);

  it.each(['en-US','ko-KR'] as const)('allows a supported abstraction but rejects unsupported claims and wrong languages (%s)',async locale=>{
    const valid = locale === 'en-US' ? observation : {...observation,
      body:'Save 버튼을 찾는 일과 Close 뒤에 어느 화면으로 갈지 예상하는 일이 화면을 이동하는 두 측면으로 연결돼요.'};
    const entries = locale === 'en-US' ? [valid,
      {...valid,belief:'Clearer controls might help visitors recover suppressed memories.'},
      {...valid,body:'You consistently avoid complex interfaces because you fear failure.'},
      {...valid,body:'A hidden Save control can make a visitor hesitate.'},
      {...valid,body:'Clear controls and predictable navigation will eliminate hesitation for every visitor.'},
      {...valid,body:'Vous observez comment trouver Save et prévoir où Close mène sont liés dans la navigation.'},
      {...valid,prompt:'Que souhaitez-vous examiner ensuite?'},
    ] : [valid,
      {...valid,belief:'이런 인터페이스는 억압된 기억을 되살리는 데 도움이 될 수 있어요.'},
      {...valid,body:'실패가 두려워 늘 복잡한 인터페이스를 피하고 있어요.'},
      {...valid,body:'숨겨진 Save 버튼 때문에 방문자가 망설일 수 있어요.'},
      {...valid,body:'명확한 버튼과 예측 가능한 이동은 모든 방문자의 망설임을 없애 줄 거예요.'},
      observation,
      {...valid,prompt:'Which control would you examine next?'},
    ];
    const approved = await reviewReadingEntries(entries,{...context,locale},await getDefaultModelProvider());
    console.log('[novelty-source-boundary-eval]',JSON.stringify({locale,approved:[...approved],expected:[0]}));
    expect([...approved]).toEqual([0]);
  },90_000);
});

describe.skipIf(!comparisonLive)('live Top of Mind novelty review', () => {
  it.each(['comparison-only', 'quality-and-comparison'] as const)('rechecks merged repetition (%s)', async mode => {
    const fixture = topOfMindNoveltyCases().find(row => row.name === 'same-idea-merged')!;
    const entries = [...fixture.proposed, ...fixture.current];
    const qualityProvider = mode === 'quality-and-comparison' ? await getDefaultModelProvider() : undefined;
    let changed: boolean | undefined;
    let quality: TopOfMindReviewResult | undefined;
    let compared: TopOfMindReviewResult | undefined;
    const approved = await reviewReadingEntries(entries, context, { reviewTopOfMind: async input => {
      quality = qualityProvider ? await qualityProvider.reviewTopOfMind({ ...input, comparison: undefined }) : await approveReadingReview(input);
      compared = await compareForEvaluation(input, quality);
      return compared;
    } }, undefined, { proposedCount: fixture.proposed.length, onCompared: value => { changed = value; } });
    const expectedIndices = entries.map((_, index) => index);
    console.log('[merged-repetition-recheck]', JSON.stringify({ mode, comparisonModel, comparisonEffort,
      qualityModel: qualityProvider ? process.env.WAKA_MODEL_TOP_OF_MIND_REVIEW || OPENROUTER_TOP_OF_MIND_MODEL : 'scripted',
      expected: fixture.changed, changed, approved: [...approved], expectedIndices, quality, compared }));
    expect(changed).toBe(fixture.changed);
    expect([...approved]).toEqual(expectedIndices);
  }, 90_000);

  it('measures semantic coverage independently of source-quality decisions', async () => {
    console.log('[top-of-mind-model-eval]', JSON.stringify({ comparisonModel, qualityModel: process.env.WAKA_MODEL_TOP_OF_MIND_REVIEW || OPENROUTER_TOP_OF_MIND_MODEL }));
    const results = [];
    for (const fixture of topOfMindNoveltyCases()) {
      const entries = [...fixture.proposed, ...fixture.current];
      const input: TopOfMindReviewInput = { preferredLocale: fixture.korean ? 'ko-KR' : 'en-US',
        comparison: { proposedCount: fixture.proposed.length }, inspirations: [],
        entries: entries.map(entry => ({ ...entry, inspirationIds: [...new Set(entry.citedSignalIds.flatMap(id => context.signalOrigins.get(id) ?? []))] })),
      };
      const reviewed = await approveReadingReview(input);
      for (const index of fixture.rejected ?? []) reviewed.entries[index]!.grounded = false;
      let changed: boolean | undefined;
      let approved = new Set<number>();
      let error: string | undefined;
      try {
        const compared = await compareForEvaluation(input, reviewed);
        approved = await reviewReadingEntries(entries, { ...context, locale: input.preferredLocale },
          { reviewTopOfMind: async () => compared }, undefined,
          { proposedCount: fixture.proposed.length, onCompared: value => { changed = value; } });
        console.log('[top-of-mind-coverage-eval]', JSON.stringify({ name: fixture.name,
          coverage: compared.entries.map(row => ({ index: row.index, coveredBy: row.coveredByIndices, byLeading: row.coveredByLeadingEntry })) }));
      } catch {
        error = 'comparison_failed';
      }
      const expectedIndices = entries.map((_, i) => i).filter(i => !fixture.rejected?.includes(i));
      const result = { model: comparisonModel, name: fixture.name, expected: fixture.changed, changed, approved: [...approved], expectedIndices, error };
      results.push(result);
      console.log('[top-of-mind-novelty-eval]', JSON.stringify(result));
    }
    const original = results.filter(row => row.name !== 'same-idea-merged');
    expect(original.filter(row => row.changed === row.expected).length / original.length).toBeGreaterThanOrEqual(0.85);
    expect(results.filter(row => !row.expected && row.changed)).toEqual([]);
    for (const name of ['same-idea-merged', 'new-question', 'changed-time-scope']) {
      const result = results.find(row => row.name === name)!;
      expect({ name, changed: result.changed }).toEqual({ name, changed: result.expected });
    }
    expect(results.filter(row => row.error)).toEqual([]);
    expect(results.map(row => ({ name: row.name, indices: row.approved })))
      .toEqual(results.map(row => ({ name: row.name, indices: row.expectedIndices })));
  }, 240_000);

  it('checks quality and coverage together for rewording, a changed question and merged repetition', async () => {
    const qualityProvider = await getDefaultModelProvider();
    const provider = { reviewTopOfMind: async (input: TopOfMindReviewInput) => {
      const reviewed = await qualityProvider.reviewTopOfMind({ ...input, comparison: undefined });
      return compareForEvaluation(input, reviewed);
    } };
    const results = [];
    for (const fixture of topOfMindNoveltyCases().filter(row => ['english-paraphrase', 'new-question', 'same-idea-merged'].includes(row.name))) {
      const entries = [...fixture.proposed, ...fixture.current];
      let changed: boolean | undefined;
      let approved = new Set<number>();
      let error: string | undefined;
      try {
        approved = await reviewReadingEntries(entries, context, provider, undefined,
          { proposedCount: fixture.proposed.length, onCompared: value => { changed = value; } });
      } catch {
        error = 'comparison_failed';
      }
      const result = { model: comparisonModel, name: fixture.name, changed, approved: [...approved],
        expected: fixture.changed, expectedIndices: entries.map((_, i) => i), error };
      results.push(result);
      console.log('[top-of-mind-novelty-integration]', JSON.stringify(result));
    }
    expect(results.map(row => ({ name: row.name, changed: row.changed, approved: row.approved, error: row.error })))
      .toEqual(results.map(row => ({ name: row.name, changed: row.expected, approved: row.expectedIndices, error: undefined })));
  }, 120_000);
});
