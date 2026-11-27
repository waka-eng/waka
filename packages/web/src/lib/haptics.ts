/**
 * A LIGHT TOUCH AT THE MOMENTS THAT MATTER (founder, 2026-11-26, from the
 * iOS audit: "add haptics"). Only inside the native app, where Capacitor's
 * Haptics plugin exists; on the web it does nothing. Never awaited and
 * never thrown: a missing motor is not an error a person should see. It
 * returns its promise only so a test can wait for it.
 *
 *   light   a tap that changed something on screen (the creature's next line,
 *           a sheet coming up)
 *   success a save that landed
 */
import { Capacitor } from '@capacitor/core';

export function feel(kind: 'light' | 'success'): Promise<void> {
  if (!Capacitor.isNativePlatform()) return Promise.resolve();
  return import('@capacitor/haptics').then(({ Haptics, ImpactStyle, NotificationType }) => kind === 'success'
    ? Haptics.notification({ type: NotificationType.Success })
    : Haptics.impact({ style: ImpactStyle.Light })).then(() => undefined, () => undefined);
}
