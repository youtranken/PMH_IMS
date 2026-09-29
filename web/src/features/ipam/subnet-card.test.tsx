import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { renderWithI18n, screen } from '@/test/test-utils';
import { SubnetCard } from '@/features/ipam/ipam-screen';
import type { SubnetRow } from '@/features/ipam/ipam-types';

const base: SubnetRow = {
  id: 's1',
  name: 'LAN văn phòng',
  cidr: '10.0.1.0/24',
  siteId: null,
  siteCode: null,
  vlan: null,
  gateway: null,
  description: null,
  createdBy: 'admin@pmh.com.vn',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
  total: 254,
  used: 0,
  free: 254,
  percent: 0,
  addressCount: 3,
  voidedAt: '2026-09-20T03:00:00.000Z',
  voidedBy: 'Nguyễn Văn An',
  voidReason: 'Gộp vào VLAN 20',
};

const noop = () => {};

/*
 * Thẻ dải đã tắt ở danh sách phải trả lời đủ ba câu như trang chi tiết: từ bao giờ, AI tắt,
 * vì sao. Thiếu "ai" thì người thấy dòng gạch ngang phải đi tra nhật ký mới biết hỏi ai.
 */
describe('SubnetCard — dải đã ngừng dùng', () => {
  it('nói ai đã tắt dải, cùng ngày và lý do', () => {
    renderWithI18n(
      <MemoryRouter>
        <SubnetCard
          subnet={base}
          active={false}
          canEdit={false}
          fullPercent={80}
          onEdit={noop}
          onHide={noop}
          onRestore={noop}
          onDelete={noop}
        />
      </MemoryRouter>,
    );
    const note = screen.getByText(/Gộp vào VLAN 20/);
    expect(note).toHaveTextContent('Nguyễn Văn An');
  });

  it('không rõ người tắt (dữ liệu cũ): hiện "—" thay vì bỏ trống', () => {
    renderWithI18n(
      <MemoryRouter>
        <SubnetCard
          subnet={{ ...base, voidedBy: null }}
          active={false}
          canEdit={false}
          fullPercent={80}
          onEdit={noop}
          onHide={noop}
          onRestore={noop}
          onDelete={noop}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Gộp vào VLAN 20/)).toHaveTextContent('bởi —');
  });
});
