import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { platformServices } from '../lib/platform';
import { createAuthorizationAttempt, validateAuthorizationCallback, type AuthorizationAttempt } from '../lib/platform/authorization';

const marker = 'WAKA_M1_DIAGNOSTICS';
const fixtureKey = 'm1.fixture', attemptKey = 'm1.authorization', fixturePath = 'm1/fixture.json';
export default function MobileChecks() {
  const [params] = useSearchParams();
  const location = useLocation();
  const phase = params.get('phase') ?? 'read';
  const callback = params.get('callback');
  const [report, setReport] = useState<Record<string, unknown>>({ phase, status: 'Checking…' });
  useEffect(() => {
    let stopped = false;
    void (async () => {
      const services = await platformServices(), identity = await services.identity();
      const result: Record<string, unknown> = { marker, phase, identity, health: await services.health() };
      if (phase === 'write') {
        const fixture = `synthetic-${crypto.randomUUID()}`;
        await services.credentials.set(fixtureKey, fixture);
        await services.files.write(fixturePath, JSON.stringify({ fixture, owner: identity.id }));
        const attempt = await createAuthorizationAttempt(identity.id);
        await services.credentials.set(attemptKey, JSON.stringify(attempt));
        result.secureWrite = await services.credentials.get(fixtureKey) === fixture;
        result.fileWrite = JSON.parse(await services.files.read(fixturePath)).fixture === fixture;
        // A state nonce is public protocol data, never a session credential.
        result.callbackFixture = `${attempt.callback}?code=synthetic_authorization_code&state=${attempt.state}`;
      } else if (phase === 'read') {
        const credential = await services.credentials.get(fixtureKey);
        let file: { fixture?: string; owner?: string } = {};
        try { file = JSON.parse(await services.files.read(fixturePath)); } catch { /* Fresh application has no fixture. */ }
        result.secureRead = Boolean(credential && file.fixture === credential && file.owner === identity.id);
        result.fileRead = Boolean(file.fixture && file.owner === identity.id);
        result.emptySecureStore = credential === null;
      } else if (phase === 'callback') {
        const saved = await services.credentials.get(attemptKey);
        if (!saved || !callback) { result.callbackAccepted = false; result.callbackReason = 'No pending attempt'; }
        else {
          const attempt = JSON.parse(saved) as AuthorizationAttempt;
          validateAuthorizationCallback(attempt, callback);
          await services.credentials.remove(attemptKey);
          result.callbackAccepted = true;
          result.pendingRemoved = await services.credentials.get(attemptKey) === null;
        }
      } else if (phase === 'cleanup') {
        await services.credentials.remove(fixtureKey); await services.credentials.remove(attemptKey);
        try { await services.files.remove(fixturePath); } catch { /* Cleanup is idempotent. */ }
        result.secureRemoved = await services.credentials.get(fixtureKey) === null;
      } else throw new Error('Unknown check phase.');
      await document.fonts.ready;
      await document.fonts.load('16px "Pretendard"', '영감 WAKA');
      await document.fonts.load('24px "Jost"', 'WAKA');
      const loaded = (name: string) => Array.from(document.fonts).some(face => face.family.replace(/['"]/g, '') === name && face.status === 'loaded');
      result.fonts = { body: loaded('Pretendard'), heading: loaded('Jost') };
      await services.files.write('m1/report.json', JSON.stringify(result));
      if (!stopped) setReport(result);
    })().catch(async error => {
      const failed = { marker, phase, failed: true, reason: error instanceof Error ? error.message : 'Device check failed' };
      try { await (await platformServices()).files.write('m1/report.json', JSON.stringify(failed)); } catch { /* Preserve the visible failure. */ }
      if (!stopped) setReport(failed);
    });
    return () => { stopped = true; };
  }, [phase, callback, location.key]);
  return <main style={{ maxWidth: 620, margin: '40px auto', padding: 24, fontFamily: 'Pretendard, sans-serif', color: '#eee', overflowWrap: 'anywhere' }}>
    <h1 style={{ fontFamily: 'Jost, sans-serif' }}>WAKA device checks</h1>
    <p>Synthetic development checks. No account or personal inspiration is used.</p>
    <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}><Link to="/mobile-check?phase=write">Write fixture</Link><Link to="/mobile-check?phase=read">Read fixture</Link><Link to="/mobile-check?phase=cleanup">Remove fixture</Link><Link to="/login">Open sign in</Link></nav>
    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, marginTop: 24 }}>{JSON.stringify(report, null, 2)}</pre>
  </main>;
}
