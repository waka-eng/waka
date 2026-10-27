import { describe, expect, it } from 'vitest';
import { getDefaultModelProvider } from '../src/lib/model-provider.js';
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
