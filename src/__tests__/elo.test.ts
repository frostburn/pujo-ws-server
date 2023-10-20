import {expect, test} from 'bun:test';
import {updateElos} from '../elo.js';

test('No change for a draw with equal ratings', () => {
  const elo = Math.random() * 4000;

  const [ratingA, ratingB] = updateElos(elo, elo, 0.5);

  expect(ratingA).toBeCloseTo(elo);
  expect(ratingB).toBeCloseTo(elo);
});

test('Small change for sandbagging with a big rating difference', () => {
  const ratingA = Math.random() * 100 + 3000;
  const ratingB = Math.random() * 100 + 1000;

  const [newA, newB] = updateElos(ratingA, ratingB, 1);

  expect(newA).toBeGreaterThan(ratingA);
  expect(newA).toBeCloseTo(ratingA);

  expect(newB).toBeLessThan(ratingB);
  expect(newB).toBeCloseTo(ratingB);
});

test('Big change for an upset win', () => {
  const ratingA = Math.random() * 100 + 3000;
  const ratingB = Math.random() * 100 + 2000;

  const [newA, newB] = updateElos(ratingA, ratingB, 0);

  expect(newA).toBeLessThan(ratingA);
  expect(newA).not.toBeCloseTo(ratingA);

  expect(newB).toBeGreaterThan(ratingB);
  expect(newB).not.toBeCloseTo(ratingB);

  expect(ratingA + ratingB).toBeCloseTo(newA + newB);
});
