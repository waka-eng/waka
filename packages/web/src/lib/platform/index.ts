import type { PlatformServices } from './contracts';
export const isMobileBuild = import.meta.env.VITE_BUILD_TARGET === 'mobile';
export const mobileDiagnosticsEnabled = isMobileBuild && import.meta.env.VITE_MOBILE_DIAGNOSTICS === '1';
let native: Promise<PlatformServices> | undefined;
export function platformServices(): Promise<PlatformServices> {
  if (!isMobileBuild) return Promise.reject(new Error('Native services require the installed app.'));
  return native ??= import('./native').then(module => module.nativePlatform());
}
