export type Tilt = { x: number; y: number };
export type OrientationBaseline = { beta: number; gamma: number };

const clamp = (value: number) => Math.max(-1, Math.min(1, value));

export function normalizeOrientation(
  beta: number,
  gamma: number,
  baseline: OrientationBaseline,
  screenAngle: number,
): Tilt {
  const x = gamma - baseline.gamma;
  const y = beta - baseline.beta;
  const angle = ((screenAngle % 360) + 360) % 360;
  let screenX = x;
  let screenY = y;
  if (angle === 90) { screenX = y; screenY = -x; }
  else if (angle === 180) { screenX = -x; screenY = -y; }
  else if (angle === 270) { screenX = -y; screenY = x; }
  const normalizedX = clamp(screenX / 45);
  const normalizedY = clamp(screenY / 45);
  return { x: normalizedX === 0 ? 0 : normalizedX, y: normalizedY === 0 ? 0 : normalizedY };
}

export function createOrientationSensor(onTilt: (tilt: Tilt) => void): {
  start(): Promise<{ supported: boolean }>;
  stop(): void;
} {
  let generation = 0;
  let listener: ((event: DeviceOrientationEvent) => void) | undefined;
  let probe: ReturnType<typeof setTimeout> | undefined;
  let frame: ReturnType<typeof setTimeout> | undefined;
  let active = false;
  let resolveProbe: ((result: { supported: boolean }) => void) | undefined;

  const clearTimers = () => {
    if (probe !== undefined) clearTimeout(probe);
    if (frame !== undefined) clearTimeout(frame);
    probe = undefined;
    frame = undefined;
    resolveProbe?.({ supported: false });
    resolveProbe = undefined;
  };
  const detach = () => {
    clearTimers();
    if (listener) window.removeEventListener('deviceorientation', listener);
    listener = undefined;
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
  const reset = () => { active = false; onTilt({ x: 0, y: 0 }); };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      generation += 1;
      detach();
      reset();
    }
  };

  const stop = () => {
    generation += 1;
    detach();
    reset();
  };

  const start = async (): Promise<{ supported: boolean }> => {
    stop();
    const current = generation;
    if (typeof window === 'undefined' || typeof document === 'undefined' || document.visibilityState === 'hidden') {
      return { supported: false };
    }
    const Orientation = window.DeviceOrientationEvent;
    if (!Orientation) return { supported: false };
    const permissionAPI = Orientation as typeof Orientation & { requestPermission?: () => Promise<string> };
    if (typeof permissionAPI.requestPermission === 'function') {
      try {
        if (await permissionAPI.requestPermission() !== 'granted') return { supported: false };
      } catch { return { supported: false }; }
    }
    if (current !== generation || String(document.visibilityState) === 'hidden') return { supported: false };

    let baseline: OrientationBaseline | undefined;
    let lastUpdate = 0;
    let lastTilt: Tilt = { x: 0, y: 0 };
    let firstSample = false;
    active = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
    listener = (event) => {
      if (!active || current !== generation || document.visibilityState === 'hidden') return;
      if (typeof event.beta !== 'number' || !Number.isFinite(event.beta) ||
          typeof event.gamma !== 'number' || !Number.isFinite(event.gamma)) return;
      if (!firstSample) {
        firstSample = true;
        baseline = { beta: event.beta, gamma: event.gamma };
        return;
      }
      const now = performance.now();
      if (now - lastUpdate < 1000 / 30) return;
      lastUpdate = now;
      const angle = screen.orientation?.angle ?? (window.orientation as number | undefined) ?? 0;
      const next = normalizeOrientation(event.beta, event.gamma, baseline!, angle);
      lastTilt = { x: lastTilt.x + (next.x - lastTilt.x) * 0.12, y: lastTilt.y + (next.y - lastTilt.y) * 0.12 };
      onTilt(lastTilt);
    };
    window.addEventListener('deviceorientation', listener);
    const result = await new Promise<{ supported: boolean }>((resolve) => {
      resolveProbe = resolve;
      probe = setTimeout(() => {
        probe = undefined;
        resolveProbe = undefined;
        if (!active || current !== generation) return resolve({ supported: false });
        if (!firstSample) { detach(); reset(); return resolve({ supported: false }); }
        resolve({ supported: true });
      }, 700);
    });
    return result;
  };

  return { start, stop };
}
