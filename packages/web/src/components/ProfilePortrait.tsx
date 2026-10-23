import { useMemo } from 'react';
import { agentBeing, OWNER_BEING } from '../character/body';
import { Companion } from './Companion';

/** The profile's stable form, shared by its selector and Settings row. */
export function ProfilePortrait({ agentId, size = 24 }: { agentId?: string; size?: number }) {
  const being = useMemo(() => agentId ? agentBeing(agentId) : OWNER_BEING, [agentId]);
  return <span className="waka-profile-portrait" aria-hidden="true">
    <Companion size={size} being={being} cool={Boolean(agentId)} pixel={Boolean(agentId)} />
  </span>;
}
