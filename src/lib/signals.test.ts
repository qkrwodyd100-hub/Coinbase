import { describe, expect, it } from 'vitest';
import {
  calculateMovingAverage,
  calculateRsi,
  scoreFearGreed,
  scoreFunding,
  scoreMovingAverages,
  scoreRsi,
  signalForScore,
} from '@/lib/signals';

describe('signal scoring thresholds', () => {
  it.each([
    [30, 30],
    [30.01, 20],
    [45, 20],
    [45.01, 15],
    [59.99, 15],
    [60, 5],
    [69.99, 5],
    [70, 0],
  ])('scores RSI %s as %s', (value, expected) => {
    expect(scoreRsi(value).score).toBe(expected);
  });

  it.each([
    [25, 20],
    [25.01, 15],
    [45, 15],
    [45.01, 10],
    [59.99, 10],
    [60, 5],
    [74.99, 5],
    [75, 0],
  ])('scores Fear & Greed %s as %s', (value, expected) => {
    expect(scoreFearGreed(value).score).toBe(expected);
  });

  it.each([
    [0, 25],
    [-0.001, 25],
    [0.0001, 15],
    [0.01, 15],
    [0.0101, 5],
    [0.03, 5],
    [0.0301, 0],
  ])('scores funding %s%% as %s', (value, expected) => {
    expect(scoreFunding(value).score).toBe(expected);
  });

  it.each([
    [{ price: 110, ma20: 105, ma50: 100 }, 25],
    [{ price: 110, ma20: 105, ma50: 120 }, 15],
    [{ price: 95, ma20: 100, ma50: 105 }, 0],
    [{ price: 102, ma20: 105, ma50: 100 }, 10],
    [{ price: 100, ma20: 100, ma50: 90 }, 10],
    [{ price: 100, ma20: 101, ma50: 100 }, 10],
  ])('scores moving averages %# deterministically', (input, expected) => {
    expect(scoreMovingAverages(input.price, input.ma20, input.ma50).score).toBe(expected);
  });

  it.each([
    [80, 'Strong Buy'],
    [79, 'Buy'],
    [60, 'Buy'],
    [59, 'Neutral'],
    [41, 'Neutral'],
    [40, 'Sell'],
    [21, 'Sell'],
    [20, 'Strong Sell'],
  ])('labels overall score %s as %s', (score, label) => {
    expect(signalForScore(score).label).toBe(label);
  });
});

describe('indicator calculations', () => {
  it('calculates simple moving averages over the requested period', () => {
    expect(calculateMovingAverage([1, 2, 3, 4, 5], 3)).toBe(4);
  });

  it('calculates RSI(14) from historical closes', () => {
    const closes = [44, 44.15, 43.9, 44.35, 44.9, 45.1, 45, 45.45, 45.9, 46.1, 45.8, 46.2, 46.7, 46.95, 47.15];

    expect(calculateRsi(closes, 14)).toBeCloseTo(85.39, 2);
  });
});
