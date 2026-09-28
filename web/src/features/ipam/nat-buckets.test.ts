import { describe, expect, it } from 'vitest';
import { countNat, filterNat, natBucket, NAT_DEFAULT_SHOWN } from './nat-buckets';

const rule = (enabled: boolean, voidedAt: string | null) => ({ enabled, voidedAt });

describe('natBucket — ba rổ của sổ NAT', () => {
  it.each([
    [rule(true, null), 'open'],
    [rule(false, null), 'off'],
    // Đã gỡ thắng "đang bật": gỡ rồi thì cờ bật/tắt cũ không còn nghĩa gì.
    [rule(true, '2026-09-27T03:00:00Z'), 'voided'],
    [rule(false, '2026-09-27T03:00:00Z'), 'voided'],
  ])('%o → %s', (row, bucket) => {
    expect(natBucket(row)).toBe(bucket);
  });
});

describe('lọc và đếm', () => {
  const rows = [rule(true, null), rule(true, null), rule(false, null), rule(true, 'x')];

  it('đếm trên CẢ sổ, không phụ thuộc chip đang bật', () => {
    expect(countNat(rows)).toEqual({ open: 2, off: 1, voided: 1 });
  });

  it('mặc định hiện rule còn trong sổ (đang mở + đã tắt), giấu rule đã gỡ', () => {
    expect(filterNat(rows, NAT_DEFAULT_SHOWN)).toHaveLength(3);
  });

  it('chỉ bật "Đã gỡ" → chỉ còn rule đã gỡ', () => {
    expect(filterNat(rows, { open: false, off: false, voided: true })).toEqual([rows[3]]);
  });
});
