// @vitest-environment jsdom
/**
 * WHAT EACH KEY READ, IN SETTINGS (founder, 2026-11-26, agent to agent).
 *
 * Under the keys, the reads they made, newest first, in plain words with the
 * key's own name; a revoked key says so; nothing read says that plainly.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `fetch`, which answers
 * `GET /api/mcp-reads` the way the API does. The component and the API
 * client are the shipped ones.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { McpRecentReads } from '../src/components/McpRecentReads';
import type { ApiMcpRead } from '../src/lib/api/sessions';

const profileId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let host: HTMLDivElement, root: Root, reads: ApiMcpRead[], asked: string[];
const read = (tool: ApiMcpRead['tool'], detail: string | null, revoked = false): ApiMcpRead => ({
  id: `${tool}-${detail}`, tool, detail, readAt: new Date().toISOString(),
  key: { kind: 'keeper', label: 'Claude on my laptop', prefix: 'waka_keeper_ab12', revoked },
});
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  asked = [];
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    asked.push(String(path));
    return new Response(JSON.stringify({ reads }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(<McpRecentReads locale="en-US" profileId={profileId} />)); await act(async () => { await Promise.resolve(); }); }

it('says what each key read, in plain words, with the key and whether it was revoked', async () => {
  reads = [read('principles', '3'), read('recall', 'job offer'), read('top_of_mind', null, true)];
  await mount();
  expect(asked[0]).toContain(`/mcp-reads?profile=${profileId}`);
  const rows = [...host.querySelectorAll('.waka-session-card')].map(row => row.textContent);
  expect(rows[0]).toContain('Read your 3 principles');
  expect(rows[0]).toContain('Claude on my laptop');
  expect(rows[1]).toContain('Searched for “job offer”');
  expect(rows[2]).toContain('Read what’s on your mind');
  expect(rows[2]).toContain('Revoked');
});

it('says so when nothing has been read', async () => {
  reads = [];
  await mount();
  expect(host.textContent).toContain('Nothing has been read with a key yet.');
});
