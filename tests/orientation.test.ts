import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeOrientation } from '../src/features/devices/orientation.ts';

test('normalizes calibrated deltas and clamps the range', () => {
  const baseline = { beta: 10, gamma: -5 };
  assert.deepEqual(normalizeOrientation(55, 17.5, baseline, 0), { x: 0.5, y: 1 });
  assert.deepEqual(normalizeOrientation(-100, 200, baseline, 0), { x: 1, y: -1 });
});

test('rotates normalized tilt for screen orientation', () => {
  const baseline = { beta: 0, gamma: 0 };
  assert.deepEqual(normalizeOrientation(0, 45, baseline, 0), { x: 1, y: 0 });
  assert.deepEqual(normalizeOrientation(0, 45, baseline, 90), { x: 0, y: -1 });
  assert.deepEqual(normalizeOrientation(0, 45, baseline, 180), { x: -1, y: 0 });
  assert.deepEqual(normalizeOrientation(0, 45, baseline, 270), { x: 0, y: 1 });
});
