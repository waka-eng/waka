/**
 * HAPTICS ONLY INSIDE THE APP (founder, 2026-11-26, from the iOS audit).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `@capacitor/core` (whether this is the
 * native app) and `@capacitor/haptics` (the motor), the two things a test
 * runner does not have. `lib/haptics` itself is the shipped one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ on: false }));
const motor = vi.hoisted(() => ({ impact: vi.fn(async () => undefined), notification: vi.fn(async () => undefined) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native.on } }));
vi.mock('@capacitor/haptics', () => ({ Haptics: motor, ImpactStyle: { Light: 'LIGHT' }, NotificationType: { Success: 'SUCCESS' } }));
import { feel } from '../src/lib/haptics';

afterEach(() => { native.on = false; motor.impact.mockClear(); motor.notification.mockClear(); });

describe('feel', () => {
  it('does nothing on the web', async () => {
    feel('light'); feel('success');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(motor.impact).not.toHaveBeenCalled();
    expect(motor.notification).not.toHaveBeenCalled();
  });
  it('taps lightly, and says success, inside the app', async () => {
    native.on = true;
    await feel('light'); await feel('success');
    expect(motor.notification).toHaveBeenCalledWith({ type: 'SUCCESS' });
    expect(motor.impact).toHaveBeenCalledWith({ style: 'LIGHT' });
  });
});
