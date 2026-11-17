import { describe, it, expect } from 'vitest';
import { MA, EMA, SUM, MAX, MIN, ABS, SQRT, POW, MOD, ROUND } from '../../../../../web/src/formula-engine/interpreter/functions/math';

describe('M9 EMA warmup contract', () => {
  it('seeds after only the leading NaN prefix with the hand calculated SMA', () => {
    expect(EMA([NaN, NaN, 2, 4, 6, 8], 3)).toEqual([NaN, NaN, NaN, NaN, 4, 6]);
  });

  it('keeps empty all NaN and insufficient post prefix inputs unseeded', () => {
    expect(EMA([], 3)).toEqual([]);
    expect(EMA([NaN, NaN, NaN, NaN], 3)).toEqual([NaN, NaN, NaN, NaN]);
    expect(EMA([NaN, NaN, 2, 4], 3)).toEqual([NaN, NaN, NaN, NaN]);
  });

  it('warms period one after leading NaN without restarting after a later NaN', () => {
    expect(EMA([NaN, NaN, 2, 4, NaN, 8], 1)).toEqual([NaN, NaN, 2, 4, NaN, NaN]);
  });

  it('does not collect across an internal hole or restart poisoned recurrence', () => {
    expect(EMA([NaN, 2, NaN, 6, 8, 10], 3)).toEqual([NaN, NaN, NaN, NaN, NaN, NaN]);
    expect(EMA([NaN, 2, 4, 6, NaN, 10, 12], 3)).toEqual([NaN, NaN, NaN, 4, NaN, NaN, NaN]);
  });

  it('preserves exact frozen old vectors for uninterrupted valid inputs', () => {
    // Frozen from df6cedd before this patch; expected values never call EMA.
    expect(EMA([2, 8, 4, 10, 0, 6], 3)).toEqual([NaN, NaN, 4.666666666666667, 7.333333333333334, 3.666666666666667, 4.833333333333334]);
    expect(EMA([1e16, -1e16, 1, 4, 8, 2], 3)).toEqual([NaN, NaN, 0, 2, 5, 3.5]);
    expect(EMA([1e16, 1, -1e16, 4], 1)).toEqual([1e16, 0, -1e16, 4]);
    expect(EMA([7, 7, 7, 7, 7], 3)).toEqual([NaN, NaN, 7, 7, 7]);
    expect(EMA([1, 2], 3)).toEqual([NaN, NaN]);
    const wave = Array.from({ length: 32 }, (_, index) => 50 + 10 * Math.sin(index / 5) + 0.05 * index);
    expect(EMA(wave, 26)).toEqual([
      ...Array(25).fill(NaN), 51.81356923264605, 51.12111621117586, 50.565652426973216,
      50.15985103395867, 49.91126786150709, 49.82197728050736, 49.888431257642004,
    ]);
  });

  it('retains later non finite propagation and never skips leading Infinity', () => {
    expect(EMA([2, 4, 6, NaN, 10, 12], 3)).toEqual([NaN, NaN, 4, NaN, NaN, NaN]);
    expect(EMA([2, 4, 6, Infinity, 8, 10], 3)).toEqual([NaN, NaN, 4, Infinity, NaN, NaN]);
    expect(EMA([2, 4, 6, -Infinity, 8, 10], 3)).toEqual([NaN, NaN, 4, -Infinity, NaN, NaN]);
    expect(EMA([NaN, Infinity, 1, 2, 3], 3)).toEqual([NaN, NaN, NaN, Infinity, NaN]);
    expect(EMA([NaN, -Infinity, 1, 2, 3], 3)).toEqual([NaN, NaN, NaN, -Infinity, NaN]);
  });
});

describe('Math Functions', () => {
  describe('MA - Simple Moving Average', () => {
    it('should calculate MA correctly for valid input', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const period = 3;
      const result = MA(data, period);

      // First two values should be NaN (not enough data)
      expect(Number.isNaN(result[0])).toBe(true);
      expect(Number.isNaN(result[1])).toBe(true);

      // MA(3) = (1+2+3)/3 = 2
      expect(result[2]).toBeCloseTo(2);
      // MA(3) = (2+3+4)/3 = 3
      expect(result[3]).toBeCloseTo(3);
      // MA(3) = (3+4+5)/3 = 4
      expect(result[4]).toBeCloseTo(4);
      // MA(3) = (8+9+10)/3 = 9
      expect(result[9]).toBeCloseTo(9);
    });

    it('should handle period = 1', () => {
      const data = [1, 2, 3];
      const result = MA(data, 1);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should return all NaN when period > data length', () => {
      const data = [1, 2, 3];
      const result = MA(data, 5);
      expect(result.every(v => Number.isNaN(v))).toBe(true);
    });
  });

  describe('EMA - Exponential Moving Average', () => {
    it('should calculate EMA correctly', () => {
      const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const period = 3;
      const result = EMA(data, period);

      // First value should be NaN
      expect(Number.isNaN(result[0])).toBe(true);
      expect(Number.isNaN(result[1])).toBe(true);

      // EMA starts with SMA for first calculation
      // First EMA value (index 2) = SMA = (1+2+3)/3 = 2
      expect(result[2]).toBeCloseTo(2);

      // multiplier = 2/(3+1) = 0.5
      // EMA = (4 - 2) * 0.5 + 2 = 3
      expect(result[3]).toBeCloseTo(3);

      // EMA = (5 - 3) * 0.5 + 3 = 4
      expect(result[4]).toBeCloseTo(4);
    });

    it('should handle period = 1', () => {
      const data = [1, 2, 3];
      const result = EMA(data, 1);
      // When period = 1, multiplier = 2/(1+1) = 1, so EMA = current value
      expect(result[0]).toBeCloseTo(1);
      expect(result[1]).toBeCloseTo(2);
      expect(result[2]).toBeCloseTo(3);
    });
  });

  describe('SUM - Summation', () => {
    it('should calculate rolling sum correctly', () => {
      const data = [1, 2, 3, 4, 5];
      const period = 3;
      const result = SUM(data, period);

      // First two should be NaN
      expect(Number.isNaN(result[0])).toBe(true);
      expect(Number.isNaN(result[1])).toBe(true);

      // SUM(3) = 1+2+3 = 6
      expect(result[2]).toBe(6);
      // SUM(3) = 2+3+4 = 9
      expect(result[3]).toBe(9);
      // SUM(3) = 3+4+5 = 12
      expect(result[4]).toBe(12);
    });

    it('should handle period = 1', () => {
      const data = [1, 2, 3];
      const result = SUM(data, 1);
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('MAX - Maximum of two values', () => {
    it('should return element-wise maximum', () => {
      const a = [1, 5, 3, 8, 2];
      const b = [4, 2, 6, 1, 9];
      const result = MAX(a, b);

      expect(result).toEqual([4, 5, 6, 8, 9]);
    });

    it('should handle equal values', () => {
      const a = [5, 5, 5];
      const b = [5, 5, 5];
      const result = MAX(a, b);

      expect(result).toEqual([5, 5, 5]);
    });

    it('should handle arrays of different lengths by using shorter length', () => {
      const a = [1, 2, 3];
      const b = [4, 5];
      const result = MAX(a, b);

      expect(result).toEqual([4, 5]);
    });
  });

  describe('MIN - Minimum of two values', () => {
    it('should return element-wise minimum', () => {
      const a = [1, 5, 3, 8, 2];
      const b = [4, 2, 6, 1, 9];
      const result = MIN(a, b);

      expect(result).toEqual([1, 2, 3, 1, 2]);
    });

    it('should handle equal values', () => {
      const a = [5, 5, 5];
      const b = [5, 5, 5];
      const result = MIN(a, b);

      expect(result).toEqual([5, 5, 5]);
    });

    it('should handle arrays of different lengths by using shorter length', () => {
      const a = [1, 2, 3];
      const b = [4, 5];
      const result = MIN(a, b);

      expect(result).toEqual([1, 2]);
    });
  });

  describe('ABS - Absolute Value', () => {
    it('should calculate absolute values correctly', () => {
      const data = [1, -2, 3, -4, -5];
      const result = ABS(data);

      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should handle all positive values', () => {
      const data = [1, 2, 3];
      const result = ABS(data);

      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle all negative values', () => {
      const data = [-1, -2, -3];
      const result = ABS(data);

      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle zero', () => {
      const data = [0, -0, 0];
      const result = ABS(data);

      expect(result).toEqual([0, 0, 0]);
    });
  });

  describe('SQRT - Square Root', () => {
    it('should calculate square roots correctly', () => {
      const data = [4, 9, 16, 25];
      const result = SQRT(data);

      expect(result[0]).toBeCloseTo(2);
      expect(result[1]).toBeCloseTo(3);
      expect(result[2]).toBeCloseTo(4);
      expect(result[3]).toBeCloseTo(5);
    });

    it('should handle decimal results', () => {
      const data = [2, 3, 5];
      const result = SQRT(data);

      expect(result[0]).toBeCloseTo(Math.sqrt(2));
      expect(result[1]).toBeCloseTo(Math.sqrt(3));
      expect(result[2]).toBeCloseTo(Math.sqrt(5));
    });

    it('should handle zero', () => {
      const data = [0];
      const result = SQRT(data);

      expect(result[0]).toBe(0);
    });

    it('should return NaN for negative values', () => {
      const data = [-1, -4];
      const result = SQRT(data);

      expect(Number.isNaN(result[0])).toBe(true);
      expect(Number.isNaN(result[1])).toBe(true);
    });
  });

  describe('POW - Power', () => {
    it('should calculate power correctly for element-wise arrays', () => {
      const base = [2, 3, 4];
      const exp = [2, 2, 2];
      const result = POW(base, exp);

      expect(result).toEqual([4, 9, 16]);
    });

    it('should handle zero exponent', () => {
      const base = [2, 3, 4];
      const exp = [0, 0, 0];
      const result = POW(base, exp);

      expect(result).toEqual([1, 1, 1]);
    });

    it('should handle negative exponents', () => {
      const base = [2, 4];
      const exp = [-1, -2];
      const result = POW(base, exp);

      expect(result[0]).toBeCloseTo(0.5);
      expect(result[1]).toBeCloseTo(0.0625);
    });

    it('should handle arrays of different lengths by using shorter length', () => {
      const base = [2, 3, 4];
      const exp = [2, 3];
      const result = POW(base, exp);

      expect(result).toEqual([4, 27]);
    });
  });

  describe('MOD - Modulo', () => {
    it('should calculate modulo correctly', () => {
      const dividend = [10, 11, 12];
      const divisor = [3, 3, 3];
      const result = MOD(dividend, divisor);

      expect(result).toEqual([1, 2, 0]);
    });

    it('should handle negative dividends', () => {
      const dividend = [-10, -11];
      const divisor = [3, 3];
      const result = MOD(dividend, divisor);

      expect(result[0]).toBe(-10 % 3);
      expect(result[1]).toBe(-11 % 3);
    });

    it('should return NaN for division by zero', () => {
      const dividend = [10];
      const divisor = [0];
      const result = MOD(dividend, divisor);

      expect(Number.isNaN(result[0])).toBe(true);
    });

    it('should handle arrays of different lengths by using shorter length', () => {
      const dividend = [10, 11, 12];
      const divisor = [3, 3];
      const result = MOD(dividend, divisor);

      expect(result).toEqual([1, 2]);
    });
  });

  describe('ROUND - Rounding', () => {
    it('should round to nearest integer (banker\'s rounding)', () => {
      const data = [1.4, 1.5, 1.6];
      const result = ROUND(data);

      expect(result[0]).toBe(1);
      expect(result[1]).toBe(2);
      expect(result[2]).toBe(2);
    });

    it('should handle negative values', () => {
      const data = [-1.4, -2.5, -1.6];
      const result = ROUND(data);

      expect(result[0]).toBe(-1);
      expect(result[1]).toBe(-2);
      expect(result[2]).toBe(-2);
    });

    it('should handle whole numbers', () => {
      const data = [1, 2, 3];
      const result = ROUND(data);

      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle zero', () => {
      const data = [0, 0.1];
      const result = ROUND(data);

      expect(result[0]).toBe(0);
      expect(result[1]).toBe(0);
    });
  });
});
