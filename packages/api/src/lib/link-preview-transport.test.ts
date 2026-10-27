/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. An explicitly allowlisted
 * loopback HTTP fixture exercises the real pinned connector and body read.
 * The fixture substitutes for the public image host, not for the transport. */
import { createServer } from 'node:http';
import { expect, it, vi } from 'vitest';
import { fetchLinkPreviewImage } from './signal-enrichment.js';
it('rejects excessive content encodings without crashing the worker or blocking later images', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/hostile') {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Encoding': Array(6).fill('gzip').join(', ') });
      response.end('invalid compressed bytes');
    } else {
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(Buffer.from([137, 80, 78, 71]));
    }
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture address');
  const origin = `http://localhost:${address.port}`;
  vi.stubEnv('WAKA_ENRICHMENT_ALLOWED_HOSTS', `localhost:${address.port}`);
  try {
    await expect(fetchLinkPreviewImage(`${origin}/hostile`)).rejects.toMatchObject({
      cause: { message: 'too many content-encodings in response: 6, maximum allowed is 5' },
    });
    expect((await fetchLinkPreviewImage(`${origin}/healthy`)).bytes).toEqual(new Uint8Array([137, 80, 78, 71]));
  } finally { vi.unstubAllEnvs(); await new Promise<void>(done => server.close(() => done())); }
});
it('reads a bounded image through the real localhost connector without forwarding cookies', async () => {
  const seen: Array<string | undefined> = [], bytes = Buffer.from([137, 80, 78, 71]);
  const server = createServer((request, response) => {
    seen.push(request.headers.cookie, request.headers.authorization);
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length }); response.end(bytes);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture address');
  vi.stubEnv('WAKA_ENRICHMENT_ALLOWED_HOSTS', `localhost:${address.port}`);
  try {
    const image = await fetchLinkPreviewImage(`http://localhost:${address.port}/image`);
    expect(Buffer.from(image.bytes)).toEqual(bytes); expect(seen).toEqual([undefined, undefined]);
  } finally { vi.unstubAllEnvs(); await new Promise<void>(done => server.close(() => done())); }
});
