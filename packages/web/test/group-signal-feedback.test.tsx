// @vitest-environment jsdom
/** Real component with fixture API rows. WHAT THIS MOCKS, AND WHY (gate G6):
 * nothing below the component is replaced. onSubmit/onRefresh callback props
 * are spies/controlled promises because the
 * page owns network and snapshot loading; this suite proves UI request scope,
 * acknowledgment timing and cancellation, not server authorization. */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupSignalFeedback, type GroupSignalFeedbackProps } from '../src/space-kinds/GroupSignalFeedback';

let root: Root | null = null, host: HTMLElement | null = null;
const signal = { signalId: 'signal-id', statement: 'Small experiments make room for learning.', statementRevision: '3',
  confidenceAsWritten: 0.5, locked: false, contributors: [{ profileId: 'viewer', name: 'You' }, { profileId: 'other', name: 'Bo' }],
  sharedAt: '2026-10-01T00:00:00Z', reactions: [] };
const defaults = (): GroupSignalFeedbackProps => ({ groupId: 'group-a', viewerProfileId: 'viewer', signals: [signal],
  locale: 'en-US', onSubmit: vi.fn(async () => {}), onRefresh: vi.fn(async () => true) });
function render(props: GroupSignalFeedbackProps) {
  if (!host) { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); }
  act(() => root!.render(<GroupSignalFeedback {...props} />)); return host;
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

it('replies to the statement ID/revision, and confirms only after its write succeeds', async () => {
  let resolve!: () => void;
  const gate = new Promise<void>((done) => { resolve = done; });
  const props = { ...defaults(), onSubmit: vi.fn(() => gate) }, el = render(props);
  act(() => { el.querySelector('button')!.click(); el.querySelector('button')!.click(); });
  expect(props.onSubmit).toHaveBeenCalledOnce();
  expect(props.onSubmit).toHaveBeenCalledWith('signal-id', 'true', '3');
  expect(el.textContent).not.toContain('Your reply is saved.');
  await act(async () => { resolve(); await gate; });
  expect(el.textContent).toContain('Your reply is saved.');
  expect(el.querySelector('button')!.getAttribute('aria-pressed')).toBe('true');
});

it('does not turn a failed post-save reload into an ambiguous write', async () => {
  const props = { ...defaults(), onRefresh: vi.fn(async () => { throw new Error('Read failed'); }) }, el = render(props);
  await act(async () => el.querySelector('button')!.click());
  expect(el.textContent).toContain('Your reply is saved.');
  expect(el.textContent).not.toContain("Couldn't confirm");
});

it('rechecks stale wording without automatically submitting another verdict', async () => {
  const props = { ...defaults(), onSubmit: vi.fn(async () => { throw { code: 'feedback_target_changed' }; }) }, el = render(props);
  await act(async () => el.querySelector('button')!.click());
  expect(el.textContent).toContain('This wording changed.');
  expect(props.onSubmit).toHaveBeenCalledOnce(); expect(props.onRefresh).toHaveBeenCalledOnce();
});

it.each(['wording', 'account', 'group'])('ignores a delayed write after %s changes', async (change) => {
  let resolve!: () => void;
  const gate = new Promise<void>((done) => { resolve = done; });
  const props = { ...defaults(), onSubmit: vi.fn(() => gate) }, el = render(props);
  act(() => el.querySelector('button')!.click());
  render({ ...props, ...(change === 'wording' ? { signals: [{ ...signal, statementRevision: '4', statement: 'New words' }] }
    : change === 'account' ? { viewerProfileId: 'someone-else' } : { groupId: 'group-b' }) });
  await act(async () => { resolve(); await gate; });
  expect(el.textContent).not.toContain('Your reply is saved.');
  expect(el.querySelector('button')!.getAttribute('aria-pressed')).toBe('false');
  expect(props.onRefresh).not.toHaveBeenCalled();
});
