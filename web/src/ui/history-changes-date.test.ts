import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { describeFieldChanges } from '@/ui/history-changes';

/** PW-A13: lịch sử in "2026-10-04 → 2027-10-05" — ngày dạng máy, không phải dd/mm/yyyy. */
describe('describeFieldChanges — ngày ISO hiện dd/mm/yyyy', () => {
  const t = i18n.t.bind(i18n);
  it('đổi ngày hết hạn', () => {
    const text = describeFieldChanges({ endDate: { before: '2026-10-04', after: '2027-10-05' } }, t, { label: () => 'Hết hạn' });
    expect(text).toBe('Hết hạn: 04/10/2026 → 05/10/2027');
  });
  it('chuỗi không phải ngày giữ nguyên', () => {
    const text = describeFieldChanges({ code: { before: 'LIC-2026-01', after: 'LIC-2026-02' } }, t, { label: () => 'Mã' });
    expect(text).toBe('Mã: LIC-2026-01 → LIC-2026-02');
  });
});
