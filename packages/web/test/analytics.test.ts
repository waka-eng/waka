// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyticsConfig, privacyOptions, sanitizeAnalytics, resetAnalyticsIdentity, startAnalytics, recordScreen } from '../src/lib/analytics';
import type { CaptureResult } from 'posthog-js';

const canary='PRIVATE_CAPTURE_email@example.com_https://private.example/?token=SECRET';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('metadata-only PostHog boundary',()=>{
  it('fails closed without both approved public settings',()=>{
    expect(analyticsConfig(undefined,undefined)).toBeNull();expect(analyticsConfig('phc_public',undefined)).toBeNull();
    expect(analyticsConfig('phc_public','https://us.i.posthog.com.evil')).toBeNull();expect(analyticsConfig('personal_admin_key','https://us.i.posthog.com')).toBeNull();
    expect(analyticsConfig('phc_public','https://eu.i.posthog.com')).toBeTruthy();
  });
  it('absent config makes no network calls, and logout rotates the anonymous identity',()=>{
    const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);startAnalytics('',undefined);recordScreen('home');expect(fetcher).not.toHaveBeenCalled();
    const event={uuid:'',event:'WAKA/production/screen_opened',properties:{screen:'home'}} as CaptureResult;
    const before=sanitizeAnalytics(event)!.properties.distinct_id;resetAnalyticsIdentity();expect(sanitizeAnalytics(event)!.properties.distinct_id).not.toBe(before);
  });
  it('rebuilds properties and rejects remote/automatic payloads including replay',()=>{
    const event={event:'WAKA/production/screen_opened',uuid:canary,properties:{screen:'home',$current_url:canary,$referrer:canary,$set:{email:canary},distinct_id:canary,$session_id:canary,stack:canary},$set:{name:canary}} as unknown as CaptureResult;
    const output=sanitizeAnalytics(event)!;expect(JSON.stringify(output)).not.toContain(canary);expect(Object.keys(output.properties).sort()).toEqual(['$geoip_disable','$process_person_profile','distinct_id','namespace','screen']);
    for(const name of ['$autocapture','$pageview','$snapshot','$identify','$set','$feature_flag_called','$web_vitals','arbitrary']) expect(sanitizeAnalytics({...event,event:name})).toBeNull();
    expect(sanitizeAnalytics({...event,properties:{screen:canary}})).toBeNull();
    const error=sanitizeAnalytics({...event,event:'$exception',properties:{failure:'render',$exception_list:[{value:canary,stacktrace:{frames:[{filename:canary}]}}]}})!;
    expect(JSON.stringify(error)).not.toContain(canary);expect(error.properties.$exception_list[0].value).toBe('render');
  });
  it('tests actual installed SDK outgoing requests after automatic-property expansion',async()=>{
    const outgoing:Array<{url:string;options:RequestInit}> = [];
    const transport=vi.fn(async(url:unknown,options:RequestInit={})=>{outgoing.push({url:String(url),options});return new Response('{}',{status:200});});
    vi.stubGlobal('fetch',transport);window.fetch=transport;
    const {PostHog}=await import('posthog-js/no-external');const sdk=new PostHog();
    const options=privacyOptions('https://us.i.posthog.com','phc_public_local_test');
    sdk.init('phc_public_local_test',{...options,logs:{...options.logs,flushIntervalMs:10},metrics:{...options.metrics,flushIntervalMs:10},opt_out_useragent_filter:true});
    sdk.register({$current_url:canary,$referrer:canary,email:canary,account_id:canary});
    sdk.capture('WAKA/production/screen_opened',{screen:'chat',chat:canary},{transport:'fetch'});
    sdk.capture('$exception',{failure:'rejection',$exception_list:[{value:canary,stack:canary}],$exception_steps:[canary]},{transport:'fetch'});
    // Even accidental remote-preference-like opt-ins cannot cross the final
    // event allowlist. Remote configuration itself is disabled before load.
    sdk.capture('$snapshot',{data:canary},{transport:'fetch'});sdk.identify(canary,{email:canary});
    sdk.captureLog({body:canary,level:'error',attributes:{url:canary,stack:canary}});
    await vi.waitFor(()=>expect(outgoing.length).toBe(2));
    await new Promise(resolve=>setTimeout(resolve,40));expect(outgoing).toHaveLength(2);
    for(const {url,options} of outgoing){
      expect(url).toMatch(/^https:\/\/us\.i\.posthog\.com\//);expect(url).not.toMatch(/flags|config|recorder|surveys/);
      expect(url).not.toContain(canary);expect(url).not.toContain(encodeURIComponent(canary));
      expect(options.referrerPolicy).toBe('strict-origin');expect(JSON.stringify(options)).not.toContain(canary);
      const raw=String(options.body);const parsed=JSON.parse(raw);expect(Object.keys(parsed).sort()).toEqual(['api_key','batch','sent_at']);expect(parsed.batch).toHaveLength(1);const data=parsed.batch[0];
      expect(['WAKA/production/screen_opened','$exception']).toContain(data.event);expect(data.properties.distinct_id).not.toBe(canary);
      const keys=Object.keys(data.properties).filter(k=>k!=='token').sort();
      expect(keys).toEqual((data.event==='$exception'?['$exception_fingerprint','$exception_list','$geoip_disable','$process_person_profile','distinct_id','failure','namespace']:['$geoip_disable','$process_person_profile','distinct_id','namespace','screen']).sort());
      expect(parsed.api_key).toBe('phc_public_local_test');
    }
    sdk.opt_out_capturing();
  });
});
