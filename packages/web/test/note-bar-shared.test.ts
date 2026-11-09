/**
 * ONE NOTE BAR, TWO PLACES (founder, 2026-11-08): "make this bottom for
 * chatting feel EXACTLY like [the notepad's note bar]. use the same code so it
 * looks identical." The notepad and a chat render the same `NoteBar`, the same
 * photo/file pair (`NoteBarAttach`) and the same listening view, and no
 * stylesheet keeps a second copy of the bar's look.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads source off disk.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const read = (...path: string[]) => readFileSync(join(...path), 'utf8');

it('renders the same note bar, attach pair and listening view in the notepad and in a chat', () => {
  for (const file of ['InspirationComposer.tsx', 'ConversationPanel.tsx']) {
    const source = read('src', 'components', file);
    expect(source, `${file} does not import the shared note bar`).toMatch(/import \{\s*NoteBar,\s*NoteBarAttach\s*\} from ['"]\.\/NoteBar['"]/);
    expect(source, `${file} does not render the note bar`).toMatch(/<NoteBar\b/);
    expect(source, `${file} does not attach through the shared pair`).toMatch(/<NoteBarAttach\b/);
    expect(source, `${file} does not listen through the shared view`).toMatch(/<ListeningView\b/);
  }
});

it('keeps one look for the bar: no chat-only copy of its field or box', () => {
  const chat = read('src', 'styles', 'chat.css');
  expect(chat, 'chat.css styles the note bar on its own').not.toMatch(/\.waka-note-bar/);
  expect(read('src', 'components', 'ConversationPanel.tsx'), 'the chat dresses the bar in its old box').not.toMatch(/<NoteBar[^>]*className="chat-composer-body"/);
});
