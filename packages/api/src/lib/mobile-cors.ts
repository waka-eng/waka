import type { MiddlewareHandler } from 'hono';

const origins = new Set(['capacitor://localhost', 'https://localhost']);
const methods = new Set(['GET', 'POST', 'PATCH', 'DELETE', 'PUT']);
const allowedHeaders = new Set(['accept', 'content-type', 'authorization', 'idempotency-key']);

/** Native WebViews use bearer sessions. Never enable cross-origin cookies. */
export const mobileCors: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('Origin');
  if (!origin || !origins.has(origin) || !c.req.path.startsWith('/api/')) return next();
  if (c.req.method === 'OPTIONS') {
    const method = c.req.header('Access-Control-Request-Method') ?? '';
    const headers = (c.req.header('Access-Control-Request-Headers') ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
    if (!methods.has(method) || headers.some(header => !allowedHeaders.has(header))) return c.body(null, 403);
    c.header('Access-Control-Allow-Methods', [...methods].join(', '));
    c.header('Access-Control-Allow-Headers', [...allowedHeaders].join(', '));
    c.header('Access-Control-Max-Age', '600');
  } else {
    // Cookies must not authorize a cross-origin native-origin request.
    // Authentication endpoints can still issue a new bearer token.
    if (c.req.header('Cookie')) return c.json({ error: 'Native requests must use a bearer session' }, 403);
    await next();
  }
  c.header('Access-Control-Allow-Origin', origin);
  c.header('Vary', 'Authorization, Cookie, Origin');
  if (c.req.method === 'OPTIONS') return c.body(null, 204);
};
