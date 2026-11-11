/** Stage configuration inventory. Secrets are accepted only from that stage;
 * neither the report nor the approved-default map contains secret values. */
export const STAGE_OPTION_KEYS=['WAKA_OPENROUTER_DATA_COLLECTION','WAKA_OPENROUTER_REQUIRE_ZDR','WAKA_OPERATIONS_ALERT_TOPIC_ARN','WAKA_ALERT_SNS_TOPIC_ARN','WAKA_TRUSTED_PROXY_HOPS'];
export function stageDefaults(stage) {
  if(!['production','development'].includes(stage))throw Error('Choose production or development');
  const origin=stage==='production'?'https://waka.im':'https://dev.waka.im';
  return {AWS_REGION:'us-west-2',AWS_DEFAULT_REGION:'us-west-2',ATTACHMENTS_REGION:'us-west-2',NODE_ENV:'production',WAKA_STAGE:stage,
    PUBLIC_API_URL:origin,PUBLIC_WEB_URL:origin,OPENROUTER_GENERATION_MODEL:'deepseek/deepseek-v4.1-flash-1017',
    WAKA_MODEL_SYNTHESIZE:'openai/gpt-6.1-terra',WAKA_MODEL_TOP_OF_MIND_REVIEW:'openai/gpt-6.1-terra',
    WAKA_CONVERSATION_REPLIES:'1',WAKA_MODEL_CHAT:'deepseek/deepseek-v4.1-flash-1017'};
}
export function stageEnvAdditions(stage,current) {
  const defaults=stageDefaults(stage),out={};
  for(const [key,value] of Object.entries(defaults))if(!(key in current))out[key]=value;
  for(const [canonical,legacy] of [['AWS_ACCESS_KEY_ID','AWS_ACCESS_KEY_ID_APP'],['AWS_SECRET_ACCESS_KEY','AWS_SECRET_ACCESS_KEY_APP']]) {
    if(!(canonical in current)&&current[legacy])out[canonical]=current[legacy];
  }
  for(const key of [...STAGE_OPTION_KEYS,'ATTACHMENTS_BUCKET','WAKA_VAULT_BUCKET'])if(!(key in current))out[key]='';
  return out;
}
export function validateStageOptions(env) {
  const collection=env.WAKA_OPENROUTER_DATA_COLLECTION,zdr=env.WAKA_OPENROUTER_REQUIRE_ZDR;
  if(collection&&collection!=='deny')throw Error('Invalid WAKA_OPENROUTER_DATA_COLLECTION');
  if(zdr&&!['0','1'].includes(zdr))throw Error('Invalid WAKA_OPENROUTER_REQUIRE_ZDR');
  for(const key of ['WAKA_OPERATIONS_ALERT_TOPIC_ARN','WAKA_ALERT_SNS_TOPIC_ARN'])if(env[key]&&!/^arn:aws:sns:us-west-2:\d{12}:[A-Za-z0-9_-]{1,256}$/.test(env[key]))throw Error(`Invalid ${key}`);
  // Topology remains deliberately unattested; do not synthesize a hop count.
  if(env.WAKA_TRUSTED_PROXY_HOPS&&!/^\d+$/.test(env.WAKA_TRUSTED_PROXY_HOPS))throw Error('Invalid WAKA_TRUSTED_PROXY_HOPS');
}
export function redactedStageInventory(stage,current,additions={}) {
  const values={...current,...additions};
  return Object.keys(values).sort().map(key=>({key,status:!values[key]?'missing/unset':Object.hasOwn(additions,key)?key.startsWith('AWS_')&&key.includes('KEY')?'same-stage credential mapping':'source-established default':'existing value preserved'}));
}
