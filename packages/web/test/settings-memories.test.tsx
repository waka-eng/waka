// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/profiles` supplies retained profile rows without a server; the real Settings and help components must not offer their management or selection. */
/** Network profiles are legacy data; opening settings must never expose a roster. */
import {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {SettingsPanel} from '../src/components/SettingsPanel';
import {fetchProfiles} from '../src/lib/api/profiles';
import {HowItWorksPanel} from '../src/components/HowItWorksPanel';
vi.mock('../src/lib/api/profiles',()=>({fetchProfiles:vi.fn()}));
let host:HTMLDivElement,root:Root;
beforeEach(()=>{globalThis.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.clearAllMocks();});
it.each([0,1,3])('offers no agent management with %i retained stacks',async count=>{
 const rows=[{id:'human',type:'human',name:'Me'},...Array.from({length:count},(_,i)=>({id:`agent-${i}`,type:'agent',name:`Legacy ${i}`}))];
 vi.mocked(fetchProfiles).mockResolvedValue(rows as never);
 await act(async()=>root.render(<SettingsPanel locale="en-US" email="local@example.test" name="Me" onName={()=>{}} onLocale={()=>{}} nameBusy={false} localeBusy={false} failed={false} onSignOut={()=>{}} onDeleteAccount={async()=>{}} onClose={()=>{}}/>));
 expect(host.textContent).not.toMatch(/Agents|Add agent|Agent name|Legacy/);
 expect(host.querySelector('[data-settings-target="agents"]')).toBeNull();
 expect(fetchProfiles).not.toHaveBeenCalled();
 expect(host.querySelector('[data-settings-target="personal"]')).not.toBeNull();
});
it('explains how WAKA works without decorative entries or switching instructions',async()=>{
 await act(async()=>root.render(<HowItWorksPanel locale="en-US" onClose={()=>{}}/>));
 /* Founder, 2026-11-12: "strip all unnecessary descriptive text across the
    experience". */
 expect(host.textContent).not.toContain('One companion, your memory');
 expect(host.textContent).toContain('Repeated patterns become principles.');
 expect(host.textContent).not.toMatch(/your agents|Switch at/);
});
