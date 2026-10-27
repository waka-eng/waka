/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Opens the rendered header menu. */
import { act } from 'react';
export async function openNoteActions(root: ParentNode = document): Promise<void> {
  const button = root.querySelector<HTMLButtonElement>('.jar-note-actions-trigger');
  if (!button) throw new Error('Note actions are missing');
  if (button.getAttribute('aria-expanded') !== 'true') await act(async () => button.click());
}
