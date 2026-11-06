export type BlowSample = {
  rms: number;
  highFrequencyRatio: number;
};

export type BlowCalibration = {
  rms: number;
  highFrequencyRatio: number;
};

export function analyseRms(samples: ArrayLike<number>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] ?? 0;
    sum += value * value;
  }
  return Math.sqrt(sum / samples.length);
}

export function analyseHighFrequencyRatio(
  bins: ArrayLike<number>,
  minimumBin = Math.floor(bins.length * 0.07),
): number {
  if (bins.length === 0) return 0;
  let total = 0;
  let high = 0;
  for (let i = 0; i < bins.length; i += 1) {
    const energy = Math.max(0, bins[i] ?? 0);
    total += energy;
    if (i >= minimumBin) high += energy;
  }
  return total === 0 ? 0 : high / total;
}

export function createBlowCalibration(samples: readonly BlowSample[]): BlowCalibration {
  if (samples.length === 0) return { rms: 0, highFrequencyRatio: 0 };
  return {
    rms: Math.min(0.012, [...samples].sort((a,b)=>a.rms-b.rms)[Math.floor(samples.length*0.2)]?.rms ?? 0),
    highFrequencyRatio:
      samples.reduce((sum, sample) => sum + sample.highFrequencyRatio, 0) / samples.length,
  };
}

export function isBlowSample(
  sample: BlowSample,
  calibration: BlowCalibration,
  durationMs: number,
): boolean {
  return (
    durationMs >= 160 &&
    sample.rms >= Math.max(0.012, calibration.rms * 1.8) &&
    (sample.highFrequencyRatio >= 0.06 || sample.rms >= 0.045)
  );
}

export function getMotionMagnitude(event: Pick<DeviceMotionEvent, 'accelerationIncludingGravity'>): number | null {
  const acceleration = event.accelerationIncludingGravity;
  if (!acceleration) return null;
  const { x, y, z } = acceleration;
  if (x === null || y === null || z === null) return null;
  return Math.hypot(x, y, z);
}
