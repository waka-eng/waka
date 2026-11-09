/**
 * ONE LIST OF IMAGE-WORDS STATUSES, AND NO DEAD SEAMS (code review,
 * 2026-11-08). The statuses were written out three times (the API client's
 * validator, the hook's KNOWN set, the ReadWords union) and could drift; an
 * always-null `keptConnection` seam, a constant `listTopRequest` prop and a
 * bare `corrected` alias were dead weight.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads source off disk and
 * the exported list.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { IMAGE_WORDS_STATUSES } from '../src/lib/api/attachments';

const read = (...path: string[]) => readFileSync(join(...path), 'utf8');

it('says the image-words statuses once, and the hook and the quote derive from it', () => {
  expect(IMAGE_WORDS_STATUSES).toEqual(['reading', 'ready', 'unreadable', 'retrying', 'unknown']);
  expect(read('src', 'lib', 'use-image-words.ts')).not.toMatch(/new Set\(\['reading'/);
  expect(read('src', 'components', 'ImageWords.tsx')).not.toMatch(/status: 'reading' \| 'ready'/);
});

it('keeps no always-null seam, constant prop or bare alias', () => {
  const home = read('src', 'pages', 'Home.tsx');
  expect(home).not.toContain('keptConnection');
  expect(home).not.toContain('listTopRequest');
  expect(read('..', 'api', 'src', 'lib', 'attachment-material.ts')).not.toMatch(/const corrected = correctedAttachment/);
});
