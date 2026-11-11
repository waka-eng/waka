// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `fetch` supplies the session HTTP boundary, so the real sessions client, confirmation and exact revocation request run without ending any real credential. */
/** Real session HTTP boundary: revoke exact credentials while retaining every memory owner. */
import {act} from 'react';import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SettingsPanel} from '../src/components/SettingsPanel';
let host:HTMLDivElement,root:Root,failRead=false,failDelete=false;
let rows:any[],requests:Array<{path:string;method:string}>;
const button=(name:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>(b.getAttribute('aria-label')??b.textContent)?.trim().startsWith(name))!;
const props={locale:'en-US' as const,email:'owner@example.test',name:'Owner',onName:()=>{},onLocale:()=>{},nameBusy:false,localeBusy:false,failed:false,onSignOut:()=>{},onDeleteAccount:async()=>{},onClose:()=>{}};
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);requests=[];failRead=false;failDelete=false;
 rows=[['browser','human','Current browser',true],['legacy-one','agent','Work laptop',false],['legacy-two','agent','Other laptop',false]].map(([id,type,deviceLabel,current])=>({id,current,deviceLabel,profile:{id:`profile-${id}`,name:`Secret ${id}`,type},createdAt:'2026-01-01T00:00:00Z',lastSeenAt:'2026-10-01T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z'}));
 vi.stubGlobal('fetch',vi.fn(async(input,init)=>{const path=String(input),method=init?.method??'GET';requests.push({path,method});if(method==='GET'&&failRead||method==='DELETE'&&failDelete)return Response.json({error:'Offline'},{status:500});return Response.json(method==='GET'?{sessions:rows}:{id:path.split('/').at(-1),endedCurrent:false});}));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function open(){await act(async()=>root.render(<SettingsPanel {...props}/>));await act(async()=>button('Signed-in devices').click());}
it('lists devices from retained credentials without selecting or managing profiles',async()=>{
 await open();expect(host.textContent).toContain('Work laptop');expect(host.textContent).toContain('Other laptop');expect(host.textContent).not.toMatch(/Secret|Agent profiles|Set up MCP/);expect(host.querySelectorAll('.waka-session-card')).toHaveLength(2);
});
it('requires confirmation and disconnects only one device without profile writes',async()=>{
 await open();await act(async()=>button('Disconnect Work laptop').click());expect(requests.filter(r=>r.method==='DELETE')).toEqual([]);
 await act(async()=>button('Disconnect Work laptop').click());expect(requests.filter(r=>r.method==='DELETE')).toEqual([{path:'/api/sessions/legacy-one',method:'DELETE'}]);expect(host.textContent).toContain('Other laptop');expect(requests.some(r=>r.path.includes('/profiles'))).toBe(false);
});
it('keeps failed revocation recoverable and its credential on screen',async()=>{
 await open();failDelete=true;await act(async()=>button('Disconnect Work laptop').click());await act(async()=>button('Disconnect Work laptop').click());expect(host.textContent).toContain('Work laptop');expect(host.querySelector('[role="alert"]')).not.toBeNull();
 failDelete=false;await act(async()=>button('Disconnect Work laptop').click());expect(host.querySelectorAll('.waka-session-card')).toHaveLength(1);
});
it('distinguishes failure from empty and refreshes safely',async()=>{
 failRead=true;await open();expect(host.querySelector('[role="alert"]')).not.toBeNull();failRead=false;rows=[];await act(async()=>button('Refresh').click());expect(host.querySelector('[role="alert"]')).toBeNull();expect(host.querySelectorAll('.waka-session-card')).toHaveLength(0);
});
