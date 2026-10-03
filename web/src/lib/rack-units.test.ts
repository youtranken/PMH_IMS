import { describe, expect, it } from 'vitest';
import { rackUnitLabel } from './rack-units';

describe('rackUnitLabel', () => {
  it.each([
    [5, 1, 'U5'],
    [5, 2, 'U5–U6'],
    [5, null, 'U5'],
    [null, null, null],
    [undefined, undefined, null],
  ])('(%s, %s) → %s', (start, size, expected) => {
    expect(rackUnitLabel(start, size)).toBe(expected);
  });
});
