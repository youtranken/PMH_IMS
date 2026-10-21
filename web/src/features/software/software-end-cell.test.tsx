import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { SoftwareEndCell } from './software-standing-cell';
import type { SoftwareRow } from './software-types';

const base = { kind: 'license', licenseModel: 'subscription', status: 'active', endDate: '2030-01-15', autoRetireOn: null } as unknown as SoftwareRow;

/* PW-A07 / TB-13: cột sắp theo ngày nên NGÀY là dòng chính; trạng thái chỉ khi khác Đang dùng. */
describe('SoftwareEndCell — cột "Hết hạn" ở danh sách phần mềm', () => {
  it.each([
    ['đang dùng có hạn → ngày + huy hiệu đếm ngày, không huy hiệu "Đang dùng"', base, '15/01/2030', /Còn \d/, 'Đang dùng'],
    ['vĩnh viễn → "Vĩnh viễn"', { ...base, licenseModel: 'perpetual', endDate: null }, 'Vĩnh viễn', null, 'Đang dùng'],
    ['không khai hạn → "Không có hạn"', { ...base, endDate: null }, 'Không có hạn', null, 'Đang dùng'],
    ['hết hạn → ngày + huy hiệu "Hết hạn"', { ...base, status: 'expired_ok', endDate: '2026-01-15' }, '15/01/2026', /^Hết hạn$/, null],
    ['đã thanh lý → ngày + "Đã thanh lý"', { ...base, status: 'retired', endDate: '2026-01-15' }, '15/01/2026', /^Đã thanh lý$/, null],
  ] as const)('%s', (_name, item, main, sub, absent) => {
    renderWithI18n(<SoftwareEndCell item={item as SoftwareRow} />);
    expect(screen.getByText(main)).toBeInTheDocument();
    if (sub) expect(screen.getByText(sub)).toBeInTheDocument();
    if (absent) expect(screen.queryByText(absent)).toBeNull();
  });
});
