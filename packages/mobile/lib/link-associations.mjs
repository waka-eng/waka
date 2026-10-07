import { targetFor } from './targets.mjs';

/** Public identifiers only. Never publish guessed teams or temporary keys. */
export function linkAssociations(environment, appleTeamId, certificateFingerprints) {
  const target = targetFor(environment, null);
  if (!/^[A-Z0-9]{10}$/.test(appleTeamId ?? '')) throw new Error('Provide the registered Apple Team ID.');
  if (!Array.isArray(certificateFingerprints) || !certificateFingerprints.length ||
    !certificateFingerprints.every(value => /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(value))) throw new Error('Provide actual Android signing SHA256 fingerprints.');
  return {
    apple: { applinks: { apps: [], details: [{ appIDs: [`${appleTeamId}.${target.appId}`], components:
      ['/', '/@*', '/w/*', '/inspirations/*', '/review/*', '/principles/*', '/chat/*', '/profile', '/onboarding', '/login'].map(path => ({ '/': path })) }] } },
    android: [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app',
      package_name: target.appId, sha256_cert_fingerprints: certificateFingerprints } }],
  };
}
