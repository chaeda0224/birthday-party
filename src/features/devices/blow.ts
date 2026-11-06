import {
  analyseHighFrequencyRatio,
  analyseRms,
  createBlowCalibration,
  isBlowSample,
  type BlowSample,
} from './analysis.ts';

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  const candidate = window.AudioContext;
  return candidate ? (candidate as AudioContextConstructor) : null;
}

function isDocumentHidden(target: Document): boolean {
  return target.visibilityState === 'hidden';
}

export function createBlowSensor(
  onBlow: () => void,
  onLevel?: (value: number) => void,
): { start(): Promise<void>; stop(): void } {
  let generation = 0;
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let visibilityTarget: Document | null = null;
  let active = false;
  let lastBlowAt = Number.NEGATIVE_INFINITY;

  const stop = () => {
    generation += 1;
    active = false;
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (visibilityTarget) visibilityTarget.removeEventListener('visibilitychange', onVisibilityChange);
    visibilityTarget = null;
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    const oldContext = context;
    context = null;
    if (oldContext && oldContext.state !== 'closed') void oldContext.close().catch(() => undefined);
  };

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') stop();
  }

  return {
    async start() {
      stop();
      const currentGeneration = generation;
      const AudioContextCtor = getAudioContextConstructor();
      const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
      if (!mediaDevices?.getUserMedia || !AudioContextCtor || typeof document === 'undefined') {
        throw new Error('이 브라우저에서는 마이크 감지를 사용할 수 없습니다. 버튼으로 진행해 주세요.');
      }

      let audioContext: AudioContext;
      try {
        audioContext = new AudioContextCtor();
        context = audioContext;
      } catch {
        throw new Error('오디오를 시작할 수 없습니다. 소리 켜기 버튼을 다시 눌러 주세요.');
      }
      visibilityTarget = document;
      visibilityTarget.addEventListener('visibilitychange', onVisibilityChange);
      if (document.visibilityState === 'hidden') {
        stop();
        return;
      }

      try {
        await audioContext.resume();
        if (currentGeneration !== generation || isDocumentHidden(document)) {
          if (currentGeneration === generation) stop();
          return;
        }
      } catch {
        if (currentGeneration !== generation) return;
        stop();
        throw new Error('오디오를 시작할 수 없습니다. 소리 켜기 버튼을 다시 눌러 주세요.');
      }

      let acquired: MediaStream;
      try {
        acquired = await mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
      } catch (error) {
        if (currentGeneration !== generation) return;
        stop();
        const name = error instanceof DOMException ? error.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          throw new Error('마이크 권한이 거부되었습니다. 브라우저 설정에서 권한을 허용하거나 버튼으로 진행해 주세요.');
        }
        if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          throw new Error('사용할 수 있는 마이크를 찾지 못했습니다. 버튼으로 진행해 주세요.');
        }
        throw new Error('마이크를 열 수 없습니다. 권한과 기기 상태를 확인하거나 버튼으로 진행해 주세요.');
      }
      if (currentGeneration !== generation || isDocumentHidden(document)) {
        acquired.getTracks().forEach((track) => track.stop());
        if (currentGeneration === generation) stop();
        return;
      }
      stream = acquired;

      try {
        const source = audioContext.createMediaStreamSource(acquired);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);
        const timeData = new Float32Array(analyser.fftSize);
        const frequencyData = new Uint8Array(analyser.frequencyBinCount);
        const calibrationSamples: BlowSample[] = [];
        const calibrationStartedAt = performance.now();
        let loudStartedAt: number | null = null;
        active = true;
        lastBlowAt = Number.NEGATIVE_INFINITY;

        timer = setInterval(() => {
          if (!active || currentGeneration !== generation) return;
          analyser.getFloatTimeDomainData(timeData);
          analyser.getByteFrequencyData(frequencyData);
          const sample: BlowSample = {
            rms: analyseRms(timeData),
            highFrequencyRatio: analyseHighFrequencyRatio(frequencyData),
          };
          const elapsed = performance.now() - calibrationStartedAt;
          if (elapsed < 350) {
            calibrationSamples.push(sample);
            onLevel?.(sample.rms);
            return;
          }
          const calibration = createBlowCalibration(calibrationSamples);
          onLevel?.(sample.rms);
          const now = performance.now();
          if (isBlowSample(sample, calibration, 160)) {
            if (loudStartedAt === null) loudStartedAt = performance.now();
            if (now - loudStartedAt >= 160 && now - lastBlowAt >= 750) {
              lastBlowAt = now;
              onBlow();
            }
          } else {
            loudStartedAt = null;
          }
        }, 40);
      } catch (error) {
        stop();
        throw new Error('마이크 감지를 시작하지 못했습니다. 버튼으로 진행해 주세요.');
      }
    },
    stop,
  };
}
