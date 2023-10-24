import {expect, test} from 'bun:test';
import {clampString, sanitizeMove} from '../util';
import {CoordinatedMove, OrientedMove, ServerNormalMove} from '../api';
import {HEIGHT} from 'pujo-puyo-core';

test('String clamp', () => {
  const message =
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.';
  expect(clampString(message, 11)).toBe('Lorem ipsum');
});

test('String clamp (wide chars)', () => {
  const formula = '∀𝑥∈ℝ,𝑥²≥0';
  // Naive length fails
  expect(formula.length).toBeGreaterThan(9);
  // Clamping succeeds
  expect(clampString(formula, 9)).toBe(formula);
});

test('Move sanitazion (oriented)', () => {
  const move: OrientedMove = {
    type: 'move',
    x1: -69,
    y1: 420,
    orientation: 0,
    hardDrop: true,
    msRemaining: 100,
    pass: false,
  };
  const sanitized = sanitizeMove(0, move) as ServerNormalMove;
  expect(sanitized.x1).toBe(0);
  expect(sanitized.y1).toBe(HEIGHT - 1);
  expect(sanitized.x2).toBe(sanitized.x1);
  expect(sanitized.y2).toBe(sanitized.y1 - 1);
});

test('Move sanitazion (coordinated)', () => {
  const move: CoordinatedMove = {
    type: 'move',
    x1: 2,
    y1: 2,
    x2: 3,
    y2: 2,
    orientation: undefined,
    hardDrop: false,
    msRemaining: 100,
    pass: false,
  };
  const sanitized = sanitizeMove(1, move) as ServerNormalMove;
  expect(sanitized.orientation).toBe(3);
});
