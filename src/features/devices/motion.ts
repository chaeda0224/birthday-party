import { getMotionMagnitude } from './analysis.ts';

type MotionPermissionEvent = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<PermissionState>;
};

type MotionListener = (event: DeviceMotionEvent) => void;

export function createMotionSensor(onShake: () => void): {
  start(): Promise<{ supported: boolean }>;
  stop(): void;
} {
  let running = false;
  let previousMagnitude: number | null = null;
  let lastShakeAt = Number.NEGATIVE_INFINITY;
  let generation = 0;
  let target: Window | null = null;
  let listener: MotionListener | null = null;
  let cancelPendingProbe: (() => void) | null = null;

  const stop = () => {
    generation += 1;
    cancelPendingProbe?.();
    cancelPendingProbe = null;
    if (target && listener) target.removeEventListener('devicemotion', listener);
    target = null;
    listener = null;
    running = false;
    previousMagnitude = null;
  };

  return {
    async start() {
      stop();
      const currentGeneration = generation;
      const browserWindow = typeof window === 'undefined' ? null : window;
      const MotionEventConstructor =
        typeof DeviceMotionEvent === 'undefined' ? null : (DeviceMotionEvent as MotionPermissionEvent);
      if (!browserWindow || !MotionEventConstructor) return { supported: false };

      if (typeof MotionEventConstructor.requestPermission === 'function') {
        try {
          if ((await MotionEventConstructor.requestPermission()) !== 'granted') {
            return { supported: false };
          }
        } catch {
          return { supported: false };
        }
      }
      if (currentGeneration !== generation) return { supported: false };

      target = browserWindow;
      listener = (event) => {
        const magnitude = getMotionMagnitude(event);
        if (magnitude === null) return;
        const now = performance.now();
        if (
          previousMagnitude !== null &&
          Math.abs(magnitude - previousMagnitude) >= 2.2 &&
          now - lastShakeAt >= 700
        ) {
          lastShakeAt = now;
          onShake();
        }
        previousMagnitude = magnitude;
      };
      target.addEventListener('devicemotion', listener);

      const hasMotionEvent = await new Promise<boolean>((resolve) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout>;
        const finish = (observed: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          browserWindow.removeEventListener('devicemotion', onFirstMotion);
          cancelPendingProbe = null;
          resolve(observed);
        };
        const onFirstMotion: MotionListener = (event) => {
          if (getMotionMagnitude(event) === null) return;
          finish(true);
        };
        timeout = setTimeout(() => finish(false), 350);
        cancelPendingProbe = () => finish(false);
        browserWindow.addEventListener('devicemotion', onFirstMotion);
      });
      if (target !== browserWindow || listener === null) return { supported: false };
      running = hasMotionEvent;
      if (!hasMotionEvent) stop();
      return { supported: hasMotionEvent };
    },
    stop,
  };
}
