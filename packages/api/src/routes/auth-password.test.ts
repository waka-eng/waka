/** WHAT THIS MOCKS, AND WHY: database access is a refusing spy. Oversized
 * signup must fail validation before any lookup or write. Real signup handler,
 * Hono and validation are used; no live database/provider/account is involved. */
import {Hono} from 'hono';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const database=vi.hoisted(()=>vi.fn(()=>{throw new Error('Signup reached database before password validation');}));
vi.mock('../lib/db.js',()=>({getDb:database}));
import {loginHandler,signupHandler} from './auth-password.js';
const app=new Hono().post('/signup',signupHandler).post('/login',loginHandler);
beforeEach(()=>{database.mockClear();});
afterEach(()=>{vi.unstubAllEnvs();});
it.each(['a'.repeat(73),'가'.repeat(25),'😀'.repeat(19),'a'.repeat(69)+'😀'])('refuses oversized UTF-8 passwords before account lookup',async password=>{
  const response=await app.request('/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic@example.test',password})});
  expect(response.status).toBe(400);
  const body=await response.json() as {details:{password:string[]}};expect(body.details.password.join(' ')).toMatch(/72.*bytes|bytes.*72/);
  expect(database).not.toHaveBeenCalled();
});
it.each(['password\uD800x','password\uDC00x','password\uD800','password\uDC00'])('refuses malformed Unicode before account lookup',async password=>{
  const response=await app.request('/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic@example.test',password})});
  expect(response.status).toBe(400);
  const body=await response.json() as {details:{password:string[]}};
  expect(body.details.password.join(' ')).toContain('invalid Unicode');
  expect(database).not.toHaveBeenCalled();
});

it.each(['/login','/signup'])('refuses mismatched origin or media type on %s before authentication work',async path=>{
  vi.stubEnv('PUBLIC_WEB_URL','https://waka.im');
  for(const [headers,status] of [
    [{'Origin':'https://elsewhere.example.test','Content-Type':'application/json'},403],
    [{'Origin':'null','Content-Type':'application/json'},403],
    [{'Origin':'https://waka.im','Content-Type':'text/plain'},415],
    [{'Sec-Fetch-Site':'cross-site','Content-Type':'application/json'},403],
  ] as const){
    const denied=await app.request('https://waka.im'+path,{method:'POST',headers,body:JSON.stringify({
      email:'synthetic@example.test',password:'synthetic-password',
    })});
    expect(denied.status).toBe(status);
    expect(denied.headers.getSetCookie()).toHaveLength(0);
  }
  expect(database).not.toHaveBeenCalled();
});
