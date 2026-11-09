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

/* ONE DONE, ONE LIVE WORD (review, 2026-11-09). Read off the stylesheets,
   which share one cascade layer, so specificity decides: the chat's
   `.chat-page button` reset (0,1,1) restyled Done in a chat only, and the
   bar's tool sizing (0,3,0) took the live recording word's width away. */
const specificity = (selector: string): number => {
  const bare = selector.replace(/:(?:is|where|not|has)\([^)]*\)/g, (m) => (m.startsWith(':where') ? '' : ` ${m.slice(m.indexOf('(') + 1, -1).split(',').map(s => s.trim()).sort((a, b) => specificity(b) - specificity(a))[0] ?? ''}`));
  const ids = (bare.match(/#[\w-]+/g) ?? []).length;
  const classes = (bare.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (bare.replace(/[.#][\w-]+|\[[^\]]+\]|:+[\w-]+/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) ?? []).length;
  return ids * 10000 + classes * 100 + types;
};
const strongest = (css: string, subject: RegExp, property: string): number => {
  let best = -1;
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!new RegExp(`(^|;|\\s)${property}\\s*:`).test(rule[2]!)) continue;
    for (const selector of rule[1]!.split(',')) if (subject.test(selector.trim())) best = Math.max(best, specificity(selector.trim()));
  }
  return best;
};

it('styles Done the same in a chat as on the notepad', () => {
  const css = read('src', 'styles', 'chat.css') + read('src', 'styles', 'claims.css');
  const reset = specificity('.chat-page button');
  /* Only rules that reach a chat's Done: unscoped, or scoped to the chat. */
  const inChat = /^(?:\.chat-page\s+)?\.waka-listening-done(?::is\([^)]*\))?$/;
  expect(strongest(css, inChat, 'color'), 'the chat\'s button reset outranks Done\'s colour').toBeGreaterThan(reset);
  expect(strongest(css, inChat, 'font-size'), 'the chat\'s button reset outranks Done\'s size').toBeGreaterThan(reset);
});

it('lets the live recording word keep its width inside the note bar', () => {
  const css = read('src', 'styles', 'claims.css');
  const sizing = strongest(css, /\.waka-note-bar-tools \.waka-dock-tool$/, 'width');
  expect(strongest(css, /\.waka-dock-tool--live$/, 'width'), 'the bar\'s tool size outranks the live word').toBeGreaterThan(sizing);
});
