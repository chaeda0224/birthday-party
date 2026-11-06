export type SoundKind = 'ignite' | 'party' | 'fart';

type AudioContextConstructor = new () => AudioContext;

function getAudioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === 'undefined') return null;
  return window.AudioContext ? (window.AudioContext as AudioContextConstructor) : null;
}

export function createSoundPlayer(): {
  unlock(): Promise<void>;
  play(kind: SoundKind): void;
  stop(): void;
  dispose(): void;
} {
  let context: AudioContext | null = null;
  let disposed = false;
  const activeNodes = new Set<OscillatorNode>();
  const stop = () => {
    for (const node of activeNodes) {
      try {
        node.stop();
      } catch {
        // Nodes that already ended cannot be stopped again.
      }
      node.disconnect();
    }
    activeNodes.clear();
  };

  const scheduleTone = (frequency: number, delay: number, duration: number, waveform: OscillatorType) => {
    if (!context || disposed) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = waveform;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime + delay);
    gain.gain.setValueAtTime(0.0001, context.currentTime + delay);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + delay + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + delay + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(context.currentTime + delay);
    oscillator.stop(context.currentTime + delay + duration + 0.02);
    activeNodes.add(oscillator);
    oscillator.addEventListener('ended', () => {
      activeNodes.delete(oscillator);
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
  };

  return {
    async unlock() {
      if (disposed) return;
      const AudioContextCtor = getAudioContextConstructor();
      if (!AudioContextCtor) throw new Error('Web Audio is not supported.');
      context ??= new AudioContextCtor();
      await context.resume();
    },
    play(kind) {
      if (disposed || !context || context.state !== 'running') return;
      stop();
      if (kind === 'ignite') {
        scheduleTone(523.25, 0, 0.2, 'sine');
        scheduleTone(659.25, 0.17, 0.2, 'sine');
        scheduleTone(783.99, 0.34, 0.35, 'sine');
      } else if (kind === 'party') {
        scheduleTone(523.25, 0, 0.2, 'triangle');
        scheduleTone(659.25, 0.16, 0.2, 'triangle');
        scheduleTone(783.99, 0.32, 0.2, 'triangle');
        scheduleTone(1046.5, 0.48, 0.55, 'triangle');
      } else {
        scheduleTone(155, 0, 0.11, 'sawtooth');
        scheduleTone(92, 0.11, 0.2, 'sawtooth');
      }
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      const oldContext = context;
      context = null;
      if (oldContext && oldContext.state !== 'closed') void oldContext.close().catch(() => undefined);
    },
  };
}
