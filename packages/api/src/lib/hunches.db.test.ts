/** A HUNCH FROM THE FIRST SAVES (insight goal, phase 3, 2026-11-26).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): the model provider's `writeHunch` (the
 * one outside call) and the route's `authMiddleware` (a fixture owner) and
 * `affirm` (the feedback write, which has its own suite). Writing, replacing,
 * skipping, the answer endpoint, the queued follow-up and the trigger that
 * forgets a hunch with its save all run on real disposable SQL. */
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { loadHunchInput, readCurrentHunch, writeHunchForProfile } from './hunches.js';
import { createHunchRoutes } from '../routes/hunches.js';
import type { AuthEnv } from './middleware.js';
import type { HunchInput } from './model-provider.js';

let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });

async function person(locale = 'en-US') {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`hunch-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name,preferred_locale) VALUES (${account.id},'human','Reader',${locale}) RETURNING id`;
  return { accountId: account.id as string, profileId: profile.id as string };
}
async function save(profileId: string, text: string, prompt: string | null = null, at = new Date()) {
  const [row] = await t.sql`INSERT INTO inspirations(profile_id,text,prompt,created_at) VALUES (${profileId},${text},${prompt},${at.toISOString()}::timestamptz) RETURNING id`;
  return row.id as string;
}
const writer = (hunch: string, pick: (input: HunchInput) => string[] = input => [input.saves[0]!.id]) =>
  ({ writeHunch: vi.fn(async (input: HunchInput) => ({ hunch, inspirationIds: pick(input) })) });

describe('writing a hunch', () => {
  it('reads the newest saves with their questions, and writes one pending hunch citing them', async () => {
    const p = await person();
    const quit = await save(p.profileId, 'I want to quit my job.', 'Tell me about a conversation you keep thinking about', new Date(Date.now() - 1000));
    const walk = await save(p.profileId, 'Walked home the long way to hear the river.');
    const input = await loadHunchInput(t.db as never, p.profileId);
    expect(input?.saves.map(row => row.id)).toEqual([walk, quit]);
    expect(input?.saves[1]?.prompt).toBe('Tell me about a conversation you keep thinking about');
    const provider = writer('You keep choosing the slow way out of places that hold you. Am I close?', i => i.saves.map(s => s.id));
    expect(await writeHunchForProfile(t.db as never, provider, { profileId: p.profileId, newestId: walk })).toBe('written');
    expect(await readCurrentHunch(t.db as never, p.profileId)).toMatchObject({ body: expect.stringContaining('Am I close?'), status: 'pending' });
  });

  it('replaces the pending hunch, and drops a job a newer save has overtaken', async () => {
    const p = await person();
    const first = await save(p.profileId, 'One thing.', null, new Date(Date.now() - 1000));
    await writeHunchForProfile(t.db as never, writer('About the one thing you saved. Am I close?'), { profileId: p.profileId, newestId: first });
    const second = await save(p.profileId, 'Another thing.');
    expect(await writeHunchForProfile(t.db as never, writer('Stale. Am I close?'), { profileId: p.profileId, newestId: first })).toBe('skipped');
    await writeHunchForProfile(t.db as never, writer('Two things now, both about leaving. Am I close?'), { profileId: p.profileId, newestId: second });
    const rows = await t.sql`SELECT body, status FROM hunches WHERE profile_id=${p.profileId} ORDER BY created_at`;
    expect(rows.map(row => row.status)).toEqual(['replaced', 'pending']);
  });

  it('writes nothing once a reading is live', async () => {
    const p = await person();
    const id = await save(p.profileId, 'A thing.');
    await t.sql`INSERT INTO top_of_minds(profile_id,version,status,reason) VALUES (${p.profileId},1,'live','initial')`;
    const provider = writer('Never. Am I close?');
    expect(await writeHunchForProfile(t.db as never, provider, { profileId: p.profileId, newestId: id })).toBe('skipped');
    expect(provider.writeHunch).not.toHaveBeenCalled();
    expect(await readCurrentHunch(t.db as never, p.profileId)).toBeNull();
  });

  it('forgets a hunch when a save it cites is deleted or its words change', async () => {
    const p = await person();
    const id = await save(p.profileId, 'A thing.');
    await writeHunchForProfile(t.db as never, writer('About a thing. Am I close?'), { profileId: p.profileId });
    await t.sql`UPDATE inspirations SET text='Other words' WHERE id=${id}`;
    expect(await t.sql`SELECT id FROM hunches`).toHaveLength(0);
    await writeHunchForProfile(t.db as never, writer('About other words. Am I close?'), { profileId: p.profileId });
    await t.sql`DELETE FROM inspirations WHERE id=${id}`;
    expect(await t.sql`SELECT id FROM hunches`).toHaveLength(0);
  });
});

describe('answering a hunch', () => {
  async function routed(p: Awaited<ReturnType<typeof person>>) {
    const affirm = vi.fn(async () => null);
    const routes = new Hono<AuthEnv>();
    routes.route('/', createHunchRoutes({ getDatabase: () => t.db as never, affirm: affirm as never,
      authMiddleware: async (c, next) => { c.set('session', { sessionId: randomUUID(), account: { id: p.accountId, email: 'x@example.test' },
        profile: { id: p.profileId, accountId: p.accountId, type: 'human', name: 'Reader', preferredLocale: 'en-US' } } as never); await next(); } }));
    const current = async () => ((await (await routes.request('/')).json()) as { hunch: { id: string; body: string } | null }).hunch;
    return { routes, affirm, current, answer: (id: string, body: unknown) => routes.request(`/${id}/answer`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) };
  }

  it('Yes affirms it, affirms the signals behind its saves, and asks for the reading at once', async () => {
    const p = await person(); const r = await routed(p);
    const id = await save(p.profileId, 'A thing.');
    const [signal] = await t.sql`INSERT INTO signals(profile_id,statement,status) VALUES (${p.profileId},'A pattern','emerging') RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES (${p.profileId},${p.profileId},${signal.id},${id})`;
    await writeHunchForProfile(t.db as never, writer('About a thing. Am I close?'), { profileId: p.profileId });
    const hunch = (await r.current())!;
    expect(hunch.body).toBe('About a thing. Am I close?');
    expect((await r.answer(hunch.id, { answer: 'yes' })).status).toBe(200);
    expect((await t.sql`SELECT status FROM hunches WHERE id=${hunch.id}`)[0]!.status).toBe('affirmed');
    expect(r.affirm).toHaveBeenCalledWith(expect.anything(), { profileId: p.profileId, targetType: 'signal', targetId: signal.id, value: 'true' });
    expect(await t.sql`SELECT id FROM background_jobs WHERE type='refresh_top_of_mind' AND profile_id=${p.profileId}`).toHaveLength(1);
    expect(await r.current(), 'an answered hunch is still said').toBeNull();
    expect((await r.answer(hunch.id, { answer: 'yes' })).status, 'a hunch answered twice').toBe(409);
  });

  it('Not quite keeps what was said instead, and asks for a new hunch that must honour it', async () => {
    const p = await person(); const r = await routed(p);
    await save(p.profileId, 'A thing.');
    await writeHunchForProfile(t.db as never, writer('About leaving. Am I close?'), { profileId: p.profileId });
    const hunch = (await r.current())!;
    expect((await r.answer(hunch.id, { answer: 'not_quite' })).status, 'Not quite without words').toBe(400);
    expect((await r.answer(hunch.id, { answer: 'not_quite', correction: 'It is about room to grow.' })).status).toBe(200);
    expect(await t.sql`SELECT status, correction FROM hunches WHERE id=${hunch.id}`).toEqual([{ status: 'declined', correction: 'It is about room to grow.' }]);
    expect(await t.sql`SELECT payload FROM background_jobs WHERE type='generate_hunch' AND profile_id=${p.profileId}`).toEqual([{ payload: { afterHunchId: hunch.id } }]);
    expect((await loadHunchInput(t.db as never, p.profileId))?.declined).toEqual([{ body: 'About leaving. Am I close?', correction: 'It is about room to grow.' }]);
  });

  it("refuses another person's hunch", async () => {
    const owner = await person(), stranger = await person();
    await save(owner.profileId, 'A thing.');
    await writeHunchForProfile(t.db as never, writer('About a thing. Am I close?'), { profileId: owner.profileId });
    const [row] = await t.sql`SELECT id FROM hunches`;
    expect((await (await routed(stranger)).answer(row!.id, { answer: 'yes' })).status).toBe(409);
    expect((await t.sql`SELECT status FROM hunches`)[0]!.status).toBe('pending');
  });
});
