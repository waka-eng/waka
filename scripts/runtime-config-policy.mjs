/** Check exported stage configuration without printing credentials or making
 * network calls. Passing origins is not proof of proxy topology or isolation. */
export function verifyRuntimeConfiguration(config,stage){
  const expected={development:'https://dev.waka.im',dev:'https://dev.waka.im',production:'https://waka.im'}[stage];
  if(!expected)throw new Error('An explicit development/dev/production stage is required');
  if(!config||typeof config!=='object')throw new Error('Runtime configuration is missing');
  for(const name of ['api','worker']){
    const env=config[name];if(!env||typeof env!=='object')throw new Error(`${name} configuration is missing`);
    for(const key of ['PUBLIC_WEB_URL','PUBLIC_API_URL']){
      let url;try{url=new URL(env[key]);}catch{throw new Error(`${name} ${key} must be an explicit trusted HTTPS origin`);}
      if(url.origin!==expected||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error(`${name} ${key} does not match the requested stage origin`);
    }
    if(env.NODE_ENV!=='production'||env.WAKA_INSECURE_COOKIES==='1')throw new Error(`${name} cookie security configuration is unsafe`);
    if(env.WAKA_STAGE!==stage)throw new Error(`${name} stage tag does not match the requested stage`);
    if(env.OPENROUTER_GENERATION_MODEL!=='deepseek/deepseek-v4.1-flash')throw new Error(`${name} generation model is not the approved pin`);
    if(env.WAKA_ENRICHMENT_ALLOWED_HOSTS?.trim())throw new Error(`${name} enrichment allowlist must not include fixture/private-address overrides`);
  }
  const raw=config.api.WAKA_TRUSTED_PROXY_HOPS;
  const hops=raw===undefined||String(raw).trim()===''?null:Number(raw);
  if(hops!==null&&(!Number.isInteger(hops)||hops<0||hops>16))throw new Error('Trusted proxy hop configuration is invalid');
  return {stage,trustedOrigins:true,secureCookies:true,fixtureOverridesAbsent:true,approvedGenerationModel:true,
    proxyTopologyDeclared:hops!==null,proxyTopologyVerified:false,databaseIsolationVerified:false,
    providerPrivacyVerified:false,monetaryLimitsVerified:false};
}
