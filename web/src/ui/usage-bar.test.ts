import { describe, expect, it } from 'vitest';
import { usageTone } from './usage-bar';

describe('usageTone — ngưỡng tô màu thanh mức dùng', () => {
  it.each([
    [0, undefined, undefined, 'ok'],
    [69, undefined, undefined, 'ok'],
    [70, undefined, undefined, 'warn'],
    [90, undefined, undefined, 'danger'],
    // Dải IP truyền ngưỡng "sắp đầy" của system_config: 80 → vàng từ 80, đỏ từ 90.
    [79, 80, 90, 'ok'],
    [80, 80, 90, 'warn'],
    [95, 95, 95, 'danger'],
  ])('%s%% (warn %s, danger %s) → %s', (value, warnAt, dangerAt, tone) => {
    expect(usageTone(value, warnAt, dangerAt)).toBe(tone);
  });
});
