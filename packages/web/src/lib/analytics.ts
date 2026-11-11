import type { CaptureResult, PostHogConfig } from 'posthog-js';

export type Screen = 'home' | 'chat' | 'settings' | 'memory' | 'auth' | 'other';
export type BrowserFailure = 'render' | 'unhandled' | 'rejection';
const screens = new Set(['home','chat','settings','memory','auth','other']);
const failures = new Set(['render','unhandled','rejection']);
function freshId() { try { return globalThis.crypto.randomUUID(); } catch { return ''; } }
let anonymousId = freshId();
let enabled = false;
let client: Promise<import('posthog-js').PostHog> | undefined;
let remaining = 100; // Per document bound, including failures; not a project bill cap.

export function analyticsConfig(token: string | undefined, host: string | undefined) {
  if (!token || !/^phc_[A-Za-z0-9_-]+$/.test(token) || !['https://us.i.posthog.com','https://eu.i.posthog.com'].includes(host ?? '')) return null;
  return { token, host: host! };
}
/** Rebuild, do not blacklist: SDK URL/referrer/session/person/DOM/exception
 * defaults and any future automatic properties never survive this boundary. */
export function sanitizeAnalytics(event: CaptureResult | null, id = anonymousId, token?: string): CaptureResult | null {
  if (!event || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const p = event.properties;
  const base = { ...(token ? {token} : {}), distinct_id: id, $process_person_profile: false, $geoip_disable: true, namespace:'WAKA/production' };
  if (event.event === 'WAKA/production/screen_opened' && screens.has(p.screen)) return { uuid:crypto.randomUUID(),event:'WAKA/production/screen_opened',properties:{...base,screen:p.screen} };
  if (event.event === '$exception' && failures.has(p.failure)) return { uuid:crypto.randomUUID(),event:'$exception',properties:{...base,
    $exception_list:[{type:'WakaBrowserError',value:p.failure,mechanism:{type:'generic',handled:p.failure==='render'}}],
    $exception_fingerprint:[`waka_${p.failure}`],failure:p.failure } };
  return null;
}
export function privacyOptions(host: string, token: string): Partial<PostHogConfig> {
  return { api_host:host, autocapture:false,capture_pageview:false,capture_pageleave:false,capture_dead_clicks:false,rageclick:false,
    capture_exceptions:false,capture_performance:false,disable_session_recording:true,enable_recording_console_log:false,
    disable_surveys:true,disable_conversations:true,disable_product_tours:true,disable_web_experiments:true,
    disable_external_dependency_loading:true,advanced_disable_flags:true,advanced_disable_feature_flags:true,
    person_profiles:'never',persistence:'memory',disable_persistence:true,save_referrer:false,save_campaign_params:false,
    mask_all_text:true,mask_all_element_attributes:true,ip:false,opt_in_site_apps:false,
    error_tracking:{exception_steps:{enabled:false}},request_batching:false,disable_compression:true,
    before_send:event => sanitizeAnalytics(event, anonymousId, token),debug:false };
}
export function startAnalytics(token = import.meta.env.VITE_POSTHOG_PROJECT_TOKEN, host = import.meta.env.VITE_POSTHOG_HOST) {
  const config = analyticsConfig(token, host);
  if (!config || client || window.location.hostname !== 'waka.im' || import.meta.env.VITE_BUILD_TARGET === 'mobile') return;
  enabled = true;
  client = import('posthog-js/no-external').then(({default:posthog}) => {
    posthog.init(config.token, privacyOptions(config.host, config.token)); return posthog;
  });
  void client.catch(() => { enabled = false; }); // Analytics never breaks product work.
  window.addEventListener('error', () => recordBrowserFailure('unhandled'));
  window.addEventListener('unhandledrejection', () => recordBrowserFailure('rejection'));
}
function capture(name: string, properties: Record<string,string>) {
  if (!enabled || !client || remaining <= 0) return;
  remaining--;
  void client.then(sdk => sdk.capture(name, properties)).catch(() => {});
}
export function recordScreen(screen: Screen) { capture('WAKA/production/screen_opened',{screen}); }
export function recordBrowserFailure(failure: BrowserFailure) { capture('$exception',{failure}); }
export function resetAnalyticsIdentity() { anonymousId = freshId(); }
