import { describe, expect, it } from 'vitest';
import { siteFormLabel } from '@/ui/use-catalog-lists';

/** FM-11: ô chọn Site trong form có 3 kiểu nhãn — "CR3", "CR3 — Crescent…", "Crescent". */
describe('siteFormLabel', () => {
  it('"mã — tên" ở mọi form', () => {
    expect(siteFormLabel({ code: 'CR3', name: 'Crescent Residence' })).toBe('CR3 — Crescent Residence');
  });
});
