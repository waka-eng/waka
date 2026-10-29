import type { TopOfMindSynthesisEntry } from '../../src/lib/model-provider.js';

/** Fixed synthetic corpus. See docs/plans/top-of-mind-novelty.md for the rubric. */
export function topOfMindNoveltyCases() {
  const ui = ['save', 'close'];
    const item = (body: string, citedSignalIds = ui, prompt?: string): TopOfMindSynthesisEntry =>
      ({ type: 'pattern', body, citedSignalIds, ...(prompt ? { prompt } : {}) });
    const navigation = item('You are noticing how clear controls and predictable navigation can reduce hesitation during a capture.');
    const paraphrase = item('Clear controls and predictable navigation stand out as ways to make capturing an idea less hesitant.');
    const collaboration = item('You are weighing uninterrupted individual work against the benefit of talking through problems together.', ['solo', 'team']);
    const koreanNavigation = item('명확한 버튼과 예측 가능한 이동 방식이 기록할 때의 망설임을 줄일 수 있다는 점에 주목하고 있어요.');
    const cases: Array<{ name: string; proposed: TopOfMindSynthesisEntry[]; current: TopOfMindSynthesisEntry[];
      changed: boolean; korean?: boolean; rejected?: number[] }> = [
      { name: 'english-paraphrase', proposed: [paraphrase], current: [navigation], changed: false },
      { name: 'korean-paraphrase', proposed: [item('버튼을 명확하게 하고 이동을 예측할 수 있게 만드는 일이 기록할 때의 망설임을 줄이는 데 도움이 될 수 있음을 살피고 있어요.')], current: [koreanNavigation], changed: false, korean: true },
      { name: 'citation-order', proposed: [{ ...navigation, citedSignalIds: [...ui].reverse() }], current: [navigation], changed: false },
      { name: 'question-rephrasing', proposed: [{ ...navigation, prompt: 'How might you make the save-and-return flow more predictable?' }],
        current: [{ ...navigation, prompt: 'How could saving and returning feel more predictable?' }], changed: false },
      { name: 'same-idea-split', proposed: [paraphrase, item('Predictability across saving and returning may reduce hesitation during capture.')], current: [navigation], changed: false },
      { name: 'rejected-invention-is-not-novelty', proposed: [paraphrase, item('You enjoy climbing mountains and camping alone.')], current: [navigation], changed: false, rejected: [1] },
      { name: 'label-alone', proposed: [{ ...navigation, type: 'hypothesis' }], current: [navigation], changed: false },
      { name: 'new-supported-tension', proposed: [navigation, collaboration], current: [navigation], changed: true },
      { name: 'changed-leading-focus', proposed: [collaboration, navigation], current: [navigation, collaboration], changed: true },
      { name: 'changed-time-scope', proposed: [item('This week, talking with your team has helped you get unstuck, even while uninterrupted solo time supports your best work.', ['solo', 'team'])], current: [collaboration], changed: true },
      { name: 'new-question', proposed: [{ ...navigation, prompt: 'Which needs the next test first: finding Save or predicting where Close will lead?' }],
        current: [{ ...navigation, prompt: 'How could saving and returning feel more predictable?' }], changed: true },
      { name: 'retired-focus', proposed: [collaboration], current: [navigation, collaboration], changed: true },
      { name: 'korean-new-tension', proposed: [koreanNavigation, item('방해 없이 혼자 일할 때의 몰입과 팀과 이야기하며 막힌 문제를 푸는 이점 사이에서 균형을 찾고 있어요.', ['solo', 'team'])],
        current: [koreanNavigation], changed: true, korean: true },
      { name: 'same-idea-merged', proposed: [navigation], current: [paraphrase,
        item('Predictability across saving and returning may reduce hesitation during capture.')], changed: false },
    ];
  return cases;
}
