/** Provider-side limits are authoritative for this key, not all app costs.
 * No credential, key label, user ID or arbitrary provider field is returned. */
export function verifyModelKeyLimit(data,expectedLimit,expectedReset){
  if(typeof expectedLimit!=='number'||!Number.isFinite(expectedLimit)||expectedLimit<=0)throw new Error('An explicit positive approved USD limit is required');
  if(!['daily','weekly','monthly'].includes(expectedReset))throw new Error('An explicit approved reset period is required');
  if(!data||typeof data!=='object'||typeof data.limit!=='number'||!Number.isFinite(data.limit)||data.limit<0||data.limit>expectedLimit)throw new Error('Provider key has no qualifying enforced spending limit');
  if(data.limit_reset!==expectedReset)throw new Error('Provider key reset period does not match the approved policy');
  if(data.include_byok_in_limit!==true)throw new Error('Provider key limit must include BYOK usage');
  return {provider:'openrouter',limitUsd:data.limit,reset:data.limit_reset,byokIncluded:true,
    separateStageKeysVerified:false,geminiLimitsVerified:false};
}
