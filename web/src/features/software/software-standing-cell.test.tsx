import { describe, expect, it } from 'vitest';
import { renderWithI18n, screen } from '@/test/test-utils';
import { SeatUsage, SoftwareStanding } from './software-standing-cell';
import { isoDay } from './software-standing';
import type { SoftwareRow } from './software-types';

const ROW: SoftwareRow = {
  id: 'x',
  code: 'LIC-1',
  name: 'Office',
  kind: 'license',
  licenseModel: 'subscription',
  vendorId: null,
  vendorName: null,
  seatTotal: 3,
  seatUsed: 1,
  startDate: null,
  endDate: '2099-01-01',
  note: null,
  status: 'active',
  createdAt: '',
  updatedAt: '',
  autoRetireOn: null,
};

function daysFromToday(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

describe('SeatUsage — SW-002', () => {
  it('chỉ in phân số, không in phần trăm', () => {
    renderWithI18n(<SeatUsage item={{ ...ROW, seatUsed: 3 }} />);
    expect(screen.getByText('3/3')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it.each([
    [3, 'Hết ghế'],
    [4, '+1 vượt'],
  ])('%i/3 → "%s" đỏ', (used, text) => {
    renderWithI18n(<SeatUsage item={{ ...ROW, seatUsed: used }} />);
    expect(screen.getByText(text)).toHaveClass('cell-sub', 'is-danger');
  });

  it('còn ghế thì không có cờ', () => {
    renderWithI18n(<SeatUsage item={ROW} />);
    expect(screen.queryByText('Hết ghế')).not.toBeInTheDocument();
  });
});

describe('SoftwareStanding — SW-004/SW-005', () => {
  it('Hết hạn: badge ĐỎ + "quá N ngày · tự thanh lý sau M ngày" từ mốc server', () => {
    renderWithI18n(
      <SoftwareStanding
        item={{
          ...ROW,
          status: 'expired_ok',
          endDate: daysFromToday(-10),
          autoRetireOn: daysFromToday(21),
        }}
      />,
    );
    expect(screen.getByText('Hết hạn')).toHaveClass('badge', 'danger');
    expect(screen.getByText('quá 10 ngày · tự thanh lý sau 21 ngày')).toBeInTheDocument();
  });

  it('Đã thanh lý: badge XÁM, không đếm ngày', () => {
    renderWithI18n(<SoftwareStanding item={{ ...ROW, status: 'retired', endDate: '2020-01-01' }} />);
    expect(screen.getByText('Đã thanh lý')).toHaveClass('badge', 'muted');
    expect(screen.queryByText(/quá/)).not.toBeInTheDocument();
  });

  it('Đang dùng có hạn: một badge đếm ngày, không có chữ "Đang dùng" thừa', () => {
    renderWithI18n(<SoftwareStanding item={{ ...ROW, endDate: daysFromToday(12) }} />);
    expect(screen.getByText('Còn 12 ngày')).toBeInTheDocument();
    expect(screen.queryByText('Đang dùng')).not.toBeInTheDocument();
  });

  it('vĩnh viễn: "Đang dùng" + dòng phụ "Vĩnh viễn"', () => {
    renderWithI18n(<SoftwareStanding item={{ ...ROW, licenseModel: 'perpetual', endDate: null }} />);
    expect(screen.getByText('Đang dùng')).toHaveClass('badge', 'ok');
    expect(screen.getByText('∞ Vĩnh viễn')).toBeInTheDocument();
  });
});
