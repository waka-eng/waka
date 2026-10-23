import { Fragment, useRef, type ReactNode } from 'react';

import { useOptionalAuth } from './auth-context';
import { ArchiveRecorderProvider } from './archive-recorder';

/** Keep submitted clips in this tab across route and identity changes.
 * Only the original signed-in profile can see or retry its recordings.
 * Inactive recorders stop the microphone and pause subsequent upload steps. */
export function ArchiveRecordingBoundary({ children }: { children: ReactNode }): JSX.Element {
  const auth = useOptionalAuth();
  const accountId = auth?.account?.id, profileId = auth?.profile?.id;
  const active = accountId && profileId ? `${accountId}:${profileId}` : null;
  const owners = useRef(new Map<string, string>());
  if (active && profileId) owners.current.set(active, profileId);
  return <Fragment>
    {[...owners.current].map(([key, ownerProfileId]) => <ArchiveRecorderProvider key={key}
      enabled={key === active} ownerProfileId={ownerProfileId}>
      {key === active ? children : null}
    </ArchiveRecorderProvider>)}
    {!active ? children : null}
  </Fragment>;
}
