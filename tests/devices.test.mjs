import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyseHighFrequencyRatio,
  analyseRms,
  createBlowCalibration,
  getMotionMagnitude,
  isBlowSample,
} from '../src/features/devices/analysis.ts';
import { createBlowSensor } from '../src/features/devices/blow.ts';
import { createMotionSensor } from '../src/features/devices/motion.ts';
import { createSoundPlayer } from '../src/features/devices/sound.ts';
import { preparePhoto } from '../src/features/profile/photo.ts';

function installMicrophoneEnvironment({ deferCapture = false } = {}) {
  const originalWindow = globalThis.window;
  const originalNavigator = globalThis.navigator;
  const originalDocument = globalThis.document;
  const originalPerformance = globalThis.performance;
  const tracks = [];
  const listeners = new Map();
  let captureResolve;
  let now = 0;
  const context = {
    state: 'suspended',
    resume: async () => { context.state = 'running'; },
    close: async () => { context.state = 'closed'; },
    createMediaStreamSource: () => ({ connect() {} }),
    createAnalyser: () => ({
      fftSize: 0,
      frequencyBinCount: 4,
      getFloatTimeDomainData: (array) => array.fill(0.2),
      getByteFrequencyData: (array) => array.fill(10),
    }),
  };
  class FakeAudioContext {
    constructor() { return context; }
  }
  const mediaDevices = {
    getUserMedia: () => deferCapture
      ? new Promise((resolve) => { captureResolve = resolve; })
      : Promise.resolve({
          getTracks: () => {
            if (tracks.length === 0) tracks.push({ stopped: false, stop() { this.stopped = true; } });
            return tracks;
          },
        }),
  };
  globalThis.window = { AudioContext: FakeAudioContext };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices } });
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type),
  };
  globalThis.performance = { now: () => now };
  return {
    context,
    tracks,
    listeners,
    resolveCapture() {
      const track = { stopped: false, stop() { this.stopped = true; } };
      tracks.push(track);
      captureResolve({ getTracks: () => [track] });
    },
    setNow(value) { now = value; },
    restore() {
      globalThis.window = originalWindow;
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
      globalThis.document = originalDocument;
      globalThis.performance = originalPerformance;
    },
  };
}

test('RMS is stable for silence, signed samples, and empty input', () => {
  assert.equal(analyseRms([]), 0);
  assert.equal(analyseRms([0, 0, 0]), 0);
  assert.equal(analyseRms([1, -1]), 1);
});

test('high frequency energy ratio handles empty and zero energy', () => {
  assert.equal(analyseHighFrequencyRatio([]), 0);
  assert.equal(analyseHighFrequencyRatio([0, 0]), 0);
  assert.equal(analyseHighFrequencyRatio([1, 1, 2, 6], 2), 0.8);
});

test('blow decision accepts band-limited phone breath but rejects brief noise and silence', () => {
  const calibration = createBlowCalibration([
    { rms: 0.01, highFrequencyRatio: 0.1 },
    { rms: 0.02, highFrequencyRatio: 0.2 },
  ]);
  assert.equal(isBlowSample({ rms: 0.06, highFrequencyRatio: 0.4 }, calibration, 159), false);
  assert.equal(isBlowSample({ rms: 0.025, highFrequencyRatio: 0.12 }, calibration, 160), true);
  assert.equal(isBlowSample({ rms: 0.06, highFrequencyRatio: 0.01 }, calibration, 500), true);
  assert.equal(isBlowSample({ rms: 0.005, highFrequencyRatio: 0.4 }, calibration, 500), false);
});

test('motion magnitude rejects missing axes', () => {
  assert.equal(getMotionMagnitude({ accelerationIncludingGravity: null }), null);
  assert.equal(getMotionMagnitude({ accelerationIncludingGravity: { x: 3, y: 4, z: 0 } }), 5);
  assert.equal(getMotionMagnitude({ accelerationIncludingGravity: { x: 3, y: null, z: 0 } }), null);
});

test('device APIs expose graceful unsupported-browser behavior', async () => {
  const motion = createMotionSensor(() => {});
  assert.deepEqual(await motion.start(), { supported: false });
  motion.stop();

  const blow = createBlowSensor(() => {});
  await assert.rejects(blow.start(), /마이크 감지/);
  blow.stop();

  const sound = createSoundPlayer();
  await assert.rejects(sound.unlock(), /not supported/);
  sound.play('party');
  sound.stop();
  sound.dispose();
});

test('photo preparation rejects unsupported MIME types before decoding', async () => {
  const unsupported = new File(['placeholder'], 'local-image.heic', { type: 'image/heic' });
  await assert.rejects(preparePhoto(unsupported), /JPEG, PNG, WebP/);
});

test('stopping during pending microphone permission closes late tracks and audio', async () => {
  const env = installMicrophoneEnvironment({ deferCapture: true });
  try {
    const sensor = createBlowSensor(() => {});
    const pending = sensor.start();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(env.context.state, 'running');
    assert.equal(env.listeners.has('visibilitychange'), true);
    sensor.stop();
    env.resolveCapture();
    await pending;
    assert.equal(env.tracks[0].stopped, true);
    assert.equal(env.context.state, 'closed');
    assert.equal(env.listeners.has('visibilitychange'), false);
  } finally {
    env.restore();
  }
});

test('hiding during pending microphone permission stops a late stream', async () => {
  const env = installMicrophoneEnvironment({ deferCapture: true });
  try {
    const sensor = createBlowSensor(() => {});
    const pending = sensor.start();
    await new Promise((resolve) => setImmediate(resolve));
    globalThis.document.visibilityState = 'hidden';
    env.listeners.get('visibilitychange')();
    env.resolveCapture();
    await pending;
    assert.equal(env.tracks[0].stopped, true);
    assert.equal(env.context.state, 'closed');
  } finally {
    env.restore();
  }
});

test('blow detection repeats at most every 750 ms without stopping the sensor', async () => {
  const env = installMicrophoneEnvironment();
  const originalInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let sampleCallback;
  globalThis.setInterval = (callback) => { sampleCallback = callback; return 1; };
  globalThis.clearInterval = () => {};
  try {
    let blowCount = 0;
    const sensor = createBlowSensor(() => { blowCount += 1; });
    await sensor.start();
    for (let i = 0; i < 35; i += 1) {
      env.setNow(1000 + i * 40);
      sampleCallback();
    }
    assert.equal(blowCount, 2);
    assert.equal(env.tracks.length, 0);
    sensor.stop();
    assert.equal(env.tracks[0].stopped, true);
  } finally {
    globalThis.setInterval = originalInterval;
    globalThis.clearInterval = originalClearInterval;
    env.restore();
  }
});

test('sound stop immediately stops all scheduled oscillator nodes', async () => {
  const originalWindow = globalThis.window;
  const cancelled = [];
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
    createOscillator() {
      const listeners = new Map();
      return {
        type: 'sine', frequency: { setValueAtTime() {} },
        connect() {}, disconnect() {}, start() {},
        stop(...args) {
          if (args.length === 0) cancelled.push(true);
          listeners.get('ended')?.();
        },
        addEventListener(type, callback) { listeners.set(type, callback); },
      };
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
  }
  globalThis.window = { AudioContext: FakeAudioContext };
  try {
    const player = createSoundPlayer();
    await player.unlock();
    player.play('party');
    player.stop();
    assert.equal(cancelled.length, 4);
    player.dispose();
  } finally {
    globalThis.window = originalWindow;
  }
});

test('motion stop invalidates a pending permission request', async () => {
  const originalWindow = globalThis.window;
  const originalDeviceMotionEvent = globalThis.DeviceMotionEvent;
  let grantPermission;
  const browserWindow = new EventTarget();
  class FakeDeviceMotionEvent {
    static requestPermission() {
      return new Promise((resolve) => { grantPermission = resolve; });
    }
  }
  globalThis.window = browserWindow;
  globalThis.DeviceMotionEvent = FakeDeviceMotionEvent;
  try {
    let shakes = 0;
    const sensor = createMotionSensor(() => { shakes += 1; });
    const pending = sensor.start();
    sensor.stop();
    grantPermission('granted');
    assert.deepEqual(await pending, { supported: false });
    const event = new Event('devicemotion');
    Object.defineProperty(event, 'accelerationIncludingGravity', { value: { x: 8, y: 0, z: 0 } });
    browserWindow.dispatchEvent(event);
    assert.equal(shakes, 0);
  } finally {
    globalThis.window = originalWindow;
    if (originalDeviceMotionEvent === undefined) delete globalThis.DeviceMotionEvent;
    else globalThis.DeviceMotionEvent = originalDeviceMotionEvent;
  }
});

test('motion ignores null acceleration events while checking sensor support', async () => {
  const originalWindow = globalThis.window;
  const originalDeviceMotionEvent = globalThis.DeviceMotionEvent;
  const browserWindow = new EventTarget();
  class FakeDeviceMotionEvent {}
  globalThis.window = browserWindow;
  globalThis.DeviceMotionEvent = FakeDeviceMotionEvent;
  try {
    const sensor = createMotionSensor(() => {});
    const pending = sensor.start();
    await new Promise((resolve) => setImmediate(resolve));
    const emptyEvent = new Event('devicemotion');
    Object.defineProperty(emptyEvent, 'accelerationIncludingGravity', { value: null });
    browserWindow.dispatchEvent(emptyEvent);
    const validEvent = new Event('devicemotion');
    Object.defineProperty(validEvent, 'accelerationIncludingGravity', { value: { x: 0, y: 0, z: 9.8 } });
    browserWindow.dispatchEvent(validEvent);
    assert.deepEqual(await pending, { supported: true });
    sensor.stop();
  } finally {
    globalThis.window = originalWindow;
    if (originalDeviceMotionEvent === undefined) delete globalThis.DeviceMotionEvent;
    else globalThis.DeviceMotionEvent = originalDeviceMotionEvent;
  }
});
