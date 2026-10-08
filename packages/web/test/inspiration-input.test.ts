/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Run the shipped URL detector,
 * canonical deduplication and removal against authored text. */
import { expect, it } from 'vitest';
import { inspirationInputMedia, inspirationLinks, inspirationWithPendingLink, removeInspirationLink } from '../src/lib/inspiration-input';
it('detects mixed-case URLs, strips surrounding punctuation and keeps balanced parentheses', () => {
  const links = inspirationLinks('See (HTTPS://Example.test/a). Also https://example.test/Foo_(bar)');
  expect(links.map(row => row.url)).toEqual(['https://example.test/a', 'https://example.test/Foo_(bar)']);
});
it('keeps only one canonical link across typed and explicit attachments', () => {
  expect(inspirationLinks('https://example.test HTTPS://EXAMPLE.test/')).toHaveLength(1);
  const items = inspirationInputMedia('HTTPS://EXAMPLE.test/', [{ id: 'link', type: 'link', name: 'Saved', url: 'https://example.test' }]);
  expect(items).toHaveLength(1); expect(items[0]?.id).toBe('link');
});
it('removes all equivalent typed occurrences without changing other prose or links', () => {
  expect(removeInspirationLink('One https://example.test and (HTTPS://EXAMPLE.test/). Keep https://other.test/x', 'https://example.test/'))
    .toBe('One  and (). Keep https://other.test/x');
});
it('does not turn unsupported schemes into preview requests', () => {
  expect(inspirationLinks('file:///secret ftp://example.test javascript:alert(1)')).toEqual([]);
});

it('combines the visible link draft exactly once without silently dropping invalid input',()=>{
  expect(inspirationWithPendingLink('My note','HTTPS://EXAMPLE.test/')).toBe('My note\nhttps://example.test/');
  expect(inspirationWithPendingLink('See https://example.test/','HTTPS://EXAMPLE.test')).toBe('See https://example.test/');
  expect(inspirationWithPendingLink('','https://example.test/')).toBe('https://example.test/');
  for(const url of ['javascript:alert(1)','file:///private','not a URL'])expect(()=>inspirationWithPendingLink('My words',url)).toThrow('invalid_link');
});
