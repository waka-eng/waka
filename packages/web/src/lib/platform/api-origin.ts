/** Only explicit isolated simulator fixtures may use the host loopback API. */
export function checkedNativeApiOrigin(): string {
  const origin = import.meta.env.VITE_API_URL as string;
  if (['https://dev.waka.im', 'https://waka.im'].includes(origin)) return origin;
  if (import.meta.env.VITE_BUILD_TARGET === 'mobile' && import.meta.env.VITE_MOBILE_DIAGNOSTICS === '1' &&
    import.meta.env.VITE_APP_ENVIRONMENT === 'development' && import.meta.env.VITE_APP_ID === 'im.waka.app.test' &&
    ['http://127.0.0.1:8787', 'http://10.0.2.2:8787'].includes(origin)) return origin;
  throw new Error('Unexpected mobile API origin.');
}
