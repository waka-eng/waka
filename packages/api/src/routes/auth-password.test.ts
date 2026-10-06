/** WHAT THIS MOCKS, AND WHY: database access is a refusing spy. Oversized
 * signup must fail validation before any lookup or write. Real signup handler,
 * Hono and validation are used; no live database/provider/account is involved. */
import {Hono} from 'hono';
import {beforeEach,expect,it,vi} from 'vitest';
const database=vi.hoisted(()=>vi.fn(()=>{throw new Error('Signup reached database before password validation');}));
vi.mock('../lib/db.js',()=>({getDb:database}));
import {signupHandler} from './auth-password.js';
const app=new Hono().post('/signup',signupHandler);
beforeEach(()=>{database.mockClear();});
it.each(['a'.repeat(73),'가'.repeat(25),'😀'.repeat(19),'a'.repeat(69)+'😀'])('refuses oversized UTF-8 passwords before account lookup',async password=>{
  const response=await app.request('/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic@example.test',password})});
  expect(response.status).toBe(400);
  const body=await response.json() as {details:{password:string[]}};expect(body.details.password.join(' ')).toMatch(/72.*bytes|bytes.*72/);
  expect(database).not.toHaveBeenCalled();
});
