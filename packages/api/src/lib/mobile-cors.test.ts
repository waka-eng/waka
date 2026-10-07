/** Real Hono middleware and requests; no database/network/native bridge. */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { mobileCors } from './mobile-cors.js';
const app = new Hono();
app.use('/api/*', mobileCors);
app.get('/api/test', c => c.json({ authorization: c.req.header('Authorization') ?? null }));
describe('native WebView CORS without cookie authentication', () => {
  it.each(['capacitor://localhost', 'https://localhost'])('allows the exact native origin %s', async origin => {
    const response = await app.request('/api/test', { headers: { Origin: origin, Authorization: 'Bearer fixture' } });
    expect(response.status).toBe(200); expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
  });
  it.each(['https://evil.test', 'https://localhost:443', 'http://localhost', 'capacitor://other'])('does not grant CORS to %s', async origin => {
    const response = await app.request('/api/test', { headers: { Origin: origin } });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
  it('handles allowed bearer/JSON/idempotency preflights', async () => {
    const response = await app.request('/api/test', { method: 'OPTIONS', headers: { Origin: 'https://localhost',
      'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization, Content-Type, Idempotency-Key' } });
    expect(response.status).toBe(204); expect(response.headers.get('Vary')).toContain('Origin');
  });
  it('refuses unexpected methods, headers and native cookies', async () => {
    const invalid: Record<string, string>[] = [ { 'Access-Control-Request-Method': 'TRACE' }, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Other' } ];
    for (const headers of invalid) {
      expect((await app.request('/api/test', { method: 'OPTIONS', headers: { Origin: 'https://localhost', ...headers } })).status).toBe(403);
    }
    expect((await app.request('/api/test', { headers: { Origin: 'https://localhost', Cookie: 'waka_session=fixture' } })).status).toBe(403);
  });
  it('leaves ordinary web requests untouched', async () => {
    const response = await app.request('/api/test', { headers: { Cookie: 'waka_session=fixture' } });
    expect(response.status).toBe(200); expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
