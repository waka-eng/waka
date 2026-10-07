export const targets = Object.freeze({
  development: Object.freeze({ environment: 'development', appId: 'im.waka.app.dev', appName: 'WAKA Dev', apiOrigin: 'https://dev.waka.im', webOrigin: 'https://dev.waka.im', diagnostics: true }),
  production: Object.freeze({ environment: 'production', appId: 'im.waka.app', appName: 'WAKA', apiOrigin: 'https://waka.im', webOrigin: 'https://waka.im', diagnostics: false }),
});

export function targetFor(environment) {
  if (!Object.hasOwn(targets, environment)) throw new Error('Choose development or production explicitly.');
  return targets[environment];
}

export function capacitorConfiguration(target) {
  return {
    appId: target.appId, appName: target.appName, webDir: 'www',
    // Bridge request/response logging can include future session/file values.
    // Inspectable dev WebViews are sufficient; do not persist bridge payloads.
    loggingBehavior: 'none',
    server: { hostname: 'localhost', androidScheme: 'https', iosScheme: 'capacitor' },
    android: { webContentsDebuggingEnabled: target.diagnostics, allowMixedContent: false },
    ios: { webContentsDebuggingEnabled: target.diagnostics },
    plugins: { CapacitorHttp: { enabled: false }, CapacitorCookies: { enabled: false } },
  };
}

export function publicBuildEnvironment(target) {
  return {
    WAKA_BUILD_TARGET: 'mobile', VITE_BUILD_TARGET: 'mobile',
    VITE_API_URL: target.apiOrigin, VITE_PUBLIC_WEB_URL: target.webOrigin,
    VITE_APP_ENVIRONMENT: target.environment, VITE_APP_ID: target.appId,
    VITE_MOBILE_DIAGNOSTICS: target.diagnostics ? '1' : '0',
  };
}
